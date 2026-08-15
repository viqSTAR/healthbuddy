/**
 * Ordering straight from a prescription.
 *
 * Deliberately not the cart: the doctor already decided what, so the patient
 * decides only where it goes and how to pay, in a single call. The assertions
 * that matter most are the refusals — a basket must never become a way to
 * obtain something the doctor did not write, and a re-quote must never be a way
 * to change the drugs.
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

const PINCODE = '400058';

const saveAddress = async (token: string) => {
  const res = await request(app)
    .post('/api/v1/patients/me/addresses')
    .set(auth(token))
    .send({ label: 'HOME', line1: '3 Prescription Way', city: 'Mumbai', pincode: PINCODE });
  assert.equal(res.status, 201, res.text);
  return res.body.address.id as string;
};

/**
 * Runs a real consultation and issues a prescription from the local catalogue.
 *
 * Prescribed by catalogue id rather than by name on purpose: a hand-typed drug
 * has no catalogue entry, so it cannot be priced or checked against the
 * telemedicine lists, and the basket correctly refuses to quote it. Naming the
 * drugs as free text would test nothing but that refusal.
 */
const consultAndPrescribe = async (patientToken: string) => {
  const catalogue = await request(app)
    .get('/api/v1/pharmacy/medicines')
    .query({ pincode: PINCODE, limit: 50 })
    .set(auth(patientToken));

  const stocked = (catalogue.body.medicines as {
    id: string;
    name: string;
    soldBy: unknown;
    requiresPrescription: boolean;
  }[]).filter((m) => m.soldBy && !m.requiresPrescription);

  assert.ok(stocked.length >= 2, 'seed data required — run `npm run seed`');

  // Via the shared helper rather than a hand-rolled query: it already knows
  // that a slot must be in the *future* to be bookable, and duplicating that
  // rule here got it wrong — the earliest AVAILABLE slot is usually in the past.
  const slot = await anAvailableSlot();
  const doctorId = slot.doctorId;

  const booked = await request(app)
    .post('/api/v1/appointments/book')
    .set(auth(patientToken))
    .send({ doctorId, slotId: slot.id, type: 'VIDEO', symptoms: 'Sore throat' });
  assert.equal(booked.status, 201, booked.text);

  const owner = await prisma.doctor.findUniqueOrThrow({
    where: { id: doctorId },
    select: { user: { select: { phoneNumber: true } } },
  });
  const doctorSession = await loginOnce(owner.user.phoneNumber);

  const rx = await request(app)
    .post('/api/v1/prescriptions')
    .set(auth(doctorSession.accessToken))
    .send({
      appointmentId: booked.body.appointment.id,
      diagnosis: 'Acute pharyngitis',
      medicines: stocked.slice(0, 2).map((m) => ({
        medicineId: m.id,
        name: m.name,
        dosage: '1 tablet',
        frequency: 'Twice daily',
        durationDays: 3,
      })),
    });
  assert.equal(rx.status, 201, rx.text);

  return { prescriptionId: rx.body.prescription.id as string, medicineCount: 2 };
};

/** The basket is built after the prescription is written, so it is polled for. */
const waitForOffer = async (token: string, prescriptionId: string) => {
  for (let attempt = 0; attempt < 15; attempt++) {
    const mine = await request(app).get('/api/v1/fulfilment/mine').set(auth(token));
    const offer = (mine.body.fulfilments as { id: string; prescriptionId: string }[]).find(
      (f) => f.prescriptionId === prescriptionId
    );
    if (offer) return offer as { id: string; prescriptionId: string; status: string; grandTotal: number };
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('no basket was offered for the prescription');
};

describe('ordering from a prescription', () => {
  test('a basket is offered without the patient asking for one', async () => {
    const patient = await login();
    const { prescriptionId, medicineCount } = await consultAndPrescribe(patient.accessToken);

    const offer = await waitForOffer(patient.accessToken, prescriptionId);

    assert.equal(offer.status, 'PENDING_CONSENT');
    assert.ok(offer.grandTotal > 0, 'the basket should be priced');

    const detail = await request(app)
      .get(`/api/v1/fulfilment/${offer.id}`)
      .set(auth(patient.accessToken));

    assert.equal(detail.status, 200, detail.text);
    assert.equal(detail.body.fulfilment.medicines.length, medicineCount);
    assert.ok(
      detail.body.fulfilment.medicines.every((m: { unavailableReason?: string }) => !m.unavailableReason),
      'catalogue-linked drugs should all be orderable'
    );
  });

  test('one call carries the address and the payment method', async () => {
    const patient = await login();
    const addressId = await saveAddress(patient.accessToken);
    const { prescriptionId } = await consultAndPrescribe(patient.accessToken);
    const offer = await waitForOffer(patient.accessToken, prescriptionId);

    const placed = await request(app)
      .post(`/api/v1/fulfilment/${offer.id}/consent`)
      .set(auth(patient.accessToken))
      .send({ addressId, paymentMethod: 'COD' });

    assert.ok(placed.status === 200 || placed.status === 201, placed.text);

    const orders = await request(app).get('/api/v1/pharmacy/my-orders').set(auth(patient.accessToken));
    const order = (orders.body.orders as { address: string }[])[0];
    assert.ok(order, 'consent should have produced a medicine order');

    // The saved address is copied onto the order, not referenced.
    assert.match(order.address, /3 Prescription Way/);
  });

  test('consent without any address is refused', async () => {
    const patient = await login();
    const { prescriptionId } = await consultAndPrescribe(patient.accessToken);
    const offer = await waitForOffer(patient.accessToken, prescriptionId);

    const res = await request(app)
      .post(`/api/v1/fulfilment/${offer.id}/consent`)
      .set(auth(patient.accessToken))
      .send({ paymentMethod: 'UPI' });

    assert.equal(res.status, 400);
  });

  test('another patient cannot consent to it', async () => {
    const patient = await login();
    const { prescriptionId } = await consultAndPrescribe(patient.accessToken);
    const offer = await waitForOffer(patient.accessToken, prescriptionId);

    const stranger = await login();
    const addressId = await saveAddress(stranger.accessToken);

    const res = await request(app)
      .post(`/api/v1/fulfilment/${offer.id}/consent`)
      .set(auth(stranger.accessToken))
      .send({ addressId, paymentMethod: 'COD' });

    // 404, not 403: fulfilment ids must not be probeable.
    assert.equal(res.status, 404);
  });

  test('ordering the same basket twice is refused', async () => {
    const patient = await login();
    const addressId = await saveAddress(patient.accessToken);
    const { prescriptionId } = await consultAndPrescribe(patient.accessToken);
    const offer = await waitForOffer(patient.accessToken, prescriptionId);

    const first = await request(app)
      .post(`/api/v1/fulfilment/${offer.id}/consent`)
      .set(auth(patient.accessToken))
      .send({ addressId, paymentMethod: 'COD' });
    assert.ok(first.status === 200 || first.status === 201, first.text);

    const second = await request(app)
      .post(`/api/v1/fulfilment/${offer.id}/consent`)
      .set(auth(patient.accessToken))
      .send({ addressId, paymentMethod: 'COD' });

    assert.equal(second.status, 409);
  });
});

describe('re-quoting a lapsed prescription', () => {
  test('a live offer is returned unchanged rather than silently re-priced', async () => {
    const patient = await login();
    const { prescriptionId } = await consultAndPrescribe(patient.accessToken);
    const offer = await waitForOffer(patient.accessToken, prescriptionId);

    const res = await request(app)
      .post(`/api/v1/fulfilment/prescription/${prescriptionId}/reorder`)
      .set(auth(patient.accessToken));

    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.fulfilment.id, offer.id, 'a live offer must not be rebuilt underfoot');
  });

  test('an expired offer can be re-quoted without going back to the doctor', async () => {
    const patient = await login();
    const { prescriptionId, medicineCount } = await consultAndPrescribe(patient.accessToken);
    const offer = await waitForOffer(patient.accessToken, prescriptionId);

    // Age the offer out, exactly as the expiry job would.
    await prisma.prescriptionFulfilment.update({
      where: { id: offer.id },
      data: { status: 'EXPIRED', expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await request(app)
      .post(`/api/v1/fulfilment/prescription/${prescriptionId}/reorder`)
      .set(auth(patient.accessToken));

    assert.equal(res.status, 200, res.text);
    assert.notEqual(res.body.fulfilment.id, offer.id, 'a fresh basket should be issued');
    assert.equal(res.body.fulfilment.status, 'PENDING_CONSENT');

    // Re-quoting re-prices; it must never change which drugs were prescribed.
    assert.equal(res.body.fulfilment.medicines.length, medicineCount);
  });

  test('a prescription already ordered cannot be re-quoted', async () => {
    const patient = await login();
    const addressId = await saveAddress(patient.accessToken);
    const { prescriptionId } = await consultAndPrescribe(patient.accessToken);
    const offer = await waitForOffer(patient.accessToken, prescriptionId);

    const placed = await request(app)
      .post(`/api/v1/fulfilment/${offer.id}/consent`)
      .set(auth(patient.accessToken))
      .send({ addressId, paymentMethod: 'COD' });
    assert.ok(placed.status === 200 || placed.status === 201, placed.text);

    const res = await request(app)
      .post(`/api/v1/fulfilment/prescription/${prescriptionId}/reorder`)
      .set(auth(patient.accessToken));

    assert.equal(res.status, 409);
  });

  test("a stranger cannot re-quote someone else's prescription", async () => {
    const patient = await login();
    const { prescriptionId } = await consultAndPrescribe(patient.accessToken);
    await waitForOffer(patient.accessToken, prescriptionId);

    const stranger = await login();
    const res = await request(app)
      .post(`/api/v1/fulfilment/prescription/${prescriptionId}/reorder`)
      .set(auth(stranger.accessToken));

    // 404, not 403: prescription ids must not be probeable.
    assert.equal(res.status, 404);
  });
});
