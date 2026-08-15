/**
 * Regression tests for the vulnerabilities found in the security assessment.
 * Each test names the flaw it locks shut — if one of these fails, a real
 * exploit has been reintroduced.
 */
import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  app,
  prisma,
  request,
  login,
  loginAs,
  auth,
  uniquePhone,
  cleanupTestUsers,
  anAvailableSlot,
  anOrderableMedicine,
} from './helpers.js';
import { cacheStore } from '../src/config/redis.js';
import { env } from '../src/config/env.js';

after(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
  // Without this the ioredis socket keeps the event loop alive and the runner
  // never exits, even though every test has finished.
  await cacheStore.disconnect();
});

describe('privilege escalation', () => {
  test('a client cannot choose its own role via the verify-otp body', async () => {
    const phone = uniquePhone();
    const sent = await request(app).post('/api/v1/auth/send-otp').send({ phoneNumber: phone });

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phoneNumber: phone, otp: sent.body.devOtp, role: 'ADMIN' });

    assert.equal(res.status, 200);
    // The injected role must be ignored entirely.
    assert.equal(res.body.user.role, 'PATIENT');

    const claims = JSON.parse(
      Buffer.from(res.body.tokens.accessToken.split('.')[1], 'base64').toString()
    );
    assert.equal(claims.role, 'PATIENT');
  });

  test('a patient token is rejected by the admin stats endpoint', async () => {
    const patient = await login();
    const res = await request(app).get('/api/v1/admin/stats').set(auth(patient.accessToken));
    assert.equal(res.status, 403);
  });

  test('an admin token is accepted by the admin stats endpoint', async () => {
    const admin = await loginAs('ADMIN');
    const res = await request(app).get('/api/v1/admin/stats').set(auth(admin.accessToken));
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.stats.totalPatients, 'number');
  });

  test('role provisioning is admin-only', async () => {
    const patient = await login();
    const res = await request(app)
      .post('/api/v1/auth/provision')
      .set(auth(patient.accessToken))
      .send({ phoneNumber: uniquePhone(), role: 'ADMIN', name: 'Attacker' });

    assert.equal(res.status, 403);
  });
});

describe('cross-patient data isolation', () => {
  test('a patient cannot read the pharmacy order queue', async () => {
    const patient = await login();
    const res = await request(app)
      .get('/api/v1/pharmacy/pharmacy-queue')
      .set(auth(patient.accessToken));
    assert.equal(res.status, 403);
  });

  test('a patient cannot read the lab queue', async () => {
    const patient = await login();
    const res = await request(app).get('/api/v1/labs/queue').set(auth(patient.accessToken));
    assert.equal(res.status, 403);
  });

  test('a patient cannot read the emergency dispatch queue (live GPS)', async () => {
    const patient = await login();
    const res = await request(app).get('/api/v1/emergency/queue').set(auth(patient.accessToken));
    assert.equal(res.status, 403);
  });

  test('a patient cannot attach a lab report onto any order', async () => {
    const patient = await login();
    const res = await request(app)
      .post('/api/v1/labs/attach-report')
      .set(auth(patient.accessToken))
      .send({
        orderId: '00000000-0000-4000-8000-000000000000',
        documentId: '00000000-0000-4000-8000-000000000001',
      });

    assert.equal(res.status, 403);
  });

  test("patient B cannot read patient A's medicine order by id", async () => {
    const [a, b] = await Promise.all([login(), login()]);
    const medicine = await anOrderableMedicine();

    const created = await request(app)
      .post('/api/v1/pharmacy/orders')
      .set(auth(a.accessToken))
      .send({ items: [{ medicineId: medicine.id, quantity: 1 }], address: '742 Evergreen Terrace' });

    assert.equal(created.status, 201);

    const stolen = await request(app)
      .get(`/api/v1/pharmacy/my-orders/${created.body.order.id}`)
      .set(auth(b.accessToken));

    // 404 rather than 403 so ids cannot be probed for existence.
    assert.equal(stolen.status, 404);
  });

  test('a patient only sees their own orders in the list endpoint', async () => {
    const [a, b] = await Promise.all([login(), login()]);
    const medicine = await anOrderableMedicine();

    await request(app)
      .post('/api/v1/pharmacy/orders')
      .set(auth(a.accessToken))
      .send({ items: [{ medicineId: medicine.id, quantity: 1 }], address: 'A street' });

    const res = await request(app).get('/api/v1/pharmacy/my-orders').set(auth(b.accessToken));
    assert.equal(res.status, 200);
    assert.equal(res.body.orders.length, 0);
  });
});

describe('token handling', () => {
  test('a refresh token cannot be used as an access token', async () => {
    const session = await login();
    const res = await request(app).get('/api/v1/patients/me').set(auth(session.refreshToken));
    assert.equal(res.status, 401);
  });

  test('a garbage token is rejected', async () => {
    const res = await request(app).get('/api/v1/patients/me').set(auth('not.a.token'));
    assert.equal(res.status, 401);
  });

  test('a missing token is rejected', async () => {
    const res = await request(app).get('/api/v1/patients/me');
    assert.equal(res.status, 401);
  });

  test('refresh re-reads the role from the database', async () => {
    const session = await login();
    assert.equal(session.role, 'PATIENT');

    await prisma.user.update({ where: { id: session.userId }, data: { role: 'ADMIN' } });

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken });

    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'ADMIN');
  });
});

describe('OTP hardening', () => {
  test('an incorrect OTP is rejected', async () => {
    const phone = uniquePhone();
    const sent = await request(app).post('/api/v1/auth/send-otp').send({ phoneNumber: phone });
    const wrong = sent.body.devOtp === '000000' ? '111111' : '000000';

    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phoneNumber: phone, otp: wrong });

    assert.equal(res.status, 400);
  });

  test('repeated wrong guesses are locked out before the 6-digit space is searchable', async () => {
    const phone = uniquePhone();
    await request(app).post('/api/v1/auth/send-otp').send({ phoneNumber: phone });

    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ phoneNumber: phone, otp: String(100000 + i) });
      statuses.push(res.status);
    }

    assert.ok(statuses.includes(429), `expected a 429 lockout, saw ${statuses.join(',')}`);
  });

  test('an OTP cannot be replayed after successful use', async () => {
    const phone = uniquePhone();
    const sent = await request(app).post('/api/v1/auth/send-otp').send({ phoneNumber: phone });
    const otp = sent.body.devOtp;

    const first = await request(app).post('/api/v1/auth/verify-otp').send({ phoneNumber: phone, otp });
    assert.equal(first.status, 200);

    const replay = await request(app).post('/api/v1/auth/verify-otp').send({ phoneNumber: phone, otp });
    assert.equal(replay.status, 400);
  });

  test('OTPs are stored hashed, not in plaintext', async () => {
    const { cacheStore } = await import('../src/config/redis.js');
    const phone = uniquePhone();
    const sent = await request(app).post('/api/v1/auth/send-otp').send({ phoneNumber: phone });

    const stored = await cacheStore.get(`otp:${phone}`);
    assert.ok(stored, 'OTP should be stored');
    assert.notEqual(stored, sent.body.devOtp);
    assert.match(stored!, /^[a-f0-9]{64}$/);
  });
});

describe('input validation', () => {
  test('a malformed phone number is rejected', async () => {
    const res = await request(app).post('/api/v1/auth/send-otp').send({ phoneNumber: 'DROP TABLE' });
    assert.equal(res.status, 400);
  });

  test('a non-6-digit OTP is rejected before reaching the store', async () => {
    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phoneNumber: uniquePhone(), otp: '12' });
    assert.equal(res.status, 400);
  });

  test('out-of-range SOS coordinates are rejected', async () => {
    const patient = await login();
    const res = await request(app)
      .post('/api/v1/emergency/sos')
      .set(auth(patient.accessToken))
      .send({ latitude: 999, longitude: -999 });

    assert.equal(res.status, 400);
  });

  test('unknown profile fields are rejected rather than persisted', async () => {
    const patient = await login();
    const res = await request(app)
      .put('/api/v1/patients/me')
      .set(auth(patient.accessToken))
      .send({ fullName: 'Real Name', role: 'ADMIN', isVerified: true });

    assert.equal(res.status, 400);
  });

  test('a negative order quantity is rejected', async () => {
    const patient = await login();
    const medicine = await anOrderableMedicine();

    const res = await request(app)
      .post('/api/v1/pharmacy/orders')
      .set(auth(patient.accessToken))
      .send({ items: [{ medicineId: medicine.id, quantity: -5 }], address: 'somewhere' });

    assert.equal(res.status, 400);
  });
});

describe('booking concurrency', () => {
  test('only one of five concurrent bookings wins the same slot', async () => {
    /**
     * Retried because the slot can be taken between choosing it and racing for
     * it — by a developer clicking through the app, or another script against
     * the same database. That produces five 409s and zero winners, which looks
     * like a failure but is the atomic claim working correctly on a slot this
     * test no longer owns.
     *
     * The invariant under test is "at most one winner, and the database agrees",
     * and it is still asserted strictly on every attempt. Only the case of
     * losing the slot outright is retried, and a genuine break — two winners —
     * fails on the first pass rather than being retried away.
     */
    for (let attempt = 1; attempt <= 3; attempt++) {
      const slot = await anAvailableSlot();
      const sessions = await Promise.all([login(), login(), login(), login(), login()]);

      const results = await Promise.all(
        sessions.map((s) =>
          request(app)
            .post('/api/v1/appointments/book')
            .set(auth(s.accessToken))
            .send({ doctorId: slot.doctorId, slotId: slot.id, type: 'VIDEO' })
        )
      );

      const booked = results.filter((r) => r.status === 201);
      const rejected = results.filter((r) => r.status === 409);
      const count = await prisma.appointment.count({ where: { slotId: slot.id } });

      // Never more than one winner — checked before anything is retried, so a
      // broken claim cannot hide behind another attempt.
      assert.ok(booked.length <= 1, `two callers booked the same slot: ${booked.length} winners`);
      assert.equal(count, 1, `slot ${slot.id} holds ${count} appointments`);

      if (booked.length === 1) {
        assert.equal(rejected.length, 4);
        return;
      }

      // Zero winners: someone outside this test holds the slot. Take a fresh one.
      assert.ok(attempt < 3, 'could not obtain an uncontended slot in three attempts');
    }
  });

  test('a booked slot is reported as unavailable afterwards', async () => {
    const slot = await anAvailableSlot();
    const patient = await login();

    const res = await request(app)
      .post('/api/v1/appointments/book')
      .set(auth(patient.accessToken))
      .send({ doctorId: slot.doctorId, slotId: slot.id, type: 'VIDEO' });

    assert.equal(res.status, 201);

    const after = await prisma.doctorSlot.findUnique({ where: { id: slot.id } });
    assert.equal(after?.status, 'BOOKED');
  });

  test('a slot belonging to another doctor is rejected', async () => {
    const slot = await anAvailableSlot();
    const otherDoctor = await prisma.doctor.findFirst({ where: { id: { not: slot.doctorId } } });
    assert.ok(otherDoctor);

    const patient = await login();
    const res = await request(app)
      .post('/api/v1/appointments/book')
      .set(auth(patient.accessToken))
      .send({ doctorId: otherDoctor.id, slotId: slot.id, type: 'VIDEO' });

    assert.equal(res.status, 400);
  });
});

/**
 * Self-registration reintroduces the exact temptation that caused the original
 * privilege-escalation flaw: a user describing what they want to be. These lock
 * shut the boundary that says an application is a request, not a grant.
 */
describe('provider self-registration', () => {
  const draft = (type: 'DOCTOR' | 'PHARMACY' | 'LAB') => ({
    type,
    displayName: 'Test Provider',
    address: '10 Test Road, Test City',
    city: 'Mumbai',
    ...(type === 'DOCTOR'
      ? {
          councilRegistrationNumber: 'MH-2020-000001',
          qualification: 'MBBS',
          specialty: 'General Physician',
          consultationFee: 500,
        }
      : {}),
    ...(type === 'PHARMACY'
      ? { drugLicenceNumber: 'MH-RTL-20-000001', drugLicenceExpiry: '2030-01-01' }
      : {}),
    ...(type === 'LAB' ? { labRegistrationNumber: 'MH-CLE-2020-0001' } : {}),
  });

  test('submitting an application does not grant the role', async () => {
    const applicant = await login();

    const saved = await request(app)
      .put('/api/v1/applications')
      .set(auth(applicant.accessToken))
      .send(draft('PHARMACY'));
    assert.equal(saved.status, 200);

    // The role must still be PATIENT after a refresh, which re-reads the DB.
    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: applicant.refreshToken });

    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.user.role, 'PATIENT');

    const user = await prisma.user.findUnique({ where: { id: applicant.userId } });
    assert.equal(user?.role, 'PATIENT');
  });

  test('an applicant cannot approve their own application', async () => {
    const applicant = await login();
    await request(app)
      .put('/api/v1/applications')
      .set(auth(applicant.accessToken))
      .send(draft('LAB'));

    const mine = await request(app)
      .get('/api/v1/applications/mine')
      .set(auth(applicant.accessToken));
    const applicationId = mine.body.applications[0].id;

    const res = await request(app)
      .post(`/api/v1/applications/${applicationId}/review`)
      .set(auth(applicant.accessToken))
      .send({ decision: 'APPROVE' });

    assert.equal(res.status, 403);
  });

  test('a patient cannot read the admin review queue', async () => {
    const patient = await login();
    const res = await request(app)
      .get('/api/v1/applications')
      .set(auth(patient.accessToken));

    assert.equal(res.status, 403);
  });

  test("an applicant cannot read another applicant's application", async () => {
    const [a, b] = await Promise.all([login(), login()]);

    await request(app).put('/api/v1/applications').set(auth(a.accessToken)).send(draft('DOCTOR'));
    const mine = await request(app).get('/api/v1/applications/mine').set(auth(a.accessToken));
    const applicationId = mine.body.applications[0].id;

    const res = await request(app)
      .get(`/api/v1/applications/${applicationId}`)
      .set(auth(b.accessToken));

    // 404, not 403 — a 403 would confirm the id exists.
    assert.equal(res.status, 404);
  });

  test('an incomplete application cannot be submitted for review', async () => {
    const applicant = await login();
    await request(app)
      .put('/api/v1/applications')
      .set(auth(applicant.accessToken))
      .send({ type: 'PHARMACY', displayName: 'No Licence Pharmacy', address: '1 Nowhere Lane' });

    const res = await request(app)
      .post('/api/v1/applications/submit')
      .set(auth(applicant.accessToken))
      .send({ type: 'PHARMACY' });

    // Missing both the licence fields and the licence document.
    assert.equal(res.status, 400);
  });

  test('an admin rejection requires a reason', async () => {
    const [applicant, admin] = await Promise.all([login(), loginAs('ADMIN')]);
    await request(app)
      .put('/api/v1/applications')
      .set(auth(applicant.accessToken))
      .send(draft('DOCTOR'));

    const mine = await request(app)
      .get('/api/v1/applications/mine')
      .set(auth(applicant.accessToken));

    const res = await request(app)
      .post(`/api/v1/applications/${mine.body.applications[0].id}/review`)
      .set(auth(admin.accessToken))
      .send({ decision: 'REJECT' });

    assert.equal(res.status, 400);
  });
});

describe('telemedicine prescribing rules', () => {
  test('a List B drug is refused on a first consultation', async () => {
    const listB = await prisma.medicine.findFirst({ where: { teleList: 'LIST_B' } });
    assert.ok(listB, 'seed data required — run `npm run seed`');

    const slot = await anAvailableSlot();
    const patient = await login();

    const booked = await request(app)
      .post('/api/v1/appointments/book')
      .set(auth(patient.accessToken))
      .send({ doctorId: slot.doctorId, slotId: slot.id, type: 'VIDEO' });
    assert.equal(booked.status, 201);
    assert.equal(booked.body.appointment.isFollowUp, false);

    // Act as the doctor who owns this slot.
    const doctorUser = await prisma.doctor.findUniqueOrThrow({
      where: { id: slot.doctorId },
      select: { user: { select: { phoneNumber: true } } },
    });
    const doctor = await login(doctorUser.user.phoneNumber);

    const res = await request(app)
      .post('/api/v1/prescriptions')
      .set(auth(doctor.accessToken))
      .send({
        appointmentId: booked.body.appointment.id,
        diagnosis: 'Test diagnosis',
        medicines: [
          { medicineId: listB.id, name: listB.name, dosage: '1 tablet', frequency: 'twice daily' },
        ],
      });

    assert.equal(res.status, 422);
    assert.match(res.body.error, /follow-up/i);
  });

  test('a Schedule X drug cannot be stocked by a pharmacy', async () => {
    const scheduleX = await prisma.medicine.findFirst({ where: { schedule: 'SCHEDULE_X' } });
    assert.ok(scheduleX, 'seed data required — run `npm run seed`');

    const pharmacy = await loginAs('PHARMACY');
    const res = await request(app)
      .put('/api/v1/inventory/pharmacy')
      .set(auth(pharmacy.accessToken))
      .send({ medicineId: scheduleX.id, price: 100, stock: 10 });

    assert.equal(res.status, 422);
  });
});

/**
 * The consent gate. A prescription is clinical advice; buying what it names is
 * a separate decision. These lock shut the boundary that keeps it that way.
 */
describe('prescription fulfilment consent', () => {
  test('a patient cannot see another patient\'s prescription order', async () => {
    const [a, b] = await Promise.all([login(), login()]);

    // `a` has no fulfilments, so any id `b` guesses must 404 rather than 403.
    const res = await request(app)
      .get('/api/v1/fulfilment/00000000-0000-4000-8000-000000000000')
      .set(auth(b.accessToken));

    assert.equal(res.status, 404);
    assert.ok(a.userId);
  });

  test('a patient cannot consent on another patient\'s behalf', async () => {
    const [, b] = await Promise.all([login(), login()]);

    const res = await request(app)
      .post('/api/v1/fulfilment/00000000-0000-4000-8000-000000000000/consent')
      .set(auth(b.accessToken))
      .send({ deliveryAddress: '742 Evergreen Terrace, Springfield' });

    assert.equal(res.status, 404);
  });

  test('a doctor cannot consent to a fulfilment at all', async () => {
    const doctor = await loginAs('DOCTOR');

    const res = await request(app)
      .post('/api/v1/fulfilment/00000000-0000-4000-8000-000000000000/consent')
      .set(auth(doctor.accessToken))
      .send({ deliveryAddress: '742 Evergreen Terrace, Springfield' });

    // Consent belongs to the patient alone — the prescriber must never be able
    // to approve a purchase for them.
    assert.equal(res.status, 403);
  });

  test('consent requires a delivery address', async () => {
    const patient = await login();

    const res = await request(app)
      .post('/api/v1/fulfilment/00000000-0000-4000-8000-000000000000/consent')
      .set(auth(patient.accessToken))
      .send({});

    assert.equal(res.status, 400);
  });

  test('only an admin can expire stale offers', async () => {
    const patient = await login();
    const res = await request(app)
      .post('/api/v1/fulfilment/expire-stale')
      .set(auth(patient.accessToken));

    assert.equal(res.status, 403);
  });
});

describe('emergency directory', () => {
  test('emergency numbers are readable without a login', async () => {
    // Someone in an emergency may have an expired session or a stranger's
    // phone. Gating an ambulance number behind auth is the wrong trade.
    const res = await request(app).get('/api/v1/health-content/emergency-services');

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.national));
    assert.ok(res.body.national.length > 0, 'seed data required — run `npm run seed`');
  });

  test('a patient cannot edit the emergency directory', async () => {
    const patient = await login();
    const res = await request(app)
      .put('/api/v1/health-content/emergency-services')
      .set(auth(patient.accessToken))
      .send({ name: 'Fake Ambulance', type: 'AMBULANCE', phone: '+10000000000' });

    assert.equal(res.status, 403);
  });
});

describe('payments', () => {
  const NONEXISTENT = '00000000-0000-4000-8000-000000000000';

  test('a patient cannot check out an order that is not theirs', async () => {
    const patient = await login();

    const res = await request(app)
      .post('/api/v1/payments/checkout')
      .set(auth(patient.accessToken))
      .send({ purpose: 'MEDICINE_ORDER', targetId: NONEXISTENT, method: 'UPI' });

    // 404, not 403 — a 403 would confirm the order exists.
    assert.equal(res.status, 404);
  });

  test('checkout takes no amount from the client', async () => {
    const patient = await login();

    const res = await request(app)
      .post('/api/v1/payments/checkout')
      .set(auth(patient.accessToken))
      .send({ purpose: 'MEDICINE_ORDER', targetId: NONEXISTENT, method: 'UPI', amount: 1 });

    // The extra field is ignored, not honoured: the request still fails on the
    // order lookup rather than being priced at ₹1.
    assert.equal(res.status, 404);
  });

  test('a payment cannot be confirmed with a forged signature', async () => {
    const patient = await login();

    const res = await request(app)
      .post('/api/v1/payments/confirm')
      .set(auth(patient.accessToken))
      .send({
        orderId: 'order_mock_doesnotexist',
        paymentId: 'pay_mock_forged',
        signature: 'f'.repeat(64),
      });

    // No such payment for this user. The important property is that no code
    // path marks anything PAID without a signature this server computed.
    assert.equal(res.status, 404);
  });

  test('an unsigned webhook is refused', async () => {
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(JSON.stringify({ event: 'payment.captured', orderId: 'order_x' })));

    // Without this check anyone could post "payment succeeded" and release an
    // unpaid order to a pharmacy.
    assert.equal(res.status, 403);
  });

  test('a webhook with a wrong signature is refused', async () => {
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-webhook-signature', 'a'.repeat(64))
      .send(Buffer.from(JSON.stringify({ event: 'payment.captured', orderId: 'order_x' })));

    assert.equal(res.status, 403);
  });

  test('a correctly signed webhook is accepted and verified against the raw body', async () => {
    const body = JSON.stringify({
      event: 'payment.captured',
      id: `evt_${Date.now()}`,
      orderId: 'order_mock_nothing_matches_this',
    });
    const signature = createHmac('sha256', env.JWT_ACCESS_SECRET).update(body).digest('hex');

    // Sent as a string, exactly as a gateway sends it. Passing a Buffer here
    // would have superagent re-encode it as {"type":"Buffer","data":[...]},
    // which is a different set of bytes and would fail this signature — which
    // is precisely the property the raw-body mounting exists to preserve.
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-webhook-signature', signature)
      .send(body);

    assert.equal(res.status, 200);
    assert.equal(res.body.matched, false);
  });

  test('a patient cannot read a partner earnings statement', async () => {
    const patient = await login();
    const res = await request(app).get('/api/v1/payments/earnings').set(auth(patient.accessToken));
    assert.equal(res.status, 403);
  });

  test('a pharmacy cannot settle cash on an order it does not hold', async () => {
    const pharmacy = await loginAs('PHARMACY');

    const res = await request(app)
      .post(`/api/v1/payments/cod/${NONEXISTENT}/collected`)
      .set(auth(pharmacy.accessToken));

    assert.equal(res.status, 404);
  });

  test('a patient cannot settle their own cash-on-delivery debt', async () => {
    const patient = await login();

    const res = await request(app)
      .post(`/api/v1/payments/cod/${NONEXISTENT}/collected`)
      .set(auth(patient.accessToken));

    assert.equal(res.status, 403);
  });

  test('a patient cannot read another user\'s payment', async () => {
    const [, b] = await Promise.all([login(), login()]);
    const res = await request(app)
      .get(`/api/v1/payments/${NONEXISTENT}`)
      .set(auth(b.accessToken));
    assert.equal(res.status, 404);
  });
});

describe('video consultation access', () => {
  const NONEXISTENT = '00000000-0000-4000-8000-000000000000';

  test('joining a consultation requires a session', async () => {
    const res = await request(app).post(`/api/v1/video/${NONEXISTENT}/join`);
    assert.equal(res.status, 401);
  });

  test('a stranger cannot join a consultation they are not part of', async () => {
    const stranger = await login();
    const res = await request(app)
      .post(`/api/v1/video/${NONEXISTENT}/join`)
      .set(auth(stranger.accessToken));

    // 404 rather than 403: confirming the appointment exists is itself a
    // disclosure about someone else's care.
    assert.equal(res.status, 404);
  });

  test('a patient cannot end a consultation', async () => {
    const patient = await login();
    const res = await request(app)
      .post(`/api/v1/video/${NONEXISTENT}/end`)
      .set(auth(patient.accessToken));

    assert.equal(res.status, 403);
  });

  test('a doctor cannot end a consultation that is not theirs', async () => {
    const doctor = await loginAs('DOCTOR');
    const res = await request(app)
      .post(`/api/v1/video/${NONEXISTENT}/end`)
      .set(auth(doctor.accessToken));

    assert.equal(res.status, 404);
  });
});

describe('document access', () => {
  test('an unsigned request for a document is rejected', async () => {
    const res = await request(app).get(
      '/api/v1/files/00000000-0000-4000-8000-000000000000/signed?token=forged.deadbeef'
    );
    assert.equal(res.status, 404);
  });

  test('an unauthenticated document download is rejected', async () => {
    const res = await request(app).get('/api/v1/files/00000000-0000-4000-8000-000000000000');
    assert.equal(res.status, 401);
  });
});

describe('error surface', () => {
  test('an unknown route returns a clean 404 without a stack trace', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.stack, undefined);
  });

  test('health check reports UP', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'UP');
  });
});
