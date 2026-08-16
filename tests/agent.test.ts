/**
 * The rider's half of the platform.
 *
 * Two kinds of work reach an agent by two different routes on purpose: a
 * sealed parcel sits in an open pool for whoever is free, while collecting a
 * sample is handed out by the lab that trained the collector. The assertions
 * that matter most are about what an unclaimed job is allowed to say. A pool
 * that names the patient hands every rider in the city the address of everyone
 * waiting on medicine, so the name, the phone number and the door number must
 * not appear until the job actually belongs to someone.
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
} from './helpers.js';
import { cacheStore } from '../src/config/redis.js';

after(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
  await cacheStore.disconnect();
});

const PINCODE = '400058';

/** A signed-in account registered and verified as a rider. */
const anAgent = async (opts: { pincodes?: string[]; verified?: boolean } = {}) => {
  const session = await login();

  const res = await request(app)
    .post('/api/v1/agent/register')
    .set(auth(session.accessToken))
    .send({
      name: 'Test Rider',
      vehicleNumber: 'MH-01-AB-1234',
      pincodes: opts.pincodes ?? [PINCODE],
    });
  assert.equal(res.status, 201, res.text);

  if (opts.verified !== false) {
    await prisma.deliveryAgent.update({
      where: { id: res.body.agent.id },
      data: { verifiedAt: new Date(), isAvailable: true },
    });
  }

  // The role changed, so the session has to be re-minted to carry it.
  const refreshed = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: session.refreshToken });
  assert.equal(refreshed.status, 200, refreshed.text);

  return {
    ...session,
    agentId: res.body.agent.id as string,
    accessToken: refreshed.body.tokens.accessToken as string,
  };
};

/** A packed parcel sitting in the pool, plus the patient it is going to. */
const aPackedParcel = async (method: 'COD' | 'UPI' = 'UPI') => {
  const patient = await login();

  const addressRes = await request(app)
    .post('/api/v1/patients/me/addresses')
    .set(auth(patient.accessToken))
    .send({ label: 'HOME', line1: '9 Rider Road', city: 'Mumbai', pincode: PINCODE });
  assert.equal(addressRes.status, 201, addressRes.text);

  const catalogue = await request(app)
    .get('/api/v1/pharmacy/medicines')
    .query({ pincode: PINCODE, limit: 50 })
    .set(auth(patient.accessToken));
  const item = (catalogue.body.medicines as {
    id: string;
    available: number;
    requiresPrescription: boolean;
    soldBy: { id: string } | null;
  }[]).find((m) => m.soldBy && m.available > 0 && !m.requiresPrescription);
  assert.ok(item, 'seed data required — run `npm run seed`');

  const placed = await request(app)
    .post('/api/v1/pharmacy/orders')
    .set(auth(patient.accessToken))
    .send({ items: [{ medicineId: item.id, quantity: 1 }], addressId: addressRes.body.address.id });
  assert.equal(placed.status, 201, placed.text);

  const checkout = await request(app)
    .post('/api/v1/payments/checkout')
    .set(auth(patient.accessToken))
    .send({ purpose: 'MEDICINE_ORDER', targetId: placed.body.order.id, method });
  assert.ok(checkout.status === 200 || checkout.status === 201, checkout.text);

  if (method === 'UPI') {
    await request(app)
      .post(`/api/v1/payments/${checkout.body.paymentId}/simulate`)
      .set(auth(patient.accessToken))
      .expect(200);
  }

  const shipment = (placed.body.order.shipments as { id: string; pharmacyId: string }[])[0]!;

  // The shop packs it, which is what puts it in the pool.
  const owner = await prisma.pharmacy.findUniqueOrThrow({
    where: { id: shipment.pharmacyId },
    select: { user: { select: { phoneNumber: true } } },
  });
  const shop = await loginOnce(owner.user.phoneNumber);
  for (const status of ['ACCEPTED', 'PROCESSING']) {
    await request(app)
      .patch(`/api/v1/pharmacy/shipments/${shipment.id}/status`)
      .set(auth(shop.accessToken))
      .send({ status })
      .expect(200);
  }

  return { patient, shipment, shop, paymentId: checkout.body.paymentId as string };
};

describe('the open pool shows work, not patients', () => {
  test('a packed parcel appears, with no name, phone or street address on it', async () => {
    const agent = await anAgent();
    const { shipment } = await aPackedParcel();

    const res = await request(app)
      .get('/api/v1/agent/jobs/available')
      .set(auth(agent.accessToken));
    assert.equal(res.status, 200, res.text);

    const job = (res.body.jobs as {
      id: string;
      collectFrom: { name: string; address: string };
      deliverToPincode: string;
    }[]).find((j) => j.id === shipment.id);
    assert.ok(job, 'a packed parcel in the rider’s area must be offered');

    // What it may say.
    assert.ok(job.collectFrom.name, 'the rider must know which shop to go to');
    assert.equal(job.deliverToPincode, PINCODE);

    // What it may not. Serialised and searched, so a nested field cannot hide.
    const body = JSON.stringify(job);
    assert.ok(!body.includes('9 Rider Road'), 'the street address must not be in the pool');
    assert.ok(!/patientName|patientPhone/.test(body), 'no patient identity in the pool');
  });

  test('a parcel outside the rider’s areas is not offered', async () => {
    const agent = await anAgent({ pincodes: ['560001'] });
    const { shipment } = await aPackedParcel();

    const res = await request(app)
      .get('/api/v1/agent/jobs/available')
      .set(auth(agent.accessToken));
    assert.equal(res.status, 200, res.text);
    assert.ok(!(res.body.jobs as { id: string }[]).some((j) => j.id === shipment.id));
  });

  test('an unverified rider is refused the pool entirely', async () => {
    const agent = await anAgent({ verified: false });
    await aPackedParcel();

    const res = await request(app)
      .get('/api/v1/agent/jobs/available')
      .set(auth(agent.accessToken));
    // Not an empty list — an explicit refusal, so the app can say why.
    assert.equal(res.status, 403, res.text);
    assert.match(res.body.error, /verified/i);
  });

  test('a patient cannot read the pool', async () => {
    const patient = await login();
    await request(app)
      .get('/api/v1/agent/jobs/available')
      .set(auth(patient.accessToken))
      .expect(403);
  });
});

describe('claiming a job', () => {
  test('the address and phone arrive only once the job is theirs', async () => {
    const agent = await anAgent();
    const { shipment } = await aPackedParcel();

    const claimed = await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/claim`)
      .set(auth(agent.accessToken));
    assert.equal(claimed.status, 200, claimed.text);

    const job = claimed.body.job;
    assert.match(job.order.address, /9 Rider Road/);
    assert.ok(job.order.patientPhone, 'the rider has to be able to ring the door');
  });

  test('only one rider gets it', async () => {
    const first = await anAgent();
    const second = await anAgent();
    const { shipment } = await aPackedParcel();

    const a = await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/claim`)
      .set(auth(first.accessToken));
    assert.equal(a.status, 200, a.text);

    const b = await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/claim`)
      .set(auth(second.accessToken));
    assert.equal(b.status, 409, 'the second rider must be told, not silently joined');

    // And the loser cannot read it by id either.
    await request(app)
      .get(`/api/v1/agent/jobs/${shipment.id}`)
      .set(auth(second.accessToken))
      .expect(404);
  });

  test('a claimed job leaves the pool', async () => {
    const agent = await anAgent();
    const { shipment } = await aPackedParcel();

    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/claim`)
      .set(auth(agent.accessToken))
      .expect(200);

    const pool = await request(app)
      .get('/api/v1/agent/jobs/available')
      .set(auth(agent.accessToken));
    assert.ok(!(pool.body.jobs as { id: string }[]).some((j) => j.id === shipment.id));
  });

  test('a job can be handed back before collection but not after', async () => {
    const agent = await anAgent();
    const { shipment } = await aPackedParcel();

    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/claim`)
      .set(auth(agent.accessToken))
      .expect(200);
    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/release`)
      .set(auth(agent.accessToken))
      .expect(200);

    // Take it again and actually collect it.
    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/claim`)
      .set(auth(agent.accessToken))
      .expect(200);
    await request(app)
      .patch(`/api/v1/agent/jobs/${shipment.id}/status`)
      .set(auth(agent.accessToken))
      .send({ status: 'DISPATCHED' })
      .expect(200);

    // The parcel is in their bag now — handing the job back would leave the
    // shop's stock walking around the city.
    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/release`)
      .set(auth(agent.accessToken))
      .expect(409);
  });
});

describe('carrying and delivering', () => {
  test('a rider cannot skip collection and jump straight to delivered', async () => {
    const agent = await anAgent();
    const { shipment } = await aPackedParcel();

    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/claim`)
      .set(auth(agent.accessToken))
      .expect(200);

    await request(app)
      .patch(`/api/v1/agent/jobs/${shipment.id}/status`)
      .set(auth(agent.accessToken))
      .send({ status: 'DELIVERED' })
      .expect(409);
  });

  test('a rider cannot touch a job that is not theirs', async () => {
    const mine = await anAgent();
    const stranger = await anAgent();
    const { shipment } = await aPackedParcel();

    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/claim`)
      .set(auth(mine.accessToken))
      .expect(200);

    await request(app)
      .patch(`/api/v1/agent/jobs/${shipment.id}/status`)
      .set(auth(stranger.accessToken))
      .send({ status: 'DISPATCHED' })
      .expect(404);
  });

  /**
   * Marking a cash order delivered is what settles it, so a tap alone must not
   * record the shop as paid for money nobody is holding.
   */
  test('cash has to be confirmed before a cash order can be delivered', async () => {
    const agent = await anAgent();
    const { shipment, paymentId } = await aPackedParcel('COD');

    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/claim`)
      .set(auth(agent.accessToken))
      .expect(200);
    await request(app)
      .patch(`/api/v1/agent/jobs/${shipment.id}/status`)
      .set(auth(agent.accessToken))
      .send({ status: 'DISPATCHED' })
      .expect(200);

    const refused = await request(app)
      .patch(`/api/v1/agent/jobs/${shipment.id}/status`)
      .set(auth(agent.accessToken))
      .send({ status: 'DELIVERED' });
    assert.equal(refused.status, 422, refused.text);
    assert.match(refused.body.error, /collected/i);

    const stillOwed = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { status: true },
    });
    assert.equal(stillOwed.status, 'PENDING', 'a refused delivery must not settle anything');

    await request(app)
      .patch(`/api/v1/agent/jobs/${shipment.id}/status`)
      .set(auth(agent.accessToken))
      .send({ status: 'DELIVERED', codCollected: true })
      .expect(200);

    const settled = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { status: true },
    });
    assert.equal(settled.status, 'PAID', 'confirming the cash settles the order');
  });

  test('a prepaid delivery needs no cash confirmation, and closes the job', async () => {
    const agent = await anAgent();
    const { shipment } = await aPackedParcel('UPI');

    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/claim`)
      .set(auth(agent.accessToken))
      .expect(200);
    await request(app)
      .patch(`/api/v1/agent/jobs/${shipment.id}/status`)
      .set(auth(agent.accessToken))
      .send({ status: 'DISPATCHED' })
      .expect(200);
    await request(app)
      .patch(`/api/v1/agent/jobs/${shipment.id}/status`)
      .set(auth(agent.accessToken))
      .send({ status: 'DELIVERED' })
      .expect(200);

    const mine = await request(app).get('/api/v1/agent/jobs/mine').set(auth(agent.accessToken));
    assert.equal(mine.status, 200, mine.text);
    assert.ok(
      !(mine.body.deliveries as { id: string }[]).some((j) => j.id === shipment.id),
      'a delivered parcel is off the rider’s list'
    );
  });
});

describe('sample collection is not a courier run', () => {
  test('a shop cannot assign a parcel to an account that is not an agent', async () => {
    const { shipment, shop } = await aPackedParcel();
    const bystander = await login();

    const res = await request(app)
      .patch(`/api/v1/pharmacy/shipments/${shipment.id}/agent`)
      .set(auth(shop.accessToken))
      .send({ agentUserId: bystander.userId });

    assert.equal(res.status, 422, res.text);
  });

  test('a rider with no lab behind them sees no pickups and cannot collect', async () => {
    const agent = await anAgent();

    const mine = await request(app).get('/api/v1/agent/jobs/mine').set(auth(agent.accessToken));
    assert.equal(mine.status, 200, mine.text);
    assert.deepEqual(mine.body.pickups, [], 'sample work needs a lab behind the collector');

    // A real lab order id would still be refused; a well-formed one is enough
    // to prove the entitlement is checked before the record is looked up.
    const res = await request(app)
      .patch(`/api/v1/agent/pickups/${'00000000-0000-4000-8000-000000000000'}/status`)
      .set(auth(agent.accessToken))
      .send({ status: 'SAMPLE_COLLECTED' });
    assert.equal(res.status, 403, res.text);
  });

  test('a lab cannot hand its samples to another lab’s collector', async () => {
    const agent = await anAgent();

    const labA = await prisma.labPartner.findFirstOrThrow({ select: { id: true } });
    await prisma.deliveryAgent.update({
      where: { id: agent.agentId },
      data: { labPartnerId: labA.id },
    });

    const labB = await prisma.labPartner.findFirstOrThrow({
      where: { id: { not: labA.id } },
      select: { id: true, user: { select: { phoneNumber: true } } },
    });

    const order = await prisma.labOrder.create({
      data: {
        patientId: (await prisma.patient.findFirstOrThrow({ select: { id: true } })).id,
        labPartnerId: labB.id,
        testName: 'Test panel',
        price: 100,
        status: 'ACCEPTED',
      },
      select: { id: true },
    });

    const labBSession = await loginOnce(labB.user.phoneNumber);
    const res = await request(app)
      .patch(`/api/v1/labs/orders/${order.id}/agent`)
      .set(auth(labBSession.accessToken))
      .send({ agentUserId: agent.userId });

    assert.equal(res.status, 403, res.text);

    await prisma.labOrder.delete({ where: { id: order.id } });
  });
});

describe('going off shift', () => {
  test('availability is the rider’s own switch', async () => {
    const agent = await anAgent();

    const off = await request(app)
      .patch('/api/v1/agent/me')
      .set(auth(agent.accessToken))
      .send({ isAvailable: false });
    assert.equal(off.status, 200, off.text);
    assert.equal(off.body.agent.isAvailable, false);

    const profile = await request(app).get('/api/v1/agent/me').set(auth(agent.accessToken));
    assert.equal(profile.body.agent.isAvailable, false);
    assert.deepEqual(profile.body.agent.serviceAreas, [PINCODE]);
  });

  test('registering twice is refused', async () => {
    const agent = await anAgent();
    const again = await request(app)
      .post('/api/v1/agent/register')
      .set(auth(agent.accessToken))
      .send({ name: 'Test Rider', pincodes: [PINCODE] });
    assert.equal(again.status, 409, again.text);
  });

  test('a pincode that is not a pincode is refused', async () => {
    const session = await login();
    await request(app)
      .post('/api/v1/agent/register')
      .set(auth(session.accessToken))
      .send({ name: 'Test Rider', pincodes: ['12'] })
      .expect(400);
  });
});
