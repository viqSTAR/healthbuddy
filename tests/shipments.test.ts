/**
 * Orders that span more than one pharmacy.
 *
 * A basket is filled line by line from whichever shop has each item cheapest
 * and in stock, so a single order can involve several shops. These tests lock
 * down the three things that were wrong when the order pretended to have one
 * pharmacy: the parcels must partition the basket exactly, a shop must only
 * ever see and act on its own parcel, and the settlement must credit each shop
 * for its own goods rather than paying one of them for everyone's.
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

/** A pincode two seeded pharmacies both serve, with different shelves. */
const SPLIT_PINCODE = '400058';
const UNSERVED_PINCODE = '560001';

const saveAddress = async (token: string, pincode: string) => {
  const res = await request(app)
    .post('/api/v1/patients/me/addresses')
    .set(auth(token))
    .send({ label: 'HOME', line1: '12 Test Road', city: 'Testville', pincode });
  assert.equal(res.status, 201, res.text);
  return res.body.address as { id: string; pincode: string; isDefault: boolean };
};

/** Two medicines at `pincode` that are stocked by different shops. */
const medicinesFromDifferentShops = async (token: string) => {
  const res = await request(app)
    .get('/api/v1/pharmacy/medicines')
    .query({ pincode: SPLIT_PINCODE, limit: 50 })
    .set(auth(token));
  assert.equal(res.status, 200, res.text);

  const stocked = (res.body.medicines as {
    id: string;
    name: string;
    available: number;
    soldBy: { id: string; name: string } | null;
  }[]).filter((m) => m.soldBy && m.available > 0);

  const first = stocked[0];
  assert.ok(first, 'seed data required — run `npm run seed`');
  const other = stocked.find((m) => m.soldBy!.id !== first.soldBy!.id);
  assert.ok(
    other,
    'seed must place two pharmacies on the same pincode with different shelves — run `npm run seed`'
  );

  return { first, other };
};

describe('serviceability gates the store', () => {
  test('a pincode nobody delivers to reports unserviceable', async () => {
    const patient = await login();
    const res = await request(app)
      .get('/api/v1/pharmacy/serviceability')
      .query({ pincode: UNSERVED_PINCODE })
      .set(auth(patient.accessToken));

    assert.equal(res.status, 200);
    assert.equal(res.body.serviceable, false);
    assert.equal(res.body.pharmacyCount, 0);
  });

  test('a malformed pincode is rejected rather than treated as unserved', async () => {
    const patient = await login();
    const res = await request(app)
      .get('/api/v1/pharmacy/serviceability')
      .query({ pincode: '4000' })
      .set(auth(patient.accessToken));

    assert.equal(res.status, 400);
  });

  test('an order to an unserviceable address is refused', async () => {
    const patient = await login();
    const serviceable = await saveAddress(patient.accessToken, SPLIT_PINCODE);
    const { first } = await medicinesFromDifferentShops(patient.accessToken);
    const unserved = await saveAddress(patient.accessToken, UNSERVED_PINCODE);

    // The medicine is genuinely orderable — only the destination is the problem,
    // so a stock error here would mean the test proved nothing.
    const ok = await request(app)
      .post('/api/v1/pharmacy/orders')
      .set(auth(patient.accessToken))
      .send({ items: [{ medicineId: first.id, quantity: 1 }], addressId: serviceable.id });
    assert.equal(ok.status, 201, ok.text);

    const res = await request(app)
      .post('/api/v1/pharmacy/orders')
      .set(auth(patient.accessToken))
      .send({ items: [{ medicineId: first.id, quantity: 1 }], addressId: unserved.id });

    assert.equal(res.status, 400);
    assert.match(res.body.error, /don't deliver/i);
  });

  test('an address belonging to another patient cannot be ordered to', async () => {
    const owner = await login();
    const address = await saveAddress(owner.accessToken, SPLIT_PINCODE);

    const stranger = await login();
    const { first } = await medicinesFromDifferentShops(stranger.accessToken);

    const res = await request(app)
      .post('/api/v1/pharmacy/orders')
      .set(auth(stranger.accessToken))
      .send({ items: [{ medicineId: first.id, quantity: 1 }], addressId: address.id });

    // 404, not 403: address ids must not be probeable across accounts.
    assert.equal(res.status, 404);
  });
});

describe('an order splits into one shipment per pharmacy', () => {
  test('the parcels partition the basket exactly', async () => {
    const patient = await login();
    const address = await saveAddress(patient.accessToken, SPLIT_PINCODE);
    const { first, other } = await medicinesFromDifferentShops(patient.accessToken);

    const res = await request(app)
      .post('/api/v1/pharmacy/orders')
      .set(auth(patient.accessToken))
      .send({
        items: [
          { medicineId: first.id, quantity: 2 },
          { medicineId: other.id, quantity: 1 },
        ],
        addressId: address.id,
      });

    assert.equal(res.status, 201, res.text);
    const order = res.body.order;

    assert.equal(order.shipments.length, 2, 'two shops, two parcels');

    // Every line lands in exactly one parcel, and the parcels sum to the order.
    const lineCount = order.shipments.reduce(
      (n: number, s: { items: unknown[] }) => n + s.items.length,
      0
    );
    assert.equal(lineCount, 2);

    /**
     * Compared in integer paise, which is the unit the settlement is actually
     * computed in. Summing the rupee values as JS numbers reintroduces exactly
     * the drift the Decimal columns removed — 251.99999999999997 is not 252.
     */
    const paise = (v: unknown) => Math.round(Number(v) * 100);
    const subtotals = order.shipments.reduce(
      (total: number, s: { subtotal: unknown }) => total + paise(s.subtotal),
      0
    );
    assert.equal(
      subtotals,
      paise(order.totalAmount),
      `parcels ${subtotals}p must sum to order ${paise(order.totalAmount)}p`
    );

    // Each parcel belongs to a different shop.
    const shops = new Set(order.shipments.map((s: { pharmacyId: string }) => s.pharmacyId));
    assert.equal(shops.size, 2);
  });

  test('the delivered address is copied, not referenced', async () => {
    const patient = await login();
    const address = await saveAddress(patient.accessToken, SPLIT_PINCODE);
    const { first } = await medicinesFromDifferentShops(patient.accessToken);

    const placed = await request(app)
      .post('/api/v1/pharmacy/orders')
      .set(auth(patient.accessToken))
      .send({ items: [{ medicineId: first.id, quantity: 1 }], addressId: address.id });
    assert.equal(placed.status, 201, placed.text);
    const originalAddress = placed.body.order.address as string;
    assert.match(originalAddress, /12 Test Road/);

    // Editing the book entry afterwards must not rewrite where the order went.
    await request(app)
      .patch(`/api/v1/patients/me/addresses/${address.id}`)
      .set(auth(patient.accessToken))
      .send({ line1: '99 Somewhere Else' });

    const reread = await request(app)
      .get(`/api/v1/pharmacy/my-orders/${placed.body.order.id}`)
      .set(auth(patient.accessToken));

    assert.equal(reread.body.order.address, originalAddress);
  });

  test("a pharmacy's queue contains only its own parcels", async () => {
    const patient = await login();
    const address = await saveAddress(patient.accessToken, SPLIT_PINCODE);
    const { first, other } = await medicinesFromDifferentShops(patient.accessToken);

    const placed = await request(app)
      .post('/api/v1/pharmacy/orders')
      .set(auth(patient.accessToken))
      .send({
        items: [
          { medicineId: first.id, quantity: 1 },
          { medicineId: other.id, quantity: 1 },
        ],
        addressId: address.id,
      });
    assert.equal(placed.status, 201, placed.text);

    const shipments = placed.body.order.shipments as { id: string; pharmacyId: string }[];
    const target = shipments[0]!;

    const owner = await prisma.pharmacy.findUniqueOrThrow({
      where: { id: target.pharmacyId },
      select: { user: { select: { phoneNumber: true } } },
    });
    const partner = await loginOnce(owner.user.phoneNumber);

    const queue = await request(app)
      .get('/api/v1/pharmacy/shipments')
      .set(auth(partner.accessToken));
    assert.equal(queue.status, 200, queue.text);

    const ids = (queue.body.shipments as { id: string; pharmacyId: string }[]).map((s) => s.id);
    assert.ok(ids.includes(target.id), 'its own parcel is listed');

    const foreign = shipments.find((s) => s.pharmacyId !== target.pharmacyId)!;
    assert.ok(!ids.includes(foreign.id), "another shop's parcel must never appear");

    // And it cannot reach the other shop's parcel by id either.
    const reach = await request(app)
      .patch(`/api/v1/pharmacy/shipments/${foreign.id}/status`)
      .set(auth(partner.accessToken))
      .send({ status: 'ACCEPTED' });
    assert.equal(reach.status, 404);
  });

  test('cancelling a parcel requires a reason', async () => {
    const patient = await login();
    const address = await saveAddress(patient.accessToken, SPLIT_PINCODE);
    const { first } = await medicinesFromDifferentShops(patient.accessToken);

    const placed = await request(app)
      .post('/api/v1/pharmacy/orders')
      .set(auth(patient.accessToken))
      .send({ items: [{ medicineId: first.id, quantity: 1 }], addressId: address.id });

    const shipment = placed.body.order.shipments[0] as { id: string; pharmacyId: string };
    const owner = await prisma.pharmacy.findUniqueOrThrow({
      where: { id: shipment.pharmacyId },
      select: { user: { select: { phoneNumber: true } } },
    });
    const partner = await loginOnce(owner.user.phoneNumber);

    const res = await request(app)
      .patch(`/api/v1/pharmacy/shipments/${shipment.id}/status`)
      .set(auth(partner.accessToken))
      .send({ status: 'CANCELLED' });

    assert.equal(res.status, 400);
  });
});

describe('settlement follows the goods', () => {
  test('each pharmacy is credited for its own lines, and the legs sum exactly', async () => {
    const patient = await login();
    const address = await saveAddress(patient.accessToken, SPLIT_PINCODE);
    const { first, other } = await medicinesFromDifferentShops(patient.accessToken);

    const placed = await request(app)
      .post('/api/v1/pharmacy/orders')
      .set(auth(patient.accessToken))
      .send({
        items: [
          { medicineId: first.id, quantity: 2 },
          { medicineId: other.id, quantity: 1 },
        ],
        addressId: address.id,
      });
    assert.equal(placed.status, 201, placed.text);
    const order = placed.body.order;

    const checkout = await request(app)
      .post('/api/v1/payments/checkout')
      .set(auth(patient.accessToken))
      .send({ purpose: 'MEDICINE_ORDER', targetId: order.id, method: 'UPI' });
    assert.ok(checkout.status === 200 || checkout.status === 201, checkout.text);

    const confirmed = await request(app)
      .post(`/api/v1/payments/${checkout.body.paymentId}/simulate`)
      .set(auth(patient.accessToken));
    assert.equal(confirmed.status, 200, confirmed.text);

    const splits = await prisma.paymentSplit.findMany({
      where: { paymentId: checkout.body.paymentId },
      select: { payeeType: true, payeeId: true, amount: true },
    });

    const pharmacyLegs = splits.filter((s) => s.payeeType === 'PHARMACY');
    assert.equal(pharmacyLegs.length, 2, 'one settlement leg per supplying shop');

    // Every shop that shipped something is paid; nobody is paid twice.
    const shippingShops = new Set(
      (order.shipments as { pharmacyId: string }[]).map((s) => s.pharmacyId)
    );
    const paidShops = new Set(pharmacyLegs.map((l) => l.payeeId));
    assert.deepEqual([...paidShops].sort(), [...shippingShops].sort());

    // Integer paise with the platform absorbing the remainder: the legs must sum
    // to exactly what was charged. Any gap is a defect, not rounding.
    const legPaise = splits.reduce(
      (total: number, s: any) => total + Math.round(Number(s.amount) * 100),
      0
    );
    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: checkout.body.paymentId },
      select: { amount: true },
    });
    // Exact, now that amounts are Decimal rather than binary floats. The
    // comment above always claimed a gap was a defect; the assertion can
    // finally say so instead of tolerating a penny.
    assert.equal(
      legPaise,
      Math.round(Number(payment.amount) * 100),
      `legs ${legPaise}p must equal charge ${Math.round(Number(payment.amount) * 100)}p`
    );

    // The bigger shipment must earn the bigger leg — a sanity check that the
    // legs were not simply assigned to the shops in the wrong order.
    // Compared as numbers: Decimal instances do not order correctly under the
    // built-in operators, so `>=` on them silently compares something else.
    const byShop = new Map(pharmacyLegs.map((l) => [l.payeeId, Number(l.amount)]));
    const sorted = (order.shipments as { pharmacyId: string; subtotal: unknown }[])
      .slice()
      .sort((a, b) => Number(b.subtotal) - Number(a.subtotal));
    assert.ok(
      byShop.get(sorted[0]!.pharmacyId)! >= byShop.get(sorted[1]!.pharmacyId)!,
      'the shop that supplied more must be owed more'
    );
  });
});

describe('cash is settled when the last parcel arrives', () => {
  /**
   * Puts two over-the-counter medicines on two different shelves.
   *
   * These tests walk parcels all the way to DELIVERED, and dispatch is refused
   * for prescription-only stock with no prescription on file — a correct rule,
   * tested elsewhere, that would stop this test before it reached the thing it
   * is about. The seed happens to stock all its OTC lines at one shop, so
   * rather than depend on that staying true, the split is arranged here: each
   * shop is made the cheapest source of one OTC medicine, which is what routing
   * picks on.
   */
  const otcFromDifferentShops = async (token: string) => {
    const shops = await prisma.pharmacy.findMany({
      where: { isActive: true, serviceAreas: { some: { pincode: SPLIT_PINCODE } } },
      select: { id: true },
      take: 2,
    });
    assert.equal(shops.length, 2, 'seed must serve this pincode from two shops');

    const otc = await prisma.medicine.findMany({
      where: { requiresPrescription: false },
      select: { id: true },
      take: 2,
    });
    assert.equal(otc.length, 2, 'seed data required — run `npm run seed`');

    // Cheapest wins, so give each shop one clear win and one clear loss.
    const stockAt = (pharmacyId: string, medicineId: string, price: number) =>
      prisma.pharmacyInventory.upsert({
        where: { pharmacyId_medicineId: { pharmacyId, medicineId } },
        update: { price, stock: 500, reserved: 0, isActive: true },
        create: { pharmacyId, medicineId, price, stock: 500, reorderLevel: 10 },
      });

    await Promise.all([
      stockAt(shops[0]!.id, otc[0]!.id, 10),
      stockAt(shops[1]!.id, otc[0]!.id, 90),
      stockAt(shops[0]!.id, otc[1]!.id, 90),
      stockAt(shops[1]!.id, otc[1]!.id, 10),
    ]);

    const res = await request(app)
      .get('/api/v1/pharmacy/medicines')
      .query({ pincode: SPLIT_PINCODE, limit: 100 })
      .set(auth(token));
    assert.equal(res.status, 200, res.text);

    const priced = res.body.medicines as { id: string; soldBy: { id: string } | null }[];
    const first = priced.find((m) => m.id === otc[0]!.id);
    const other = priced.find((m) => m.id === otc[1]!.id);
    assert.ok(first?.soldBy && other?.soldBy, 'both medicines must be sourceable');
    assert.notEqual(first.soldBy.id, other.soldBy.id, 'the two lines must route to two shops');

    return { first, other };
  };

  /** Walks one parcel to DELIVERED as the shop that owns it. */
  const deliver = async (shipment: { id: string; pharmacyId: string }) => {
    const owner = await prisma.pharmacy.findUniqueOrThrow({
      where: { id: shipment.pharmacyId },
      select: { user: { select: { phoneNumber: true } } },
    });
    const partner = await loginOnce(owner.user.phoneNumber);

    for (const status of ['ACCEPTED', 'PROCESSING', 'DISPATCHED', 'DELIVERED']) {
      const res = await request(app)
        .patch(`/api/v1/pharmacy/shipments/${shipment.id}/status`)
        .set(auth(partner.accessToken))
        .send({ status });
      assert.equal(res.status, 200, `${status}: ${res.text}`);
    }
  };

  /**
   * The regression this guards.
   *
   * Settlement used to be attempted by the partner app, guarded on the order
   * having exactly one parcel — which is not the same as this being the last
   * parcel. A cash order filled by two shops was delivered in full and never
   * marked paid by anyone: the rider had the money, and both shops stayed
   * unsettled against it.
   */
  test('a split cash order is only paid once every parcel has arrived', async () => {
    const patient = await login();
    const address = await saveAddress(patient.accessToken, SPLIT_PINCODE);
    const { first, other } = await otcFromDifferentShops(patient.accessToken);

    const placed = await request(app)
      .post('/api/v1/pharmacy/orders')
      .set(auth(patient.accessToken))
      .send({
        items: [
          { medicineId: first.id, quantity: 1 },
          { medicineId: other.id, quantity: 1 },
        ],
        addressId: address.id,
      });
    assert.equal(placed.status, 201, placed.text);
    const order = placed.body.order;

    const checkout = await request(app)
      .post('/api/v1/payments/checkout')
      .set(auth(patient.accessToken))
      .send({ purpose: 'MEDICINE_ORDER', targetId: order.id, method: 'COD' });
    assert.ok(checkout.status === 200 || checkout.status === 201, checkout.text);

    const shipments = order.shipments as { id: string; pharmacyId: string }[];
    assert.equal(shipments.length, 2, 'this test needs a split order');

    const paymentState = async () =>
      (
        await prisma.payment.findUniqueOrThrow({
          where: { id: checkout.body.paymentId },
          select: { status: true, paidAt: true },
        })
      ).status;

    assert.equal(await paymentState(), 'PENDING', 'nothing is collected before delivery');

    await deliver(shipments[0]!);
    assert.equal(
      await paymentState(),
      'PENDING',
      'one parcel of two is not the whole order — the rider has not been everywhere yet'
    );

    await deliver(shipments[1]!);
    assert.equal(await paymentState(), 'PAID', 'the last parcel settles the cash');

    // And the shops are actually credited, not just the payment flipped.
    const splits = await prisma.paymentSplit.findMany({
      where: { paymentId: checkout.body.paymentId },
      select: { status: true },
    });
    assert.ok(splits.length > 0);
    assert.ok(
      splits.every((s) => s.status === 'SETTLED'),
      'every payee leg settles with the payment'
    );
  });

  test('a cancelled sibling does not hold the cash open forever', async () => {
    const patient = await login();
    const address = await saveAddress(patient.accessToken, SPLIT_PINCODE);
    const { first, other } = await otcFromDifferentShops(patient.accessToken);

    const placed = await request(app)
      .post('/api/v1/pharmacy/orders')
      .set(auth(patient.accessToken))
      .send({
        items: [
          { medicineId: first.id, quantity: 1 },
          { medicineId: other.id, quantity: 1 },
        ],
        addressId: address.id,
      });
    assert.equal(placed.status, 201, placed.text);

    const checkout = await request(app)
      .post('/api/v1/payments/checkout')
      .set(auth(patient.accessToken))
      .send({ purpose: 'MEDICINE_ORDER', targetId: placed.body.order.id, method: 'COD' });
    assert.ok(checkout.status === 200 || checkout.status === 201, checkout.text);

    const shipments = placed.body.order.shipments as { id: string; pharmacyId: string }[];

    // One shop cannot supply after all.
    const dropped = shipments[1]!;
    const owner = await prisma.pharmacy.findUniqueOrThrow({
      where: { id: dropped.pharmacyId },
      select: { user: { select: { phoneNumber: true } } },
    });
    const partner = await loginOnce(owner.user.phoneNumber);
    const cancelled = await request(app)
      .patch(`/api/v1/pharmacy/shipments/${dropped.id}/status`)
      .set(auth(partner.accessToken))
      .send({ status: 'CANCELLED', cancelReason: 'Out of stock' });
    assert.equal(cancelled.status, 200, cancelled.text);

    const paise = (v: unknown) => Math.round(Number(v) * 100);
    const droppedSubtotal = (placed.body.order.shipments as { id: string; subtotal: unknown }[])
      .find((s) => s.id === dropped.id)!.subtotal;
    const originalPaise = paise(placed.body.order.totalAmount);

    // The rider must not be sent to collect for goods nobody is sending.
    const afterCancel = await prisma.payment.findUniqueOrThrow({
      where: { id: checkout.body.paymentId },
      select: { status: true, amount: true },
    });
    assert.equal(afterCancel.status, 'PENDING', 'the rest of the order is still coming');
    assert.equal(
      paise(afterCancel.amount),
      originalPaise - paise(droppedSubtotal),
      'what is owed at the door drops by exactly the cancelled parcel'
    );

    // Nothing more is coming, so delivering the survivor is the end of it.
    await deliver(shipments[0]!);

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: checkout.body.paymentId },
      select: { status: true, amount: true },
    });
    assert.equal(
      payment.status,
      'PAID',
      'a cancelled parcel is finished too — the order must not wait on it'
    );

    // The surviving shop is credited; the shop that dropped out is not.
    const splits = await prisma.paymentSplit.findMany({
      where: { paymentId: checkout.body.paymentId },
      select: { payeeType: true, payeeId: true, amount: true, status: true },
    });
    const droppedLeg = splits.find(
      (s) => s.payeeType === 'PHARMACY' && s.payeeId === dropped.pharmacyId
    );
    assert.equal(droppedLeg?.status, 'REVERSED', 'the shop that cancelled is not paid');
    assert.ok(
      splits.some(
        (s) => s.payeeType === 'PHARMACY' && s.payeeId === shipments[0]!.pharmacyId && s.status === 'SETTLED'
      ),
      'the shop that delivered is paid'
    );

    // The invariant the whole split design rests on must survive a cancellation.
    const legPaise = splits
      .filter((s) => s.status !== 'REVERSED')
      .reduce((total, s) => total + paise(s.amount), 0);
    assert.equal(
      legPaise,
      paise(payment.amount),
      `live legs ${legPaise}p must equal what was collected ${paise(payment.amount)}p`
    );
  });
});
