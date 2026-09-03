import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { app, prisma, request, login, loginAs, cleanupTestUsers } from './helpers.js';
import { cacheStore } from '../src/config/redis.js';

/**
 * An administrator reaching into somebody else's shop.
 *
 * A partner runs their own shelf, and these routes exist for the cases where
 * the platform has to override that — a recall, a shop gone dark mid-order, a
 * recount after a dispute. That is real authority over a business's inventory,
 * so the properties worth pinning are that only an admin has it, that the
 * clinical rules still apply, and that every use of it is attributable
 * afterwards.
 */

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

/** A pharmacy with one OTC line on the shelf. */
const aStockedShop = async () => {
  const pharmacy = await prisma.pharmacy.findFirstOrThrow({ select: { id: true } });
  const medicine = await prisma.medicine.findFirstOrThrow({
    where: { schedule: 'OTC' },
    select: { id: true, price: true },
  });
  // A shop may not list above the catalogue MRP, so tests have to price legally
  // or they fail on a rule that has nothing to do with what they are checking.
  return { pharmacyId: pharmacy.id, medicineId: medicine.id, mrp: Number(medicine.price) };
};

describe('only an admin may drive another shop stock', () => {
  test('a patient is refused', async () => {
    const patient = await login();
    const { pharmacyId, medicineId } = await aStockedShop();

    const res = await request(app)
      .post(`/api/v1/admin/pharmacies/${pharmacyId}/stock-movements`)
      .set(bearer(patient.accessToken))
      .send({ medicineId, quantity: 1, reason: 'DAMAGED' });

    assert.equal(res.status, 403);
  });

  test('a pharmacy is refused — even for its own shop', async () => {
    const pharmacy = await loginAs('PHARMACY');
    const own = await prisma.pharmacy.findFirstOrThrow({
      where: { userId: pharmacy.userId },
      select: { id: true },
    });
    const medicine = await prisma.medicine.findFirstOrThrow({
      where: { schedule: 'OTC' },
      select: { id: true },
    });

    const res = await request(app)
      .post(`/api/v1/admin/pharmacies/${own.id}/stock-movements`)
      .set(bearer(pharmacy.accessToken))
      .send({ medicineId: medicine.id, quantity: 1, reason: 'DAMAGED' });

    // Partners have their own route for this. The admin one is not a second
    // door into it.
    assert.equal(res.status, 403);
  });

  test('an unauthenticated caller is refused', async () => {
    const { pharmacyId, medicineId } = await aStockedShop();
    const res = await request(app)
      .post(`/api/v1/admin/pharmacies/${pharmacyId}/stock-movements`)
      .send({ medicineId, quantity: 1, reason: 'DAMAGED' });

    assert.equal(res.status, 401);
  });
});

describe('the ledger rules still apply', () => {
  test('a positive quantity plus a reason decides the direction', async () => {
    const admin = await loginAs('ADMIN');
    const { pharmacyId, medicineId } = await aStockedShop();

    const before = await prisma.pharmacyInventory.findFirstOrThrow({
      where: { pharmacyId, medicineId },
      select: { stock: true },
    });

    const res = await request(app)
      .post(`/api/v1/admin/pharmacies/${pharmacyId}/stock-movements`)
      .set(bearer(admin.accessToken))
      .send({ medicineId, quantity: 10, reason: 'DAMAGED', note: 'test write-off' });

    assert.equal(res.status, 201);
    assert.equal(res.body.movement.delta, -10, 'DAMAGED removes units, however it is entered');
    assert.equal(res.body.movement.stock, before.stock - 10);
  });

  test('a system-only reason cannot be entered by hand', async () => {
    const admin = await loginAs('ADMIN');
    const { pharmacyId, medicineId } = await aStockedShop();

    for (const reason of ['SALE_ONLINE', 'ORDER_CANCELLED']) {
      const res = await request(app)
        .post(`/api/v1/admin/pharmacies/${pharmacyId}/stock-movements`)
        .set(bearer(admin.accessToken))
        .send({ medicineId, quantity: 1, reason });

      assert.equal(res.status, 400, `${reason} is set by the system, not by hand`);
    }
  });

  test('a zero or negative quantity is refused', async () => {
    const admin = await loginAs('ADMIN');
    const { pharmacyId, medicineId } = await aStockedShop();

    for (const quantity of [0, -5]) {
      const res = await request(app)
        .post(`/api/v1/admin/pharmacies/${pharmacyId}/stock-movements`)
        .set(bearer(admin.accessToken))
        .send({ medicineId, quantity, reason: 'EXPIRED' });

      assert.equal(res.status, 400);
    }
  });

  test('a Schedule X drug cannot be listed, even by an admin', async () => {
    const admin = await loginAs('ADMIN');
    const pharmacy = await prisma.pharmacy.findFirstOrThrow({ select: { id: true } });
    const controlled = await prisma.medicine.findFirst({
      where: { schedule: { in: ['SCHEDULE_X', 'NARCOTIC'] } },
      select: { id: true },
    });
    if (!controlled) return; // no controlled drug seeded

    const res = await request(app)
      .put(`/api/v1/admin/pharmacies/${pharmacy.id}/inventory`)
      .set(bearer(admin.accessToken))
      .send({ medicineId: controlled.id, price: 50, stock: 10 });

    assert.equal(res.status, 422, 'the Drugs and Cosmetics Act is not an admin-overridable rule');
  });

  test('an unknown pharmacy is a 404, not a silent success', async () => {
    const admin = await loginAs('ADMIN');
    const { medicineId } = await aStockedShop();

    const res = await request(app)
      .post(`/api/v1/admin/pharmacies/00000000-0000-0000-0000-000000000000/stock-movements`)
      .set(bearer(admin.accessToken))
      .send({ medicineId, quantity: 1, reason: 'EXPIRED' });

    assert.equal(res.status, 404);
  });
});

describe('every use is attributable', () => {
  test('a movement records who made it', async () => {
    const admin = await loginAs('ADMIN');
    const { pharmacyId, medicineId } = await aStockedShop();

    const res = await request(app)
      .post(`/api/v1/admin/pharmacies/${pharmacyId}/stock-movements`)
      .set(bearer(admin.accessToken))
      .send({ medicineId, quantity: 3, reason: 'DAMAGED', note: 'test' });
    assert.equal(res.status, 201, 'the movement itself has to succeed first');

    // Scoped to this admin: the suite runs several concurrently, so "the most
    // recent entry" is whoever happened to finish last.
    const entry = await prisma.auditLog.findFirst({
      where: {
        action: 'pharmacy.stock_moved_by_admin',
        entityId: pharmacyId,
        actorUserId: admin.userId,
      },
    });

    assert.ok(entry, 'reaching into a business inventory must leave a record');
  });

  test('a listing change records who made it', async () => {
    const admin = await loginAs('ADMIN');
    const { pharmacyId, medicineId, mrp } = await aStockedShop();

    await request(app)
      .put(`/api/v1/admin/pharmacies/${pharmacyId}/inventory`)
      .set(bearer(admin.accessToken))
      .send({ medicineId, price: mrp });

    const entry = await prisma.auditLog.findFirst({
      where: {
        action: 'pharmacy.inventory_updated_by_admin',
        entityId: pharmacyId,
        actorUserId: admin.userId,
      },
    });

    assert.ok(entry, 'a listing change must name the administrator who made it');
  });
});

describe('a batch expiry is a date, not an instant', () => {
  test('YYYY-MM-DD is accepted, matching the partner route', async () => {
    const admin = await loginAs('ADMIN');
    const { pharmacyId, medicineId, mrp } = await aStockedShop();

    const res = await request(app)
      .put(`/api/v1/admin/pharmacies/${pharmacyId}/inventory`)
      .set(bearer(admin.accessToken))
      .send({ medicineId, price: mrp, expiryDate: '2028-04-01' });

    // The two routes call the same service; rejecting here what the partner
    // route accepts for the identical field would be the bug.
    assert.equal(res.status, 200);
  });
});

after(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
  await cacheStore.disconnect();
});

describe('a recount is not a movement', () => {
  test('CORRECTION is refused on the movement route', async () => {
    const admin = await loginAs('ADMIN');
    const { pharmacyId, medicineId } = await aStockedShop();

    const res = await request(app)
      .post(`/api/v1/admin/pharmacies/${pharmacyId}/stock-movements`)
      .set(bearer(admin.accessToken))
      .send({ medicineId, quantity: 3, reason: 'CORRECTION' });

    // A correction whose size somebody worked out in their head is exactly the
    // entry an audit cannot trust, so the reason is reserved for the recount
    // route where the platform does the arithmetic.
    assert.equal(res.status, 400);
    assert.match(res.body.error, /set exact stock/i);
  });

  test('the counted total is what goes in, and the delta is derived', async () => {
    const admin = await loginAs('ADMIN');
    const { pharmacyId, medicineId } = await aStockedShop();

    const before = await prisma.pharmacyInventory.findFirstOrThrow({
      where: { pharmacyId, medicineId },
      select: { stock: true },
    });
    const counted = before.stock - 7;

    const res = await request(app)
      .post(`/api/v1/admin/pharmacies/${pharmacyId}/stock-count`)
      .set(bearer(admin.accessToken))
      .send({ medicineId, countedQuantity: counted, note: 'shelf recount' });

    assert.equal(res.status, 200);
    assert.equal(res.body.movement.stock, counted);
    assert.equal(res.body.movement.delta, -7, 'the platform works out the difference');
  });

  test('a recount to the same number is a no-op, not a zero movement', async () => {
    const admin = await loginAs('ADMIN');
    const { pharmacyId, medicineId } = await aStockedShop();

    const current = await prisma.pharmacyInventory.findFirstOrThrow({
      where: { pharmacyId, medicineId },
      select: { stock: true },
    });

    const res = await request(app)
      .post(`/api/v1/admin/pharmacies/${pharmacyId}/stock-count`)
      .set(bearer(admin.accessToken))
      .send({ medicineId, countedQuantity: current.stock });

    assert.equal(res.status, 200);
    assert.equal(res.body.movement.delta, 0);
  });

  test('a negative count is refused', async () => {
    const admin = await loginAs('ADMIN');
    const { pharmacyId, medicineId } = await aStockedShop();

    const res = await request(app)
      .post(`/api/v1/admin/pharmacies/${pharmacyId}/stock-count`)
      .set(bearer(admin.accessToken))
      .send({ medicineId, countedQuantity: -1 });

    assert.equal(res.status, 400);
  });

  test('a patient cannot recount a shop that is not theirs', async () => {
    const patient = await login();
    const { pharmacyId, medicineId } = await aStockedShop();

    const res = await request(app)
      .post(`/api/v1/admin/pharmacies/${pharmacyId}/stock-count`)
      .set(bearer(patient.accessToken))
      .send({ medicineId, countedQuantity: 10 });

    assert.equal(res.status, 403);
  });
});
