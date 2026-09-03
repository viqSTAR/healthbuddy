import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { app, prisma, request, login, loginAs, cleanupTestUsers } from './helpers.js';
import { cacheStore } from '../src/config/redis.js';
import { windowFor, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE } from '../src/utils/pagination.js';

/**
 * A list read that grows without limit is a slow outage waiting for its
 * busiest user. These lock in that the default is bounded — which is the part
 * that matters, because every existing client passes no parameters at all.
 */

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('the window is always bounded', () => {
  test('no parameters gives a sane default', () => {
    const w = windowFor();
    assert.equal(w.take, DEFAULT_PAGE_SIZE);
    assert.equal(w.skip, 0);
  });

  test('a caller cannot ask for the whole table', () => {
    assert.equal(windowFor({ limit: 1_000_000 }).take, MAX_PAGE_SIZE);
    assert.equal(windowFor({ limit: Number.MAX_SAFE_INTEGER }).take, MAX_PAGE_SIZE);
  });

  /**
   * `skip: Infinity` is not an integer, and the query layer rejects it — so a
   * malformed page number used to be a 500 rather than a clamp. Everything a
   * query string can carry has to land on a usable integer.
   */
  test('garbage clamps instead of throwing or returning everything', () => {
    const rubbish = [NaN, 0, -1, -999, Infinity, -Infinity, undefined, 1e400, '4' , 'abc', null];

    for (const bad of rubbish) {
      const w = windowFor({ limit: bad as number, page: bad as number });
      assert.ok(w.take >= 1 && w.take <= MAX_PAGE_SIZE, `limit ${String(bad)} -> ${w.take}`);
      assert.ok(w.skip >= 0, `page ${String(bad)} -> skip ${w.skip}`);
      assert.ok(
        Number.isInteger(w.take) && Number.isInteger(w.skip),
        `${String(bad)} produced a non-integer window: take=${w.take} skip=${w.skip}`
      );
    }
  });

  test('paging walks forward', () => {
    assert.deepEqual(
      [windowFor({ page: 1, limit: 20 }).skip, windowFor({ page: 3, limit: 20 }).skip],
      [0, 40]
    );
  });
});

describe('history endpoints page', () => {
  /** More rows than one page holds, so a second page has something in it. */
  const aPatientWithHistory = async () => {
    const patient = await login();
    const doctor = await loginAs('DOCTOR');
    const patientRow = await prisma.patient.findUniqueOrThrow({
      where: { userId: patient.userId },
    });
    const doctorRow = await prisma.doctor.findUniqueOrThrow({ where: { userId: doctor.userId } });

    for (let i = 0; i < 7; i++) {
      const slot = await prisma.doctorSlot.create({
        data: {
          doctorId: doctorRow.id,
          date: `2026-09-${String(i + 1).padStart(2, '0')}`,
          startTime: '10:00',
          endTime: '10:15',
          status: 'BOOKED',
        },
        select: { id: true },
      });
      await prisma.appointment.create({
        data: {
          patientId: patientRow.id,
          doctorId: doctorRow.id,
          slotId: slot.id,
          type: 'VIDEO',
          status: 'COMPLETED',
        },
      });
    }
    return patient;
  };

  test('my-appointments respects limit and page', async () => {
    const patient = await aPatientWithHistory();

    const all = await request(app)
      .get('/api/v1/appointments/my-appointments')
      .set(bearer(patient.accessToken));
    assert.equal(all.status, 200);
    assert.equal(all.body.appointments.length, 7, 'the default window still fits this history');

    const first = await request(app)
      .get('/api/v1/appointments/my-appointments?limit=3')
      .set(bearer(patient.accessToken));
    assert.equal(first.body.appointments.length, 3);

    const second = await request(app)
      .get('/api/v1/appointments/my-appointments?limit=3&page=2')
      .set(bearer(patient.accessToken));
    assert.equal(second.body.appointments.length, 3);

    const firstIds = first.body.appointments.map((a: { id: string }) => a.id);
    const secondIds = second.body.appointments.map((a: { id: string }) => a.id);
    assert.equal(
      firstIds.filter((id: string) => secondIds.includes(id)).length,
      0,
      'page 2 must not repeat page 1'
    );

    const third = await request(app)
      .get('/api/v1/appointments/my-appointments?limit=3&page=3')
      .set(bearer(patient.accessToken));
    assert.equal(third.body.appointments.length, 1, 'the last page is the remainder');
  });

  test('an absurd limit is clamped rather than honoured', async () => {
    const patient = await aPatientWithHistory();
    const res = await request(app)
      .get('/api/v1/appointments/my-appointments?limit=999999')
      .set(bearer(patient.accessToken));

    assert.equal(res.status, 200);
    assert.ok(res.body.appointments.length <= MAX_PAGE_SIZE);
  });

  test('the medical record windows each list', async () => {
    const patient = await aPatientWithHistory();
    const res = await request(app)
      .get('/api/v1/patients/me/records?limit=2')
      .set(bearer(patient.accessToken));

    assert.equal(res.status, 200);
    assert.equal(res.body.appointments.length, 2);
    assert.equal(res.body.limit, 2);
  });

  test('visits page too', async () => {
    const patient = await aPatientWithHistory();
    const res = await request(app)
      .get('/api/v1/patients/me/visits?limit=4')
      .set(bearer(patient.accessToken));

    assert.equal(res.status, 200);
    assert.equal(res.body.visits.length, 4);
  });

  test('endpoints still answer with no parameters at all', async () => {
    const patient = await login();
    for (const path of [
      '/api/v1/appointments/my-appointments',
      '/api/v1/patients/me/records',
      '/api/v1/patients/me/visits',
      '/api/v1/labs/my-orders',
      '/api/v1/prescriptions/mine',
      '/api/v1/pharmacy/my-orders',
      '/api/v1/emergency/my-history',
    ]) {
      const res = await request(app).get(path).set(bearer(patient.accessToken));
      assert.equal(res.status, 200, `${path} -> ${res.status}`);
    }
  });
});

after(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
  await cacheStore.disconnect();
});
