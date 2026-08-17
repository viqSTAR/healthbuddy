/**
 * Where the parcel is, told two different ways on purpose.
 *
 * A dispatcher needs coordinates — which junction is the rider stuck at. A
 * customer needs to know their medicine is coming and roughly how far off it
 * is. Serving the second with the first puts a live dot following a stranger
 * around on somebody's phone for the length of a shift, so the exact point
 * goes to operations and the customer gets place names.
 *
 * The load-bearing assertion is the negative one: the patient's own order read
 * is serialised and searched for the coordinates the rider reported.
 */
import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { app, prisma, request, login, loginOnce, auth, cleanupTestUsers } from './helpers.js';
import { cacheStore } from '../src/config/redis.js';

after(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
  await cacheStore.disconnect();
});

const PINCODE = '400058';
/** Unmistakable digits, so a leak is findable in a JSON blob. */
const RIDER = { latitude: 19.111111, longitude: 72.222222 };

const anAgent = async () => {
  const session = await login();
  const res = await request(app)
    .post('/api/v1/agent/register')
    .set(auth(session.accessToken))
    .send({ name: 'Test Rider', pincodes: [PINCODE] });
  assert.equal(res.status, 201, res.text);

  await prisma.deliveryAgent.update({
    where: { id: res.body.agent.id },
    data: { verifiedAt: new Date(), isAvailable: true },
  });

  const refreshed = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: session.refreshToken });
  return { ...session, accessToken: refreshed.body.tokens.accessToken as string };
};

/** A parcel in transit, carried by a verified rider. */
const aParcelInTransit = async () => {
  const patient = await login();

  const address = await request(app)
    .post('/api/v1/patients/me/addresses')
    .set(auth(patient.accessToken))
    .send({ label: 'HOME', line1: '9 Rider Road', city: 'Mumbai', pincode: PINCODE });
  assert.equal(address.status, 201, address.text);

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
    .send({ items: [{ medicineId: item.id, quantity: 1 }], addressId: address.body.address.id });
  assert.equal(placed.status, 201, placed.text);

  const checkout = await request(app)
    .post('/api/v1/payments/checkout')
    .set(auth(patient.accessToken))
    .send({ purpose: 'MEDICINE_ORDER', targetId: placed.body.order.id, method: 'UPI' });
  await request(app)
    .post(`/api/v1/payments/${checkout.body.paymentId}/simulate`)
    .set(auth(patient.accessToken))
    .expect(200);

  const shipment = (placed.body.order.shipments as { id: string; pharmacyId: string }[])[0]!;
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

  const agent = await anAgent();
  await request(app)
    .post(`/api/v1/agent/jobs/${shipment.id}/claim`)
    .set(auth(agent.accessToken))
    .expect(200);
  await request(app)
    .patch(`/api/v1/agent/jobs/${shipment.id}/status`)
    .set(auth(agent.accessToken))
    .send({ status: 'DISPATCHED' })
    .expect(200);

  return { patient, agent, shipment, orderId: placed.body.order.id as string };
};

const trackedBy = async (patientToken: string, orderId: string) => {
  const res = await request(app)
    .get(`/api/v1/pharmacy/my-orders/${orderId}`)
    .set(auth(patientToken));
  assert.equal(res.status, 200, res.text);
  return res;
};

describe('the customer is told where, not exactly where', () => {
  test('a reported position never reaches the patient as coordinates', async () => {
    const { patient, agent, shipment, orderId } = await aParcelInTransit();

    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/location`)
      .set(auth(agent.accessToken))
      .send({ ...RIDER, street: 'Linking Road', locality: 'Bandra West', city: 'Mumbai' })
      .expect(200);

    const mine = await trackedBy(patient.accessToken, orderId);

    // Serialised and searched, so a nested field cannot smuggle it out.
    const body = JSON.stringify(mine.body);
    assert.ok(!body.includes('19.111111'), 'the rider latitude must not reach the customer');
    assert.ok(!body.includes('72.222222'), 'nor the longitude');
    assert.ok(!/riderLatitude|riderLongitude|assignedAgentUserId/.test(body));

    // What they do get.
    const parcel = mine.body.order.shipments[0];
    assert.equal(parcel.stage, 'OUT_FOR_DELIVERY');
    assert.equal(parcel.riderOnBoard, true);
    assert.deepEqual(
      parcel.journey.map((j: { place: string }) => j.place),
      ['Bandra West']
    );
  });

  test('standing still does not fill the trail with the same place', async () => {
    const { patient, agent, shipment, orderId } = await aParcelInTransit();

    const place = { street: 'Linking Road', locality: 'Bandra West', city: 'Mumbai' };
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post(`/api/v1/agent/jobs/${shipment.id}/location`)
        .set(auth(agent.accessToken))
        // Drifting a few metres, as a real device does while parked.
        .send({ latitude: 19.1111 + i / 100_000, longitude: 72.2222, ...place })
        .expect(200);
    }

    const mine = await trackedBy(patient.accessToken, orderId);
    assert.equal(mine.body.order.shipments[0].journey.length, 1);
  });

  test('moving to a new place appends to the trail, oldest first', async () => {
    const { patient, agent, shipment, orderId } = await aParcelInTransit();

    for (const place of [
      { locality: 'Andheri West', city: 'Mumbai' },
      { locality: 'Bandra West', city: 'Mumbai' },
      { locality: 'Dadar', city: 'Mumbai' },
    ]) {
      await request(app)
        .post(`/api/v1/agent/jobs/${shipment.id}/location`)
        .set(auth(agent.accessToken))
        .send({ ...RIDER, ...place })
        .expect(200);
    }

    const mine = await trackedBy(patient.accessToken, orderId);
    assert.deepEqual(
      mine.body.order.shipments[0].journey.map((j: { place: string }) => j.place),
      ['Andheri West', 'Bandra West', 'Dadar'],
      'so it reads as a journey rather than a jumble'
    );
  });

  test('crossing streets of one suburb reads as one place, not four', async () => {
    const { patient, agent, shipment, orderId } = await aParcelInTransit();

    // Operations wants every street; the patient is shown the suburb, so the
    // same name four times over would read like a parcel that had stopped.
    for (const street of ['Hill Road', 'Turner Road', 'Perry Road', 'Carter Road']) {
      await request(app)
        .post(`/api/v1/agent/jobs/${shipment.id}/location`)
        .set(auth(agent.accessToken))
        .send({ ...RIDER, street, locality: 'Bandra West', city: 'Mumbai' })
        .expect(200);
    }

    const mine = await trackedBy(patient.accessToken, orderId);
    assert.deepEqual(
      mine.body.order.shipments[0].journey.map((j: { place: string }) => j.place),
      ['Bandra West']
    );
  });

  test('the stage says what is happening in words a person would use', async () => {
    const { patient, orderId } = await aParcelInTransit();
    const mine = await trackedBy(patient.accessToken, orderId);
    const parcel = mine.body.order.shipments[0];

    assert.equal(parcel.stage, 'OUT_FOR_DELIVERY');
    assert.equal(parcel.stageText, 'Out for delivery.');
  });
});

describe('who may report, and when', () => {
  test('a parcel still being packed cannot be tracked', async () => {
    const { agent, shipment } = await aParcelInTransit();

    // Wind it back to packed: a rider going about their own day before
    // collection is a person, not a parcel.
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: 'PROCESSING' } });

    const res = await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/location`)
      .set(auth(agent.accessToken))
      .send(RIDER);
    assert.equal(res.status, 409, res.text);
  });

  test('another rider cannot report against this parcel', async () => {
    const { shipment } = await aParcelInTransit();
    const stranger = await anAgent();

    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/location`)
      .set(auth(stranger.accessToken))
      .send(RIDER)
      .expect(404);
  });

  test('a patient cannot post a position for their own order', async () => {
    const { patient, shipment } = await aParcelInTransit();

    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/location`)
      .set(auth(patient.accessToken))
      .send(RIDER)
      .expect(403);
  });

  test('a position off the globe is refused', async () => {
    const { agent, shipment } = await aParcelInTransit();

    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/location`)
      .set(auth(agent.accessToken))
      .send({ latitude: 200, longitude: 0 })
      .expect(400);
  });
});

describe('arriving soon', () => {
  /** Points the delivery address somewhere known so distance is measurable. */
  const anchorAddress = async (orderId: string) => {
    const order = await prisma.medicineOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: { addressId: true },
    });
    assert.ok(order.addressId, 'the order should carry its address');
    await prisma.address.update({
      where: { id: order.addressId },
      data: { latitude: 19.05, longitude: 72.85 },
    });
  };

  test('fires when the rider is close, and only once', async () => {
    const { patient, agent, shipment, orderId } = await aParcelInTransit();
    await anchorAddress(orderId);

    const near = { latitude: 19.0505, longitude: 72.8505, locality: 'Andheri West', city: 'Mumbai' };

    const first = await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/location`)
      .set(auth(agent.accessToken))
      .send(near);
    assert.equal(first.status, 200, first.text);
    assert.equal(first.body.nearlyThere, true);

    const again = await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/location`)
      .set(auth(agent.accessToken))
      .send({ ...near, locality: 'Andheri East' });
    // A phone that buzzes "arriving soon" every thirty seconds gets muted, and
    // then the notice that matters is muted too.
    assert.equal(again.body.nearlyThere, false);

    const mine = await trackedBy(patient.accessToken, orderId);
    assert.equal(mine.body.order.shipments[0].stage, 'ARRIVING_SOON');
  });

  test('a rider still across town does not trigger it', async () => {
    const { agent, shipment, orderId } = await aParcelInTransit();
    await anchorAddress(orderId);

    const res = await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/location`)
      // Roughly 15 km out.
      .set(auth(agent.accessToken))
      .send({ latitude: 19.18, longitude: 72.85, locality: 'Borivali', city: 'Mumbai' });
    assert.equal(res.body.nearlyThere, false);
  });
});

/**
 * The stage above needs a destination, and a typed address has none — which made
 * "arriving soon" correct code that never ran for most orders. A rider at the
 * door is the fix that address never had.
 */
describe('the first delivery teaches where the door is', () => {
  const addressOf = async (orderId: string) => {
    const order = await prisma.medicineOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: { addressId: true },
    });
    assert.ok(order.addressId);
    return prisma.address.findUniqueOrThrow({ where: { id: order.addressId } });
  };

  const deliver = (token: string, shipmentId: string) =>
    request(app)
      .patch(`/api/v1/agent/jobs/${shipmentId}/status`)
      .set(auth(token))
      .send({ status: 'DELIVERED' });

  test('an unpinned address takes the position it was handed over at', async () => {
    const { agent, shipment, orderId } = await aParcelInTransit();

    const before = await addressOf(orderId);
    assert.equal(before.latitude, null, 'a typed address starts with no point');

    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/location`)
      .set(auth(agent.accessToken))
      .send({ ...RIDER, locality: 'Andheri West', city: 'Mumbai' })
      .expect(200);

    const done = await deliver(agent.accessToken, shipment.id);
    assert.equal(done.status, 200, done.text);

    const after = await addressOf(orderId);
    assert.equal(after.latitude, RIDER.latitude);
    assert.equal(after.longitude, RIDER.longitude);
  });

  test('an address the patient pinned themselves is left alone', async () => {
    const { agent, shipment, orderId } = await aParcelInTransit();

    const address = await addressOf(orderId);
    await prisma.address.update({
      where: { id: address.id },
      data: { latitude: 19.05, longitude: 72.85 },
    });

    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/location`)
      .set(auth(agent.accessToken))
      // A rider marking it delivered from the lobby, or from the wrong building.
      .send(RIDER)
      .expect(200);
    await deliver(agent.accessToken, shipment.id).expect(200);

    const after = await addressOf(orderId);
    assert.equal(after.latitude, 19.05, 'a good point must not be dragged by a delivery');
  });

  test('a stale fix is not mistaken for the door', async () => {
    const { agent, shipment, orderId } = await aParcelInTransit();

    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/location`)
      .set(auth(agent.accessToken))
      .send(RIDER)
      .expect(200);

    // A rider who marks a stack of parcels delivered back at the shop, hours
    // after they last reported, would otherwise stamp the address with the shop.
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { riderSeenAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    await deliver(agent.accessToken, shipment.id).expect(200);

    const after = await addressOf(orderId);
    assert.equal(after.latitude, null);
  });

  test('the rider position does not outlive the parcel', async () => {
    const { agent, shipment } = await aParcelInTransit();

    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/location`)
      .set(auth(agent.accessToken))
      .send(RIDER)
      .expect(200);
    await deliver(agent.accessToken, shipment.id).expect(200);

    // It exists so a dispatcher can see a live parcel. Once handed over it is
    // only a record of where a named person stood.
    const parcel = await prisma.shipment.findUniqueOrThrow({
      where: { id: shipment.id },
      select: { riderLatitude: true, riderSeenAt: true, places: true },
    });
    assert.equal(parcel.riderLatitude, null);
    assert.equal(parcel.riderSeenAt, null);
    assert.equal(parcel.places.length, 1, 'the named places are the delivery record and stay');
  });
});
