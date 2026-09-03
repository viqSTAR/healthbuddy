import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { app, prisma, request, login, cleanupTestUsers } from './helpers.js';
import { cacheStore } from '../src/config/redis.js';
import { POLICY_VERSIONS, hasConsent } from '../src/services/consentService.js';

/**
 * Consent is a record, not a checkbox.
 *
 * The questions it has to answer are "when", "to which wording", and "did they
 * take it back" — none of which a boolean on the user row can. These pin the
 * behaviours that make the record worth keeping.
 */

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('recording consent', () => {
  test('a new account has agreed to nothing', async () => {
    const patient = await login();
    const res = await request(app).get('/api/v1/patients/me/consents').set(bearer(patient.accessToken));

    assert.equal(res.status, 200);
    assert.equal(res.body.consents.length, 4);
    assert.ok(res.body.consents.every((c: { granted: boolean }) => !c.granted));
  });

  test('granting is recorded with the wording and the time', async () => {
    const patient = await login();

    const res = await request(app)
      .post('/api/v1/patients/me/consents')
      .set(bearer(patient.accessToken))
      .send({ purpose: 'PRIVACY_POLICY' });
    assert.equal(res.status, 200);

    const row = await prisma.consentRecord.findFirstOrThrow({
      where: { userId: patient.userId, purpose: 'PRIVACY_POLICY' },
    });
    assert.equal(row.policyVersion, POLICY_VERSIONS.PRIVACY_POLICY);
    assert.equal(row.withdrawnAt, null);
    assert.ok(row.grantedAt);
  });

  test('re-granting the same version does not stack duplicate rows', async () => {
    const patient = await login();
    const grant = () =>
      request(app)
        .post('/api/v1/patients/me/consents')
        .set(bearer(patient.accessToken))
        .send({ purpose: 'MARKETING_MESSAGES' });

    await grant();
    await grant();
    await grant();

    const count = await prisma.consentRecord.count({
      where: { userId: patient.userId, purpose: 'MARKETING_MESSAGES' },
    });
    assert.equal(count, 1, 'an app re-submitting on launch must not fill the table');
  });

  test('consent to superseded wording is refused', async () => {
    const patient = await login();

    const res = await request(app)
      .post('/api/v1/patients/me/consents')
      .set(bearer(patient.accessToken))
      .send({ purpose: 'TERMS_OF_SERVICE', policyVersion: '1999-01-01' });

    assert.equal(res.status, 409);
    assert.match(res.body.error, /not the current version/i);
  });

  test('purposes are independent', async () => {
    const patient = await login();

    await request(app)
      .post('/api/v1/patients/me/consents')
      .set(bearer(patient.accessToken))
      .send({ purpose: 'PRIVACY_POLICY' });

    assert.equal(await hasConsent(patient.userId, 'PRIVACY_POLICY'), true);
    assert.equal(
      await hasConsent(patient.userId, 'MARKETING_MESSAGES'),
      false,
      'agreeing to be treated is not agreeing to be marketed at'
    );
  });
});

describe('withdrawing consent', () => {
  test('withdrawal stamps the row rather than deleting it', async () => {
    const patient = await login();
    await request(app)
      .post('/api/v1/patients/me/consents')
      .set(bearer(patient.accessToken))
      .send({ purpose: 'MARKETING_MESSAGES' });

    const res = await request(app)
      .delete('/api/v1/patients/me/consents/MARKETING_MESSAGES')
      .set(bearer(patient.accessToken));

    assert.equal(res.status, 200);
    assert.equal(res.body.essential, false);

    const row = await prisma.consentRecord.findFirstOrThrow({
      where: { userId: patient.userId, purpose: 'MARKETING_MESSAGES' },
    });
    assert.ok(row.withdrawnAt, 'the history must survive — it is the point of the record');
    assert.equal(await hasConsent(patient.userId, 'MARKETING_MESSAGES'), false);
  });

  test('withdrawing an essential consent is allowed, and says what it costs', async () => {
    const patient = await login();
    await request(app)
      .post('/api/v1/patients/me/consents')
      .set(bearer(patient.accessToken))
      .send({ purpose: 'PRIVACY_POLICY' });

    const res = await request(app)
      .delete('/api/v1/patients/me/consents/PRIVACY_POLICY')
      .set(bearer(patient.accessToken));

    assert.equal(res.status, 200, 'a consent that cannot be withdrawn is not consent');
    assert.equal(res.body.essential, true);
    assert.match(res.body.message, /cannot provide care/i);
  });

  test('withdrawing what was never given is a 409, not a silent success', async () => {
    const patient = await login();
    const res = await request(app)
      .delete('/api/v1/patients/me/consents/TELECONSULTATION')
      .set(bearer(patient.accessToken));

    assert.equal(res.status, 409);
  });

  test('granting again after withdrawal works, and leaves both rows', async () => {
    const patient = await login();
    const grant = () =>
      request(app)
        .post('/api/v1/patients/me/consents')
        .set(bearer(patient.accessToken))
        .send({ purpose: 'TELECONSULTATION' });

    await grant();
    await request(app)
      .delete('/api/v1/patients/me/consents/TELECONSULTATION')
      .set(bearer(patient.accessToken));
    await grant();

    const rows = await prisma.consentRecord.findMany({
      where: { userId: patient.userId, purpose: 'TELECONSULTATION' },
      orderBy: { grantedAt: 'asc' },
    });
    assert.equal(rows.length, 2, 'the withdrawal must remain visible in the history');
    assert.ok(rows[0]!.withdrawnAt);
    assert.equal(rows[1]!.withdrawnAt, null);
    assert.equal(await hasConsent(patient.userId, 'TELECONSULTATION'), true);
  });
});

describe('consent is scoped to the caller', () => {
  test('an unauthenticated caller cannot read or write consents', async () => {
    assert.equal((await request(app).get('/api/v1/patients/me/consents')).status, 401);
    assert.equal(
      (await request(app).post('/api/v1/patients/me/consents').send({ purpose: 'PRIVACY_POLICY' }))
        .status,
      401
    );
  });

  test('one patient cannot see another\'s consents', async () => {
    const a = await login();
    const b = await login();

    await request(app)
      .post('/api/v1/patients/me/consents')
      .set(bearer(a.accessToken))
      .send({ purpose: 'PRIVACY_POLICY' });

    const res = await request(app).get('/api/v1/patients/me/consents').set(bearer(b.accessToken));
    const privacy = res.body.consents.find(
      (c: { purpose: string }) => c.purpose === 'PRIVACY_POLICY'
    );
    assert.equal(privacy.granted, false, 'the route is /me — it must read the caller, not a peer');
  });

  test('an unknown purpose is rejected by validation', async () => {
    const patient = await login();
    const res = await request(app)
      .post('/api/v1/patients/me/consents')
      .set(bearer(patient.accessToken))
      .send({ purpose: 'SELL_MY_DATA' });

    assert.equal(res.status, 400);
  });
});

after(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
  await cacheStore.disconnect();
});
