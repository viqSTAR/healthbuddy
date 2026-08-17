/**
 * When a video consultation may be joined.
 *
 * A slot stores `2026-08-16` and `10:00` — plain strings with no offset — and
 * `10:00` means ten in the morning where the clinic is. Every other slot
 * decision on the platform reads them through `clock.ts` in the platform zone
 * for exactly that reason. The join window did not: it built the instant with
 * `new Date(y, m, d, hh, mm)`, which is the *server's* zone, so on any
 * deployment not running TZ=Asia/Kolkata the room unlocked five and a half
 * hours away from the consultation.
 *
 * These tests run against the platform clock rather than the process clock,
 * which is what makes them meaningful wherever CI happens to run.
 */
import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { app, prisma, request, login, loginAs, auth, cleanupTestUsers } from './helpers.js';
import { platformNow } from '../src/utils/clock.js';
import { cacheStore } from '../src/config/redis.js';

after(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
  await cacheStore.disconnect();
});

/** The platform-zone time `offsetMinutes` from now, as `HH:mm` on today. */
const platformTime = (offsetMinutes: number): string | null => {
  const now = platformNow();
  const [h = '0', m = '0'] = now.time.split(':');
  const total = Number(h) * 60 + Number(m) + offsetMinutes;
  // Kept inside the same platform day so the date string stays simple. Near
  // midnight the test skips rather than asserting against the wrong day.
  if (total < 0 || total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * A doctor of this file's own, so every minute of the day is free.
 *
 * The seeded doctors already hold slots at fixed times across many days, and a
 * slot is unique per (doctor, date, start) — moving a test slot onto "now"
 * collided with whatever the seed had put there. Owning the doctor removes the
 * coupling entirely.
 */
let ownDoctor: { id: string; session: Awaited<ReturnType<typeof loginAs>> } | null = null;

const theDoctor = async () => {
  if (ownDoctor) return ownDoctor;
  const session = await loginAs('DOCTOR');
  const row = await prisma.doctor.findUniqueOrThrow({
    where: { userId: session.userId },
    select: { id: true },
  });
  ownDoctor = { id: row.id, session };
  return ownDoctor;
};

/**
 * A video booking whose slot sits `offsetMinutes` from now in the platform's
 * zone.
 *
 * Booked a few minutes ahead and then moved, because the booking endpoint
 * refuses a slot that has already started — correctly, and it is not what is
 * under test here. Moving the row afterwards is the only way to examine the
 * join window on a consultation that is happening now or has lapsed.
 */
const aVideoBooking = async (offsetMinutes: number, parkOffset = 0) => {
  const bookAt = platformTime(20 + parkOffset);
  const wantedAt = platformTime(offsetMinutes);
  if (!bookAt || !wantedAt) return null;

  const doctor = await theDoctor();
  const patient = await login();
  const today = platformNow().date;

  const slot = await prisma.doctorSlot.create({
    data: {
      doctorId: doctor.id,
      date: today,
      startTime: bookAt,
      endTime: bookAt,
      status: 'AVAILABLE',
    },
    select: { id: true, doctorId: true },
  });

  const booked = await request(app)
    .post('/api/v1/appointments/book')
    .set(auth(patient.accessToken))
    .send({ doctorId: slot.doctorId, slotId: slot.id, type: 'VIDEO', symptoms: 'Window test.' });
  assert.equal(booked.status, 201, booked.text);

  if (wantedAt !== bookAt) {
    await prisma.doctorSlot.update({
      where: { id: slot.id },
      data: { startTime: wantedAt, endTime: wantedAt },
    });
  }

  return {
    patient,
    doctorToken: doctor.session.accessToken,
    appointmentId: booked.body.appointment.id as string,
    startTime: wantedAt,
  };
};

describe('the join window follows the clinic clock, not the server one', () => {
  test('a consultation starting now is joinable', async () => {
    const booking = await aVideoBooking(0, 3);
    if (!booking) return; // too close to midnight to place the slot cleanly

    const res = await request(app)
      .post(`/api/v1/video/${booking.appointmentId}/join`)
      .set(auth(booking.patient.accessToken));

    assert.equal(res.status, 200, `a consultation happening now must open: ${res.text}`);
    assert.ok(res.body.session.roomId, 'and it must carry a room');
  });

  test('a consultation an hour away is refused, and says when it opens', async () => {
    const booking = await aVideoBooking(60, 4);
    if (!booking) return;

    const res = await request(app)
      .post(`/api/v1/video/${booking.appointmentId}/join`)
      .set(auth(booking.patient.accessToken));

    assert.equal(res.status, 425, res.text);
    assert.match(res.body.error, new RegExp(booking.startTime));
  });

  test('a consultation long past is refused as lapsed', async () => {
    const booking = await aVideoBooking(-240, 5);
    if (!booking) return;

    const res = await request(app)
      .post(`/api/v1/video/${booking.appointmentId}/join`)
      .set(auth(booking.patient.accessToken));

    assert.equal(res.status, 410, res.text);
  });

  test('both sides land in the same room', async () => {
    const booking = await aVideoBooking(-1, 1);
    if (!booking) return;

    const asPatient = await request(app)
      .post(`/api/v1/video/${booking.appointmentId}/join`)
      .set(auth(booking.patient.accessToken));
    assert.equal(asPatient.status, 200, asPatient.text);

    const asDoctor = await request(app)
      .post(`/api/v1/video/${booking.appointmentId}/join`)
      .set(auth(booking.doctorToken));
    assert.equal(asDoctor.status, 200, asDoctor.text);

    // A consultation with two people in two different rooms is not a
    // consultation. The room is minted once and reused.
    assert.equal(asPatient.body.session.roomId, asDoctor.body.session.roomId);
    assert.notEqual(
      asPatient.body.session.roomId,
      booking.appointmentId,
      'the room name must not be the appointment id — it is a bearer credential'
    );
  });

  test('a stranger gets a 404, not a 403', async () => {
    const booking = await aVideoBooking(-2, 2);
    if (!booking) return;

    const stranger = await login();
    // 403 would confirm the appointment exists, which is itself a disclosure
    // about somebody else's care.
    await request(app)
      .post(`/api/v1/video/${booking.appointmentId}/join`)
      .set(auth(stranger.accessToken))
      .expect(404);
  });
});
