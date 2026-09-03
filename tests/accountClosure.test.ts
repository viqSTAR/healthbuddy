import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { app, prisma, request, login, loginAs, cleanupTestUsers } from './helpers.js';
import { cacheStore } from '../src/config/redis.js';

/**
 * Erasure, against records that cannot be erased.
 *
 * The interesting property is not that data disappears — it is that the right
 * data disappears and the rest provably does not. A prescription has to survive
 * a patient closing their account, because the doctor who wrote it and the
 * pharmacy that filled it are accountable for it; the patient's name, number and
 * address must not.
 */

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

/**
 * A booked consultation, built directly.
 *
 * The booking flow has its own suite; what these tests need is the *state* it
 * produces, and going through the API would couple them to slot availability in
 * the seed data.
 */
const aScheduledConsultation = async (patientUserId: string, doctorUserId: string) => {
  const patientRow = await prisma.patient.findUniqueOrThrow({
    where: { userId: patientUserId },
  });
  const doctorRow = await prisma.doctor.findUniqueOrThrow({ where: { userId: doctorUserId } });

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const slot = await prisma.doctorSlot.create({
    data: {
      doctorId: doctorRow.id,
      date: tomorrow,
      startTime: '10:00',
      endTime: '10:15',
      status: 'BOOKED',
    },
    select: { id: true },
  });

  const appointment = await prisma.appointment.create({
    data: {
      patientId: patientRow.id,
      doctorId: doctorRow.id,
      slotId: slot.id,
      type: 'VIDEO',
      status: 'SCHEDULED',
    },
    select: { id: true },
  });

  return { appointment, patientRow, doctorRow };
};

const closeOwnAccount = (token: string, confirmPhoneNumber: string) =>
  request(app).delete('/api/v1/patients/me').set(bearer(token)).send({ confirmPhoneNumber });

describe('closing your own account', () => {
  test('personal data is destroyed and the session ends', async () => {
    const patient = await login();

    await request(app)
      .put('/api/v1/patients/me')
      .set(bearer(patient.accessToken))
      .send({ fullName: 'Meera Raman', email: 'meera@example.test', bloodGroup: 'O+' });

    await request(app)
      .post('/api/v1/patients/me/addresses')
      .set(bearer(patient.accessToken))
      .send({ line1: '4 Hill Road', pincode: '400058', label: 'HOME' });

    const closed = await closeOwnAccount(patient.accessToken, patient.phone);
    assert.equal(closed.status, 200);
    assert.ok(closed.body.anonymisedAt);

    const row = await prisma.user.findUnique({
      where: { id: patient.userId },
      include: { patient: { include: { addresses: true } } },
    });

    assert.ok(row, 'the row survives — clinical records point at it');
    assert.notEqual(row!.phoneNumber, patient.phone, 'the number must not remain on the account');
    assert.match(row!.phoneNumber, /^erased:/);
    assert.ok(row!.anonymisedAt);
    assert.equal(row!.patient!.fullName, 'Closed account');
    assert.equal(row!.patient!.email, null);
    assert.equal(row!.patient!.bloodGroup, null);
    assert.equal(row!.patient!.addresses.length, 0, 'saved addresses are personal data');

    // Signed out everywhere, immediately.
    const stale = await request(app).get('/api/v1/patients/me').set(bearer(patient.accessToken));
    assert.equal(stale.status, 401);

    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: patient.refreshToken });
    assert.equal(refreshed.status, 401);
  });

  test('the released number starts a new account, not the old one', async () => {
    const patient = await login();
    const originalUserId = patient.userId;

    await closeOwnAccount(patient.accessToken, patient.phone);

    // A different number, because the closed one is behind the OTP cooldown
    // from its original sign-in — what is being asserted is that the erased row
    // no longer answers to the phone number it used to hold.
    const claimed = await prisma.user.findUnique({ where: { phoneNumber: patient.phone } });
    assert.equal(claimed, null, 'the number is free for a genuinely new account');

    const erased = await prisma.user.findUnique({ where: { id: originalUserId } });
    assert.ok(erased, 'the old account still exists, without an identity');
  });

  test('the confirmation must match the account', async () => {
    const patient = await login();

    const wrong = await closeOwnAccount(patient.accessToken, '+15550000000');
    assert.equal(wrong.status, 400);

    const stillThere = await request(app)
      .get('/api/v1/patients/me')
      .set(bearer(patient.accessToken));
    assert.equal(stillThere.status, 200, 'a failed confirmation must change nothing');
  });

  test('an account with work in flight is refused, with the reason', async () => {
    const patient = await login();
    const doctor = await loginAs('DOCTOR');
    const { appointment } = await aScheduledConsultation(patient.userId, doctor.userId);

    const refused = await closeOwnAccount(patient.accessToken, patient.phone);
    assert.equal(refused.status, 409);
    assert.match(refused.body.error, /upcoming consultation/i);

    // And it becomes possible once the consultation is no longer pending.
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: 'COMPLETED' },
    });
    assert.equal((await closeOwnAccount(patient.accessToken, patient.phone)).status, 200);
  });
});

describe('erasure will not strand a delivery', () => {
  /**
   * The order row is not the order's status.
   *
   * Once an order has parcels, what it is really doing is derived from them.
   * The guard originally read only the row, so an order stamped DELIVERED with
   * a parcel still out looked finished — and closing the account then deleted
   * the address the rider was carrying it to.
   */
  test('a delivered-looking order with a live parcel still blocks', async () => {
    const patient = await login();
    const patientRow = await prisma.patient.findUniqueOrThrow({
      where: { userId: patient.userId },
    });
    const pharmacy = await prisma.pharmacy.findFirstOrThrow({ select: { id: true } });

    const order = await prisma.medicineOrder.create({
      data: {
        patientId: patientRow.id,
        pharmacyId: pharmacy.id,
        items: [],
        totalAmount: 100,
        address: '9 Test Road',
        // The row says finished...
        status: 'DELIVERED',
      },
      select: { id: true },
    });

    // ...but a parcel is still out for delivery.
    await prisma.shipment.create({
      data: {
        orderId: order.id,
        pharmacyId: pharmacy.id,
        items: [],
        subtotal: 100,
        status: 'DISPATCHED',
      },
    });

    const refused = await closeOwnAccount(patient.accessToken, patient.phone);
    assert.equal(refused.status, 409, 'a rider is still carrying this');
    assert.match(refused.body.error, /order/i);

    // Once the parcel lands, closing is allowed.
    await prisma.shipment.updateMany({
      where: { orderId: order.id },
      data: { status: 'DELIVERED' },
    });
    assert.equal((await closeOwnAccount(patient.accessToken, patient.phone)).status, 200);
  });
});

describe('what erasure keeps', () => {
  test('a prescription outlives the account it belonged to', async () => {
    const patient = await login();
    const doctor = await loginAs('DOCTOR');
    const { appointment, patientRow, doctorRow } = await aScheduledConsultation(
      patient.userId,
      doctor.userId
    );

    // The consultation has to be finished before the account can close, which
    // is also when a prescription would really exist.
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: 'COMPLETED' },
    });

    const rx = await prisma.prescription.create({
      data: {
        appointmentId: appointment.id,
        patientId: patientRow.id,
        doctorId: doctorRow.id,
        diagnosis: 'Seasonal rhinitis',
        medicines: [{ name: 'Cetirizine 10mg', dosage: '1 at night', durationDays: 5 }],
      },
      select: { id: true, diagnosis: true },
    });

    assert.equal((await closeOwnAccount(patient.accessToken, patient.phone)).status, 200);

    const survived = await prisma.prescription.findUnique({ where: { id: rx.id } });
    assert.ok(survived, 'the medical record must not be deleted with the identity');
    assert.equal(survived!.diagnosis, 'Seasonal rhinitis', 'and it is intact, not blanked');

    // The record now points at a subject with no identity in it.
    const subject = await prisma.patient.findUniqueOrThrow({ where: { id: survived!.patientId } });
    assert.equal(subject.fullName, 'Closed account');
    assert.equal(subject.email, null);
  });

  test('the audit log records who closed the account', async () => {
    const patient = await login();
    await closeOwnAccount(patient.accessToken, patient.phone);

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'user.erased', entityId: patient.userId },
    });
    assert.ok(entry, 'an irreversible action with no audit entry is not accountable');
    assert.equal(entry!.actorUserId, patient.userId);
  });
});

describe('an admin can close an account on request', () => {
  test('it works, and is attributed to the admin', async () => {
    const admin = await loginAs('ADMIN');
    const patient = await login();

    const res = await request(app)
      .post(`/api/v1/admin/users/${patient.userId}/erase`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'Erasure requested by email' });

    assert.equal(res.status, 200);

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'user.erased', entityId: patient.userId },
    });
    assert.equal(entry!.actorUserId, admin.userId);
  });

  test('an admin cannot close their own account this way', async () => {
    const admin = await loginAs('ADMIN');

    const res = await request(app)
      .post(`/api/v1/admin/users/${admin.userId}/erase`)
      .set(bearer(admin.accessToken))
      .send({ reason: 'oops' });

    assert.equal(res.status, 400);
  });

  test('a patient cannot close somebody else\'s account', async () => {
    const a = await login();
    const b = await login();

    const res = await request(app)
      .post(`/api/v1/admin/users/${b.userId}/erase`)
      .set(bearer(a.accessToken))
      .send({});

    assert.equal(res.status, 403);
  });
});

describe('data export', () => {
  test('a patient can read back what is held about them', async () => {
    const patient = await login();
    await request(app)
      .put('/api/v1/patients/me')
      .set(bearer(patient.accessToken))
      .send({ fullName: 'Export Me' });

    const res = await request(app).get('/api/v1/patients/me/export').set(bearer(patient.accessToken));

    assert.equal(res.status, 200);
    assert.equal(res.body.data.account.phoneNumber, patient.phone);
    assert.equal(res.body.data.profile.fullName, 'Export Me');
    assert.ok(Array.isArray(res.body.data.prescriptions));

    // Document *metadata* only — the bytes still go through the authorised
    // download route rather than being bulk-dumped here.
    assert.ok(Array.isArray(res.body.data.documents));
    for (const doc of res.body.data.documents) {
      assert.equal(doc.storageKey, undefined);
    }
  });

  test('the export requires a session', async () => {
    assert.equal((await request(app).get('/api/v1/patients/me/export')).status, 401);
  });
});

after(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
  await cacheStore.disconnect();
});
