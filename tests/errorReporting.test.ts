import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { app, prisma, request, login, cleanupTestUsers } from './helpers.js';
import { cacheStore } from '../src/config/redis.js';
import { errorReporter } from '../src/utils/errorReporter.js';

/**
 * The reporter is off in tests (no DSN), which is the state most deployments
 * start in — so the property worth proving here is that being off is harmless,
 * and that the error surface a client sees has not changed now that a third
 * party may be listening.
 */

describe('error reporting is inert without a DSN', () => {
  test('the default reporter is the no-op', () => {
    assert.equal(errorReporter.name, 'none');
  });

  test('capturing does not throw, whatever it is handed', () => {
    for (const thing of [new Error('boom'), 'a string', null, undefined, { odd: true }, 42]) {
      assert.doesNotThrow(() => errorReporter.capture(thing, { route: 'GET /test' }));
    }
  });

  test('capture is synchronous — the error path must not await a network call', () => {
    const started = Date.now();
    errorReporter.capture(new Error('boom'), { route: 'GET /test', userId: 'abc' });
    assert.ok(Date.now() - started < 50);
  });
});

describe('the client-facing error surface is unchanged', () => {
  test('a 404 is still a clean 404 with no stack', async () => {
    const res = await request(app).get('/api/v1/definitely-not-a-route');
    assert.equal(res.status, 404);
    assert.equal(res.body.stack, undefined);
    assert.match(res.body.error, /No route matches/);
  });

  test('a validation failure is still a 400 with field detail', async () => {
    const res = await request(app).post('/api/v1/auth/send-otp').send({ phoneNumber: 'x' });
    assert.equal(res.status, 400);
    assert.ok(Array.isArray(res.body.details));
  });

  test('an authorisation failure is still a 403, not a 500', async () => {
    const patient = await login();
    const res = await request(app)
      .get('/api/v1/admin/users')
      .set({ Authorization: `Bearer ${patient.accessToken}` });

    assert.equal(res.status, 403);
    assert.equal(res.body.stack, undefined);
  });

  test('malformed JSON is a 400, not an unhandled fault', async () => {
    const res = await request(app)
      .post('/api/v1/auth/send-otp')
      .set('Content-Type', 'application/json')
      .send('{"phoneNumber": ');

    assert.equal(res.status, 400);
    assert.match(res.body.error, /Malformed JSON/);
  });
});

after(async () => {
  await cleanupTestUsers();
  await prisma.$disconnect();
  await cacheStore.disconnect();
});
