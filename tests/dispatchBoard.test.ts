/**
 * The dispatch board has to describe the fleet that exists.
 *
 * A rider carries a parcel. The board used to read a rider column on the ORDER,
 * which nothing wrote once riders began claiming parcels from the pool — so
 * every order in flight displayed as "nobody carrying it", the roster was
 * permanently empty, and Assign wrote to a field no rider app ever read. An
 * operations screen that reports success and changes nothing is worse than no
 * screen, so the load-bearing assertion here is the last one: after an admin
 * assigns, the parcel appears in that rider's own job list.
 */
import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { app, prisma, request, login, loginAs, loginOnce, auth, cleanupTestUsers } from './helpers.js';
import { cacheStore } from '../src/config/redis.js';

after(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
  await cacheStore.disconnect();
});

const PINCODE = '400058';

const aRider = async (opts: { verified?: boolean; onShift?: boolean } = {}) => {
  const session = await login();
  const res = await request(app)
    .post('/api/v1/agent/register')
    .set(auth(session.accessToken))
    .send({ name: 'Board Rider', vehicleNumber: 'MH01ZZ9999', pincodes: [PINCODE] });
  assert.equal(res.status, 201, res.text);

  await prisma.deliveryAgent.update({
    where: { id: res.body.agent.id },
    data: {
      verifiedAt: opts.verified === false ? null : new Date(),
      isAvailable: opts.onShift ?? true,
    },
  });

  const refreshed = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: session.refreshToken });
  return { ...session, accessToken: refreshed.body.tokens.accessToken as string };
};

/** A paid order, packed by its shop and waiting for somebody to carry it. */
const aPackedParcel = async () => {
  const patient = await login();

  const address = await request(app)
    .post('/api/v1/patients/me/addresses')
    .set(auth(patient.accessToken))
    .send({ label: 'HOME', line1: '3 Board Road', city: 'Mumbai', pincode: PINCODE });
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

  return { patient, shipment, orderId: placed.body.order.id as string };
};

const boardFor = async (adminToken: string) => {
  const res = await request(app).get('/api/v1/admin/deliveries').set(auth(adminToken));
  assert.equal(res.status, 200, res.text);
  return res.body.board as {
    lanes: Record<string, {
      id: string;
      riders: { id: string; name: string | null }[];
      parcels: { id: string; rider: { id: string } | null; lastSeen: { latitude: number } | null }[];
      awaitingRider: number;
    }[]>;
    fleet: {
      id: string;
      name: string;
      onShift: boolean;
      parcels: number;
      lastSeen: { latitude: number; longitude: number; place: string | null } | null;
    }[];
    unassigned: number;
    idleRiders: number;
  };
};

const findOrder = (board: Awaited<ReturnType<typeof boardFor>>, orderId: string) =>
  Object.values(board.lanes)
    .flat()
    .find((o) => o.id === orderId);

describe('the board shows who is actually carrying the parcel', () => {
  test('a rider who claimed from the pool appears against the order', async () => {
    const admin = await loginAs('ADMIN');
    const { shipment, orderId } = await aPackedParcel();
    const rider = await aRider();

    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/claim`)
      .set(auth(rider.accessToken))
      .expect(200);

    const order = findOrder(await boardFor(admin.accessToken), orderId);
    assert.ok(order, 'the order should be on the board');
    assert.equal(order.riders.length, 1, 'this read empty for every order on the platform');
    assert.equal(order.riders[0]!.name, 'Board Rider');
    assert.equal(order.parcels[0]!.rider?.id, rider.userId);
    assert.equal(order.awaitingRider, 0);
  });

  test('a packed parcel nobody has taken counts as unassigned', async () => {
    const admin = await loginAs('ADMIN');
    const { orderId } = await aPackedParcel();

    const board = await boardFor(admin.accessToken);
    const order = findOrder(board, orderId);
    assert.equal(order?.awaitingRider, 1);
    assert.ok(board.unassigned >= 1);
  });

  test('the exact position is on this screen and no other', async () => {
    const admin = await loginAs('ADMIN');
    const { shipment, orderId } = await aPackedParcel();
    const rider = await aRider();

    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/claim`)
      .set(auth(rider.accessToken))
      .expect(200);
    await request(app)
      .patch(`/api/v1/agent/jobs/${shipment.id}/status`)
      .set(auth(rider.accessToken))
      .send({ status: 'DISPATCHED' })
      .expect(200);
    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/location`)
      .set(auth(rider.accessToken))
      .send({ latitude: 19.111111, longitude: 72.222222, locality: 'Bandra West', city: 'Mumbai' })
      .expect(200);

    const board = await boardFor(admin.accessToken);
    const parcel = findOrder(board, orderId)!.parcels[0]!;
    // The dispatcher gets the junction. The customer gets "Bandra West" — see
    // riderLocation.test.ts for the other half of this bargain.
    assert.equal(parcel.lastSeen?.latitude, 19.111111);

    const onRoster = board.fleet.find((r) => r.id === rider.userId);
    assert.equal(onRoster?.lastSeen?.place, 'Bandra West');
  });
});

describe('the roster', () => {
  test('a rider clocked on with an empty bag is capacity, and is listed', async () => {
    const admin = await loginAs('ADMIN');
    const rider = await aRider({ onShift: true });

    const board = await boardFor(admin.accessToken);
    const idle = board.fleet.find((r) => r.id === rider.userId);
    assert.ok(idle, 'a rider on shift carrying nothing is exactly who a dispatcher wants');
    assert.equal(idle.parcels, 0);
    assert.ok(board.idleRiders >= 1);
  });

  test('a rider nobody has verified is not on it', async () => {
    const admin = await loginAs('ADMIN');
    const rider = await aRider({ verified: false });

    const board = await boardFor(admin.accessToken);
    assert.equal(board.fleet.find((r) => r.id === rider.userId), undefined);
  });
});

describe('assigning from the panel', () => {
  const assign = (token: string, orderId: string, body: Record<string, unknown>) =>
    request(app).post(`/api/v1/admin/orders/${orderId}/agent`).set(auth(token)).send(body);

  test('the parcel turns up in that rider’s own job list', async () => {
    const admin = await loginAs('ADMIN');
    const { shipment, orderId } = await aPackedParcel();
    const rider = await aRider();

    const res = await assign(admin.accessToken, orderId, { agentUserId: rider.userId });
    assert.equal(res.status, 200, res.text);

    // The whole point. This used to write an order column the rider's app never
    // read, so an operator could press Assign, see it succeed, and the parcel
    // would appear in nobody's list.
    const mine = await request(app)
      .get('/api/v1/agent/jobs/mine')
      .set(auth(rider.accessToken))
      .expect(200);
    assert.deepEqual(
      (mine.body.deliveries as { id: string }[]).map((d) => d.id),
      [shipment.id]
    );
  });

  test('taking it back clears the parcel, not a column nobody reads', async () => {
    const admin = await loginAs('ADMIN');
    const { shipment, orderId } = await aPackedParcel();
    const rider = await aRider();

    await assign(admin.accessToken, orderId, { agentUserId: rider.userId }).expect(200);
    await assign(admin.accessToken, orderId, { agentUserId: null }).expect(200);

    const parcel = await prisma.shipment.findUniqueOrThrow({
      where: { id: shipment.id },
      select: { assignedAgentUserId: true },
    });
    assert.equal(parcel.assignedAgentUserId, null);

    const mine = await request(app)
      .get('/api/v1/agent/jobs/mine')
      .set(auth(rider.accessToken))
      .expect(200);
    assert.equal((mine.body.deliveries as unknown[]).length, 0);
  });

  test('an unverified rider is refused, because the picker is not the only guard', async () => {
    const admin = await loginAs('ADMIN');
    const { orderId } = await aPackedParcel();
    const rider = await aRider({ verified: false });

    const res = await assign(admin.accessToken, orderId, { agentUserId: rider.userId });
    assert.equal(res.status, 422, res.text);
  });

  test('a delivered order cannot be handed to anyone', async () => {
    const admin = await loginAs('ADMIN');
    const { shipment, orderId } = await aPackedParcel();
    const rider = await aRider();

    await request(app)
      .post(`/api/v1/agent/jobs/${shipment.id}/claim`)
      .set(auth(rider.accessToken))
      .expect(200);
    for (const status of ['DISPATCHED', 'DELIVERED']) {
      await request(app)
        .patch(`/api/v1/agent/jobs/${shipment.id}/status`)
        .set(auth(rider.accessToken))
        .send({ status })
        .expect(200);
    }

    const res = await assign(admin.accessToken, orderId, { agentUserId: rider.userId });
    assert.equal(res.status, 409, res.text);
  });
});
