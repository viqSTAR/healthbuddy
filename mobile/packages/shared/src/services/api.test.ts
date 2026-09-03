import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import { __store } from '../testing/secureStoreFake';
import * as tokenStore from './tokenStore';
import { api, setSessionExpiredHandler, errorMessage, API_BASE_URL } from './api';

/**
 * The mobile session, which is where a bug is a security problem rather than a
 * broken screen.
 *
 * Two adapters, because there are two clients: ordinary calls go through the
 * configured `api` instance, and the refresh deliberately uses bare `axios` so
 * it does not recurse through the interceptor that triggered it.
 */

let mock: MockAdapter;
let bare: MockAdapter;

beforeEach(async () => {
  mock = new MockAdapter(api);
  bare = new MockAdapter(axios);
  __store.clear();
  await tokenStore.clearTokens();
  __store.clear();
  setSessionExpiredHandler(null);
});

afterEach(() => {
  mock.restore();
  bare.restore();
});

describe('requests carry the stored token', () => {
  test('the Authorization header comes from the keychain', async () => {
    await tokenStore.saveTokens('access-1', 'refresh-1');

    mock.onGet('/patients/me').reply((config) => {
      expect(config.headers?.Authorization).toBe('Bearer access-1');
      return [200, {}];
    });

    await api.get('/patients/me');
  });

  test('a signed-out app sends no header', async () => {
    mock.onGet('/patients/me').reply((config) => {
      expect(config.headers?.Authorization).toBeUndefined();
      return [200, {}];
    });

    await api.get('/patients/me');
  });
});

describe('a 401 refreshes once and replays', () => {
  test('the new token pair is persisted, not just held in memory', async () => {
    await tokenStore.saveTokens('stale', 'refresh-1');

    let attempt = 0;
    mock.onGet('/patients/me').reply(() => {
      attempt += 1;
      return attempt === 1 ? [401, {}] : [200, { ok: true }];
    });
    bare
      .onPost(`${API_BASE_URL}/auth/refresh`)
      .reply(200, { tokens: { accessToken: 'fresh', refreshToken: 'refresh-2' } });

    const res = await api.get('/patients/me');

    expect(res.status).toBe(200);
    expect(await tokenStore.getAccessToken()).toBe('fresh');
    expect(await tokenStore.getRefreshToken()).toBe('refresh-2');
    // Survives a cold start, which is the whole reason it goes to the keychain.
    expect(await tokenStore.hydrate()).toBe(true);
  });

  test('the refresh sends the stored refresh token', async () => {
    await tokenStore.saveTokens('stale', 'refresh-1');

    mock.onGet('/patients/me').reply(401, {});
    bare.onPost(`${API_BASE_URL}/auth/refresh`).reply((config) => {
      expect(JSON.parse(String(config.data))).toEqual({ refreshToken: 'refresh-1' });
      return [200, { tokens: { accessToken: 'fresh', refreshToken: 'refresh-2' } }];
    });

    await api.get('/patients/me').catch(() => undefined);
  });

  test('concurrent 401s share one refresh', async () => {
    await tokenStore.saveTokens('stale', 'refresh-1');

    let refreshes = 0;
    let a = 0;
    let b = 0;
    mock.onGet('/patients/me').reply(() => (++a === 1 ? [401, {}] : [200, {}]));
    mock.onGet('/appointments/my-appointments').reply(() => (++b === 1 ? [401, {}] : [200, {}]));
    bare.onPost(`${API_BASE_URL}/auth/refresh`).reply(() => {
      refreshes += 1;
      return [200, { tokens: { accessToken: 'fresh', refreshToken: 'r2' } }];
    });

    await Promise.all([api.get('/patients/me'), api.get('/appointments/my-appointments')]);

    expect(refreshes).toBe(1);
  });

  test('a failed refresh clears the keychain and signs the app out', async () => {
    await tokenStore.saveTokens('stale', 'refresh-1');
    const expired = vi.fn();
    setSessionExpiredHandler(expired);

    mock.onGet('/patients/me').reply(401, {});
    bare.onPost(`${API_BASE_URL}/auth/refresh`).reply(401, {});

    await expect(api.get('/patients/me')).rejects.toBeTruthy();

    expect(expired).toHaveBeenCalled();
    expect(await tokenStore.getAccessToken()).toBeNull();
    expect(__store.size).toBe(0);
  });

  test('a revoked session — the backend suspension case — signs the app out', async () => {
    await tokenStore.saveTokens('revoked', 'refresh-1');
    const expired = vi.fn();
    setSessionExpiredHandler(expired);

    mock.onGet('/patients/me').reply(401, { error: 'This account has been suspended.' });
    // A revoked token version fails refresh too — that is the point of it.
    bare
      .onPost(`${API_BASE_URL}/auth/refresh`)
      .reply(401, { error: 'This session has ended. Please sign in again.' });

    await expect(api.get('/patients/me')).rejects.toBeTruthy();

    expect(expired).toHaveBeenCalled();
    expect(await tokenStore.getAccessToken()).toBeNull();
  });

  test('a 403 is surfaced rather than refreshed away', async () => {
    await tokenStore.saveTokens('good', 'refresh-1');
    let refreshes = 0;

    mock.onGet('/admin/users').reply(403, { error: 'This endpoint requires ADMIN.' });
    bare.onPost(`${API_BASE_URL}/auth/refresh`).reply(() => {
      refreshes += 1;
      return [200, { tokens: { accessToken: 'fresh', refreshToken: 'r2' } }];
    });

    await expect(api.get('/admin/users')).rejects.toBeTruthy();
    expect(refreshes).toBe(0);
  });

  test('a 401 on an auth call is not retried into a loop', async () => {
    let attempts = 0;
    mock.onPost('/auth/verify-otp').reply(() => {
      attempts += 1;
      return [401, {}];
    });

    await expect(api.post('/auth/verify-otp', {})).rejects.toBeTruthy();
    expect(attempts).toBe(1);
  });
});

describe('error messages', () => {
  test('a field error is preferred over the generic one', () => {
    expect(
      errorMessage({
        response: {
          data: {
            error: 'Request validation failed.',
            details: [{ message: 'The verification code must be exactly 6 digits.' }],
          },
        },
      })
    ).toBe('The verification code must be exactly 6 digits.');
  });

  test("the server's own message survives to the user", () => {
    expect(
      errorMessage({ response: { data: { error: 'This account has been suspended. Contact support.' } } })
    ).toBe('This account has been suspended. Contact support.');
  });

  test('an unrecognised shape falls back instead of rendering undefined', () => {
    expect(errorMessage(null)).toBeTruthy();
    expect(errorMessage({})).toBeTruthy();
  });
});
