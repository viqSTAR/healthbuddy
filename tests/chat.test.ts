/**
 * Follow-up messaging between a patient and the doctor who saw them.
 *
 * The assertions that matter here are about who is allowed to do what, and
 * about the channel existing at all: the entitlement is created as a side
 * effect of a consultation completing, so the ways a consultation can complete
 * are the ways this feature can silently disappear.
 */
import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  app,
  prisma,
  request,
  login,
  loginOnce,
  auth,
  cleanupTestUsers,
  anAvailableSlot,
} from './helpers.js';
import { cacheStore } from '../src/config/redis.js';

after(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
  await cacheStore.disconnect();
});

/** Books a real consultation and returns both sides plus the appointment. */
const aConsultation = async () => {
  const patient = await login();

  const slot = await anAvailableSlot();
  const booked = await request(app)
    .post('/api/v1/appointments/book')
    .set(auth(patient.accessToken))
    .send({ doctorId: slot.doctorId, slotId: slot.id, type: 'VIDEO', symptoms: 'Sore throat' });
  assert.equal(booked.status, 201, booked.text);

  const owner = await prisma.doctor.findUniqueOrThrow({
    where: { id: slot.doctorId },
    select: { user: { select: { phoneNumber: true } } },
  });
  const doctor = await loginOnce(owner.user.phoneNumber);

  return { patient, doctor, appointmentId: booked.body.appointment.id as string };
};

/**
 * Prescribes from the picker rather than free text: a hand-typed drug has no
 * catalogue entry and the telemedicine lists would refuse it, which would fail
 * these tests for a reason that has nothing to do with chat.
 */
const prescribe = async (doctorToken: string, appointmentId: string) => {
  const picker = await request(app)
    .get(`/api/v1/prescriptions/prescribable/${appointmentId}`)
    .set(auth(doctorToken));
  assert.equal(picker.status, 200, picker.text);

  const drug = (picker.body.medicines as { id: string; name: string; prescribable: boolean }[]).find(
    (m) => m.prescribable
  );
  assert.ok(drug, 'seed data required — run `npm run seed`');

  const res = await request(app)
    .post('/api/v1/prescriptions')
    .set(auth(doctorToken))
    .send({
      appointmentId,
      diagnosis: 'Acute pharyngitis',
      medicines: [
        {
          medicineId: drug.id,
          name: drug.name,
          dosage: '1 tablet',
          frequency: 'Twice daily',
          durationDays: 3,
        },
      ],
      advice: 'Fluids.',
    });
  assert.equal(res.status, 201, res.text);
};

const threadsFor = async (token: string) => {
  const res = await request(app).get('/api/v1/chat/threads').set(auth(token));
  assert.equal(res.status, 200, res.text);
  return res.body.threads as {
    id: string;
    canSend: boolean;
    blockedBecause: string | null;
    blockedMessage: string | null;
    unreadCount: number;
    lastMessage: { body: string } | null;
    doctor: { name: string } | null;
    patient: { fullName: string | null } | null;
  }[];
};

describe('the follow-up channel is earned by a consultation', () => {
  test('writing a prescription opens it', async () => {
    const { patient, doctor, appointmentId } = await aConsultation();

    // Nothing yet — the consultation has not finished.
    assert.equal((await threadsFor(patient.accessToken)).length, 0);

    await prescribe(doctor.accessToken, appointmentId);

    /**
     * The regression this guards.
     *
     * Ending the video call opened a thread; prescribing did not, even though
     * it completes the appointment just the same. That left the most common
     * flow of all — see the patient, prescribe, done — with no channel, and
     * in-person consultations never open a video room, so they never got one
     * at all.
     */
    const threads = await threadsFor(patient.accessToken);
    assert.equal(threads.length, 1, 'prescribing must open the follow-up channel');
    assert.equal(threads[0]!.canSend, true);
    assert.ok(threads[0]!.doctor?.name, 'the patient should see who they are talking to');
  });

  test('both sides see the same thread, and unread counts follow the reader', async () => {
    const { patient, doctor, appointmentId } = await aConsultation();
    await prescribe(doctor.accessToken, appointmentId);

    const [thread] = await threadsFor(patient.accessToken);
    const sent = await request(app)
      .post(`/api/v1/chat/threads/${thread!.id}/messages`)
      .set(auth(patient.accessToken))
      .send({ body: 'Should I take it before food?' });
    assert.equal(sent.status, 201, sent.text);

    const forDoctor = (await threadsFor(doctor.accessToken)).find((t) => t.id === thread!.id);
    assert.ok(forDoctor, 'the doctor must see the thread too');
    assert.equal(forDoctor.unreadCount, 1);
    assert.ok(forDoctor.lastMessage?.body.includes('before food'));

    // The sender's own message is never unread to them.
    const forPatient = (await threadsFor(patient.accessToken)).find((t) => t.id === thread!.id);
    assert.equal(forPatient!.unreadCount, 0);

    await request(app)
      .post(`/api/v1/chat/threads/${thread!.id}/read`)
      .set(auth(doctor.accessToken))
      .expect(200);

    const afterRead = (await threadsFor(doctor.accessToken)).find((t) => t.id === thread!.id);
    assert.equal(afterRead!.unreadCount, 0);
  });
});

describe('who may do what in a conversation', () => {
  test('a stranger can neither read it nor post to it', async () => {
    const { patient, doctor, appointmentId } = await aConsultation();
    await prescribe(doctor.accessToken, appointmentId);
    const [thread] = await threadsFor(patient.accessToken);

    const stranger = await login();

    // 404 rather than 403 — thread ids must not be probeable.
    await request(app)
      .get(`/api/v1/chat/threads/${thread!.id}`)
      .set(auth(stranger.accessToken))
      .expect(404);

    await request(app)
      .post(`/api/v1/chat/threads/${thread!.id}/messages`)
      .set(auth(stranger.accessToken))
      .send({ body: 'hello' })
      .expect(404);

    assert.equal((await threadsFor(stranger.accessToken)).length, 0);
  });

  test('the patient cannot open or close the channel', async () => {
    const { patient, doctor, appointmentId } = await aConsultation();
    await prescribe(doctor.accessToken, appointmentId);
    const [thread] = await threadsFor(patient.accessToken);

    // The entitlement is the doctor's to grant; a patient able to extend it
    // indefinitely recreates the unlimited channel this design avoids.
    await request(app)
      .patch(`/api/v1/chat/threads/${thread!.id}/state`)
      .set(auth(patient.accessToken))
      .send({ open: false })
      .expect(403);
  });

  test('a closed thread refuses messages and says why, until the doctor reopens it', async () => {
    const { patient, doctor, appointmentId } = await aConsultation();
    await prescribe(doctor.accessToken, appointmentId);
    const [thread] = await threadsFor(patient.accessToken);

    await request(app)
      .patch(`/api/v1/chat/threads/${thread!.id}/state`)
      .set(auth(doctor.accessToken))
      .send({ open: false })
      .expect(200);

    const closed = await request(app)
      .get(`/api/v1/chat/threads/${thread!.id}`)
      .set(auth(patient.accessToken))
      .expect(200);

    assert.equal(closed.body.thread.canSend, false);
    assert.equal(closed.body.thread.blockedBecause, 'CLOSED_BY_DOCTOR');
    // The client should not be reassembling this sentence from dates.
    assert.ok(
      typeof closed.body.thread.blockedMessage === 'string' &&
        closed.body.thread.blockedMessage.length > 0,
      'the server must supply the sentence to show'
    );

    await request(app)
      .post(`/api/v1/chat/threads/${thread!.id}/messages`)
      .set(auth(patient.accessToken))
      .send({ body: 'one more question' })
      .expect(403);

    await request(app)
      .patch(`/api/v1/chat/threads/${thread!.id}/state`)
      .set(auth(doctor.accessToken))
      .send({ open: true })
      .expect(200);

    await request(app)
      .post(`/api/v1/chat/threads/${thread!.id}/messages`)
      .set(auth(patient.accessToken))
      .send({ body: 'thank you' })
      .expect(201);
  });

  test('an admin block outlasts the doctor reopening the thread', async () => {
    const { patient, doctor, appointmentId } = await aConsultation();
    await prescribe(doctor.accessToken, appointmentId);
    const [thread] = await threadsFor(patient.accessToken);

    await prisma.chatThread.update({
      where: { id: thread!.id },
      data: { blockedAt: new Date(), blockedReason: 'under review' },
    });

    // The doctor's own control must not override the override.
    await request(app)
      .patch(`/api/v1/chat/threads/${thread!.id}/state`)
      .set(auth(doctor.accessToken))
      .send({ open: true })
      .expect(403);

    const blocked = await request(app)
      .get(`/api/v1/chat/threads/${thread!.id}`)
      .set(auth(patient.accessToken))
      .expect(200);
    assert.equal(blocked.body.thread.blockedBecause, 'BLOCKED_BY_ADMIN');
  });
});

describe('a message is delivered, not just stored', () => {
  test('the other party is notified, and the alert can be routed back to the thread', async () => {
    const { patient, doctor, appointmentId } = await aConsultation();
    await prescribe(doctor.accessToken, appointmentId);
    const [thread] = await threadsFor(patient.accessToken);

    await request(app)
      .post(`/api/v1/chat/threads/${thread!.id}/messages`)
      .set(auth(patient.accessToken))
      .send({ body: 'A follow-up question.' })
      .expect(201);

    const feed = await request(app)
      .get('/api/v1/notifications')
      .set(auth(doctor.accessToken))
      .expect(200);

    const alert = (feed.body.notifications as { data?: { threadId?: string } }[]).find(
      (n) => n.data?.threadId === thread!.id
    );
    // Without the id, both apps have a notification that cannot open anything.
    assert.ok(alert, 'the doctor must be notified, carrying the thread id to route to');
  });

  test('an empty or over-long message is refused', async () => {
    const { patient, doctor, appointmentId } = await aConsultation();
    await prescribe(doctor.accessToken, appointmentId);
    const [thread] = await threadsFor(patient.accessToken);

    await request(app)
      .post(`/api/v1/chat/threads/${thread!.id}/messages`)
      .set(auth(patient.accessToken))
      .send({ body: '   ' })
      .expect(400);

    await request(app)
      .post(`/api/v1/chat/threads/${thread!.id}/messages`)
      .set(auth(patient.accessToken))
      .send({ body: 'x'.repeat(2001) })
      .expect(400);
  });
});
