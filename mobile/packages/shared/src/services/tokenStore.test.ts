import { describe, test, expect, beforeEach } from 'vitest';
import { __store } from '../testing/secureStoreFake';
import * as tokenStore from './tokenStore';

/**
 * Where a mobile session actually lives.
 *
 * The property that matters is that both tokens reach the OS keychain and that
 * clearing removes them from it — not merely from the in-memory mirror the
 * request interceptor reads. A sign-out that empties the cache and leaves the
 * keychain populated looks correct until the next app launch hydrates it and
 * silently signs the person back in.
 */

beforeEach(async () => {
  __store.clear();
  await tokenStore.clearTokens();
  __store.clear();
});

describe('saving', () => {
  test('both tokens reach secure storage, not just memory', async () => {
    await tokenStore.saveTokens('access-1', 'refresh-1');

    expect([...__store.values()]).toContain('access-1');
    expect([...__store.values()]).toContain('refresh-1');
  });

  test('they are readable back', async () => {
    await tokenStore.saveTokens('access-1', 'refresh-1');

    expect(await tokenStore.getAccessToken()).toBe('access-1');
    expect(await tokenStore.getRefreshToken()).toBe('refresh-1');
  });

  test('the two are kept under different keys', async () => {
    await tokenStore.saveTokens('access-1', 'refresh-1');
    expect(__store.size).toBe(2);
  });
});

describe('clearing', () => {
  test('the keychain is emptied, not only the cache', async () => {
    await tokenStore.saveTokens('access-1', 'refresh-1');
    await tokenStore.clearTokens();

    expect(__store.size).toBe(0);
    expect(await tokenStore.getAccessToken()).toBeNull();
    expect(await tokenStore.getRefreshToken()).toBeNull();
  });

  test('a later hydrate finds nothing — no accidental re-login on next launch', async () => {
    await tokenStore.saveTokens('access-1', 'refresh-1');
    await tokenStore.clearTokens();

    expect(await tokenStore.hydrate()).toBe(false);
    expect(await tokenStore.getAccessToken()).toBeNull();
  });
});

describe('hydrating on launch', () => {
  test('a stored session is restored and reported as present', async () => {
    await tokenStore.saveTokens('access-1', 'refresh-1');
    // Simulate a cold start: the cache is gone but the keychain is not.
    expect(await tokenStore.hydrate()).toBe(true);
    expect(await tokenStore.getAccessToken()).toBe('access-1');
  });

  test('an empty keychain reports no session rather than throwing', async () => {
    expect(await tokenStore.hydrate()).toBe(false);
  });

  test('a refresh token alone does not count as a session', async () => {
    // The access token is what `hydrate` reports on; a keychain holding only a
    // refresh token means the app must go through /auth/refresh, not assume it
    // is signed in.
    __store.set('hb.refreshToken', 'orphan');
    expect(await tokenStore.hydrate()).toBe(false);
    expect(await tokenStore.getRefreshToken()).toBe('orphan');
  });
});
