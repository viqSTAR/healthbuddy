import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import {
  api,
  tokens,
  errorMessage,
  setSessionExpiredHandler,
  restoreSession,
  API_BASE_URL,
} from './client';

/**
 * The panel's session handling, which is the part of this codebase where a bug
 * is a security problem rather than a broken screen.
 *
 * Three properties are load-bearing and none of them are visible on screen:
 * the access token never reaches persistent storage, a 401 is retried exactly
 * once through a single shared refresh, and a refresh that fails signs the
 * admin out rather than leaving them in a half-authenticated state.
 */

/**
 * Two adapters, because there are two clients.
 *
 * Ordinary calls go through the configured `api` instance; the refresh call
 * deliberately uses bare `axios` so it does not recurse through the very
 * interceptor that triggered it. Mocking only one of them lets the other reach
 * the network, which is how this file first failed.
 */
let mock: MockAdapter;
let bare: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
  bare = new MockAdapter(axios);
  tokens.clear();
  setSessionExpiredHandler(null);
});

afterEach(() => {
  mock.restore();
  bare.restore();
});

describe('the access token is never persisted', () => {
  test('saving a token does not touch localStorage or sessionStorage', () => {
    tokens.save('secret-access-token');

    expect(tokens.access()).toBe('secret-access-token');
    expect(JSON.stringify(localStorage)).not.toContain('secret-access-token');
    expect(JSON.stringify(sessionStorage)).not.toContain('secret-access-token');
    expect(localStorage.length).toBe(0);
  });

  test('clearing actually clears', () => {
    tokens.save('secret');
    tokens.clear();
    expect(tokens.access()).toBeNull();
  });
});

describe('requests carry the token', () => {
  test('the Authorization header is attached when there is one', async () => {
    tokens.save('abc123');
    mock.onGet('/admin/stats').reply((config) => {
      expect(config.headers?.Authorization).toBe('Bearer abc123');
      return [200, { ok: true }];
    });

    await api.get('/admin/stats');
  });

  test('no header is sent when signed out', async () => {
    mock.onGet('/admin/stats').reply((config) => {
      expect(config.headers?.Authorization).toBeUndefined();
      return [200, { ok: true }];
    });

    await api.get('/admin/stats');
  });
});

describe('a 401 refreshes once and replays', () => {
  test('the original request is retried with the new token', async () => {
    tokens.save('stale');

    let attempt = 0;
    mock.onGet('/admin/stats').reply((config) => {
      attempt += 1;
      if (attempt === 1) return [401, { error: 'Invalid or expired access token.' }];
      expect(config.headers?.Authorization).toBe('Bearer fresh');
      return [200, { stats: {} }];
    });
    bare
      .onPost(`${API_BASE_URL}/auth/refresh`)
      .reply(200, { tokens: { accessToken: 'fresh', refreshToken: 'r' } });

    const res = await api.get('/admin/stats');

    expect(res.status).toBe(200);
    expect(attempt).toBe(2);
    expect(tokens.access()).toBe('fresh');
  });

  test('concurrent 401s share one refresh round trip', async () => {
    tokens.save('stale');

    const seen: Record<string, number> = { stats: 0, users: 0, refresh: 0 };
    mock.onGet('/admin/stats').reply(() => {
      seen.stats! += 1;
      return seen.stats === 1 ? [401, {}] : [200, {}];
    });
    mock.onGet('/admin/users').reply(() => {
      seen.users! += 1;
      return seen.users === 1 ? [401, {}] : [200, {}];
    });
    bare.onPost(`${API_BASE_URL}/auth/refresh`).reply(() => {
      seen.refresh! += 1;
      return [200, { tokens: { accessToken: 'fresh' } }];
    });

    await Promise.all([api.get('/admin/stats'), api.get('/admin/users')]);

    expect(seen.refresh).toBe(1);
  });

  test('a second 401 on the replayed request does not loop', async () => {
    tokens.save('stale');

    let calls = 0;
    mock.onGet('/admin/stats').reply(() => {
      calls += 1;
      return [401, {}];
    });
    bare.onPost(`${API_BASE_URL}/auth/refresh`).reply(200, { tokens: { accessToken: 'fresh' } });

    await expect(api.get('/admin/stats')).rejects.toBeTruthy();
    expect(calls).toBe(2);
  });

  test('a failed refresh signs the admin out', async () => {
    tokens.save('stale');
    const expired = vi.fn();
    setSessionExpiredHandler(expired);

    mock.onGet('/admin/stats').reply(401, {});
    bare.onPost(`${API_BASE_URL}/auth/refresh`).reply(401, {});

    await expect(api.get('/admin/stats')).rejects.toBeTruthy();

    expect(expired).toHaveBeenCalledTimes(1);
    expect(tokens.access()).toBeNull();
  });

  test('a 401 from an auth call is not retried', async () => {
    let attempts = 0;
    mock.onPost('/auth/refresh').reply(() => {
      attempts += 1;
      return [401, {}];
    });

    await expect(api.post('/auth/refresh', {})).rejects.toBeTruthy();

    // Once, from the call itself. If the interceptor retried an auth failure it
    // would refresh in order to refresh, forever.
    expect(attempts).toBe(1);
  });

  test('a 403 is surfaced, not refreshed away', async () => {
    tokens.save('good');
    let refreshes = 0;
    mock.onGet('/admin/users').reply(403, { error: 'This endpoint requires ADMIN.' });
    bare.onPost(`${API_BASE_URL}/auth/refresh`).reply(() => {
      refreshes += 1;
      return [200, { tokens: { accessToken: 'fresh' } }];
    });

    await expect(api.get('/admin/users')).rejects.toBeTruthy();
    expect(refreshes).toBe(0);
  });
});

describe('restoring a session on load', () => {
  test('a valid cookie yields a token without one being stored anywhere', async () => {
    bare.onPost(`${API_BASE_URL}/auth/refresh`).reply((config) => {
      // The credential is the httpOnly cookie; the panel must not send a token.
      expect(config.withCredentials).toBe(true);
      expect(config.data).toBe('{}');
      return [200, { tokens: { accessToken: 'restored' } }];
    });

    expect(await restoreSession()).toBe('restored');
    expect(tokens.access()).toBe('restored');
    expect(localStorage.length).toBe(0);
  });

  test('no cookie means no session, and no thrown error', async () => {
    bare.onPost(`${API_BASE_URL}/auth/refresh`).reply(401, {});

    expect(await restoreSession()).toBeNull();
    expect(tokens.access()).toBeNull();
  });
});

describe('error messages are useful to a human', () => {
  test('a field error is preferred over the generic one', () => {
    expect(
      errorMessage({
        response: { data: { error: 'Request validation failed.', details: [{ message: 'Enter a valid 6-digit pincode.' }] } },
      })
    ).toBe('Enter a valid 6-digit pincode.');
  });

  test("the server's message is used when there is no field detail", () => {
    expect(errorMessage({ response: { data: { error: 'That account is suspended.' } } })).toBe(
      'That account is suspended.'
    );
  });

  test('a network failure names the API it could not reach', () => {
    expect(errorMessage({ message: 'Network Error' })).toContain(API_BASE_URL);
  });

  test('an unrecognised shape falls back rather than rendering undefined', () => {
    expect(errorMessage({}, 'Something went wrong.')).toBe('Something went wrong.');
    expect(errorMessage(null)).toBe('Something went wrong.');
  });
});
