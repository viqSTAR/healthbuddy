/**
 * A partner reading its own shop or lab record.
 *
 * The partner app's profile screen used to read the ProviderApplication — the
 * form someone fills in to *ask* to become a partner. A partner admitted any
 * other way (the seed, or an admin provisioning them directly) has no
 * application at all, so every field rendered as a dash for precisely the
 * partners who were verified and trading. These endpoints are what it reads
 * instead, and the assertions that matter most are the refusals: one shop must
 * never be able to read another's licence.
 */
import { test, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { app, prisma, request, login, loginAs, auth, cleanupTestUsers } from './helpers.js';
import { cacheStore } from '../src/config/redis.js';

after(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
  await cacheStore.disconnect();
});

describe('a pharmacy reads its own record', () => {
  test('the licence and address come back, with no application on file', async () => {
    const partner = await loginAs('PHARMACY');

    // The premise: this shop was never asked to apply.
    const applications = await prisma.providerApplication.count({
      where: { userId: partner.userId },
    });
    assert.equal(applications, 0, 'this test is about partners with no application');

    await prisma.pharmacy.update({
      where: { userId: partner.userId },
      data: {
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400053',
        drugLicenceNumber: 'MH-RTL-TEST-1',
        pharmacistName: 'A. Test',
        verifiedAt: new Date(),
      },
    });

    const res = await request(app).get('/api/v1/pharmacy/me').set(auth(partner.accessToken));
    assert.equal(res.status, 200, res.text);

    const shop = res.body.pharmacy;
    assert.equal(shop.name, 'Test Pharmacy');
    assert.equal(shop.drugLicenceNumber, 'MH-RTL-TEST-1');
    assert.equal(shop.pharmacistName, 'A. Test');
    assert.equal(shop.city, 'Mumbai');
    assert.equal(shop.pincode, '400053');
    assert.ok(shop.verifiedAt, 'a verified shop must be able to prove it');
  });

  /**
   * The payout account and commission rate are the platform's side of the
   * arrangement. A shop reading its own profile has no business seeing them,
   * and shipping them here would put them in every client that ever caches it.
   */
  test('the payout account and commission are not exposed', async () => {
    const partner = await loginAs('PHARMACY');
    await prisma.pharmacy.update({
      where: { userId: partner.userId },
      data: { payoutAccountId: 'acc_secret', commissionPercent: 42 },
    });

    const res = await request(app).get('/api/v1/pharmacy/me').set(auth(partner.accessToken));
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.pharmacy.payoutAccountId, undefined);
    assert.equal(res.body.pharmacy.commissionPercent, undefined);
  });
});

describe('a lab reads its own record', () => {
  test('registration and accreditation come back', async () => {
    const partner = await loginAs('LAB_PARTNER');

    await prisma.labPartner.update({
      where: { userId: partner.userId },
      data: {
        city: 'Mumbai',
        pincode: '400076',
        labRegistrationNumber: 'MH-CLE-TEST-1',
        nablAccredited: true,
        nablCertNumber: 'MC-TEST',
        verifiedAt: new Date(),
      },
    });

    const res = await request(app).get('/api/v1/labs/me').set(auth(partner.accessToken));
    assert.equal(res.status, 200, res.text);

    const lab = res.body.lab;
    assert.equal(lab.name, 'Test Lab');
    assert.equal(lab.labRegistrationNumber, 'MH-CLE-TEST-1');
    assert.equal(lab.nablAccredited, true);
    assert.equal(lab.nablCertNumber, 'MC-TEST');
    assert.equal(lab.homeCollection, true);
  });
});

describe('one partner cannot read another', () => {
  test('a patient is refused both', async () => {
    const patient = await login();
    await request(app)
      .get('/api/v1/pharmacy/me')
      .set(auth(patient.accessToken))
      .expect(403);
    await request(app).get('/api/v1/labs/me').set(auth(patient.accessToken)).expect(403);
  });

  test('a pharmacy cannot read the lab endpoint, and a lab cannot read the shop one', async () => {
    const shop = await loginAs('PHARMACY');
    const lab = await loginAs('LAB_PARTNER');

    await request(app).get('/api/v1/labs/me').set(auth(shop.accessToken)).expect(403);
    await request(app).get('/api/v1/pharmacy/me').set(auth(lab.accessToken)).expect(403);
  });

  test('an anonymous caller is refused', async () => {
    await request(app).get('/api/v1/pharmacy/me').expect(401);
    await request(app).get('/api/v1/labs/me').expect(401);
  });

  /**
   * There is no id in the path, so the only shop reachable is the caller's own.
   * Asserted rather than assumed: an endpoint that took one would be the
   * natural next change, and this is the property that must survive it.
   */
  test('two shops see two different records', async () => {
    const one = await loginAs('PHARMACY');
    const two = await loginAs('PHARMACY');

    const first = await request(app).get('/api/v1/pharmacy/me').set(auth(one.accessToken));
    const second = await request(app).get('/api/v1/pharmacy/me').set(auth(two.accessToken));

    assert.equal(first.status, 200, first.text);
    assert.equal(second.status, 200, second.text);
    assert.notEqual(first.body.pharmacy.id, second.body.pharmacy.id);
  });
});
