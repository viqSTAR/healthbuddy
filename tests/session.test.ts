import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { app, prisma, request, login, loginAs, uniquePhone, cleanupTestUsers } from './helpers.js';
import { cacheStore } from '../src/config/redis.js';

/**
 * A token is only as good as the account behind it.
 *
 * Every case here failed before session versioning existed: suspending an
 * account, signing out, and changing someone's role all left the tokens already
 * in circulation working until they expired on their own — up to seven days for
 * a refresh token. The admin panel's Suspend button, in particular, set a
 * column that no authentication path read.
 */

const authed = (token: string) =>
  request(app).get('/api/v1/patients/me').set('Authorization', `Bearer ${token}`);

describe('suspension is enforced', () => {
  test('a live session stops working the moment the account is suspended', async () => {
    const patient = await login();
    const admin = await loginAs('ADMIN');

    assert.equal((await authed(patient.accessToken)).status, 200, 'sanity: works before');

    const suspended = await request(app)
      .patch(`/api/v1/admin/users/${patient.userId}/suspension`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ suspended: true, reason: 'test' });
    assert.equal(suspended.status, 200);

    const after = await authed(patient.accessToken);
    assert.equal(after.status, 401);
    assert.match(after.body.error, /suspended/i);
  });

  test('a suspended account cannot sign in again', async () => {
    const phone = uniquePhone();
    const user = await prisma.user.create({
      data: {
        phoneNumber: phone,
        role: 'PATIENT',
        isSuspended: true,
        patient: { create: { fullName: 'Suspended Person' } },
      },
    });

    const sent = await request(app).post('/api/v1/auth/send-otp').send({ phoneNumber: phone });
    assert.equal(sent.status, 200, 'send-otp stays uniform — it must not reveal account state');

    const verified = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phoneNumber: phone, otp: sent.body.devOtp });

    assert.equal(verified.status, 401);
    assert.equal(verified.body.tokens, undefined);

    await prisma.patient.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  test('a suspended account cannot refresh its way back in', async () => {
    const patient = await login();
    await prisma.user.update({
      where: { id: patient.userId },
      data: { isSuspended: true },
    });

    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: patient.refreshToken });

    assert.equal(refreshed.status, 401);
    assert.equal(refreshed.body.tokens, undefined);
  });

  test('restoring an account lets it back in', async () => {
    const admin = await loginAs('ADMIN');

    // Built directly rather than via login(), so this phone has never been
    // through /send-otp and is not sitting behind the per-number cooldown.
    const phone = uniquePhone();
    const user = await prisma.user.create({
      data: {
        phoneNumber: phone,
        role: 'PATIENT',
        isSuspended: true,
        patient: { create: { fullName: 'Restored Person' } },
      },
    });

    const restored = await request(app)
      .patch(`/api/v1/admin/users/${user.id}/suspension`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ suspended: false, reason: 'test' });
    assert.equal(restored.status, 200);

    const sent = await request(app).post('/api/v1/auth/send-otp').send({ phoneNumber: phone });
    const verified = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ phoneNumber: phone, otp: sent.body.devOtp });

    assert.equal(verified.status, 200);
    assert.ok(verified.body.tokens.accessToken);
    assert.equal((await authed(verified.body.tokens.accessToken)).status, 200);

    await prisma.patient.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});

describe('signing out ends the session', () => {
  test('the refresh token is spent, not merely forgotten', async () => {
    const patient = await login();

    const out = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: patient.refreshToken });
    assert.equal(out.status, 200);

    const reused = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: patient.refreshToken });
    assert.equal(reused.status, 401, 'a signed-out refresh token must not mint new tokens');
  });

  test('the access token dies with it, on every device', async () => {
    const patient = await login();

    await request(app).post('/api/v1/auth/logout').send({ refreshToken: patient.refreshToken });

    const stillGoing = await authed(patient.accessToken);
    assert.equal(stillGoing.status, 401);
  });

  test('signing out with an expired or absent token still succeeds', async () => {
    assert.equal((await request(app).post('/api/v1/auth/logout').send({})).status, 200);
    assert.equal(
      (await request(app).post('/api/v1/auth/logout').send({ refreshToken: 'not.a.token' })).status,
      200
    );
  });
});

describe('a role change ends the old session', () => {
  test('a token minted before promotion no longer works', async () => {
    const admin = await loginAs('ADMIN');
    const person = await login();

    const provisioned = await request(app)
      .post('/api/v1/auth/provision')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ phoneNumber: person.phone, role: 'DOCTOR', name: 'Dr Promoted' });
    assert.equal(provisioned.status, 201);

    // The old token still says PATIENT. It must not be usable as either role.
    const stale = await authed(person.accessToken);
    assert.equal(stale.status, 401);
  });
});

describe('token integrity', () => {
  test('an unsigned "alg: none" token is refused', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        userId: '00000000-0000-0000-0000-000000000000',
        role: 'ADMIN',
        typ: 'access',
        tv: 0,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url');

    const res = await authed(`${header}.${body}.`);
    assert.equal(res.status, 401);
  });

  test('a refresh token still cannot authenticate a request', async () => {
    const patient = await login();
    assert.equal((await authed(patient.refreshToken)).status, 401);
  });
});

after(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
  // Without this the ioredis socket keeps the event loop alive and the runner
  // never exits, even though every test has finished.
  await cacheStore.disconnect();
});
