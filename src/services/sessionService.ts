import { prisma } from '../config/db.js';
import { cacheStore } from '../config/redis.js';
import { unauthorized } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import type { SignedClaims } from '../utils/jwt.js';

/**
 * Whether a signed token still represents a live session.
 *
 * A JWT is a bearer credential the server does not keep a copy of, and that is
 * the whole problem this file exists to solve. Verifying the signature proves
 * the token was issued here; it says nothing about whether the account was
 * suspended an hour ago, signed out, or erased on request. Before this, none of
 * those did anything: the admin panel's Suspend button set a column that no
 * authentication path ever read, so a suspended account could sign in fresh,
 * read patient data, and go on minting new tokens off its refresh token for a
 * week. Sign-out cleared a cookie and left the token itself working.
 *
 * The fix is one integer. Every token carries the account's `tokenVersion` at
 * the moment it was minted; every request compares that against the live value
 * and refuses anything behind it. Raising the column by one is what "end every
 * session for this person, now" means, and it works on tokens already in the
 * wild, on other devices, on stolen phones.
 *
 * The cost is a lookup per request, which is why the answer is cached: this is
 * three booleans and an integer, it changes rarely, and every path that changes
 * it deletes the key. The TTL is a backstop for an invalidation that failed,
 * not the mechanism.
 */

const CACHE_TTL_SECONDS = 30;

const stateKey = (userId: string) => `auth:state:${userId}`;

interface AuthState {
  /** User.tokenVersion */
  v: number;
  /** User.isSuspended */
  s: boolean;
  /** User.anonymisedAt is set — the account was erased and can never sign in. */
  a: boolean;
}

const readFromDatabase = async (userId: string): Promise<AuthState | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenVersion: true, isSuspended: true, anonymisedAt: true },
  });
  if (!user) return null;
  return { v: user.tokenVersion, s: user.isSuspended, a: user.anonymisedAt !== null };
};

/**
 * The account's current session state, from cache when it is there.
 *
 * A cache miss and a deleted account are deliberately different returns: `null`
 * means "there is no such user", which callers turn into a 401 rather than
 * treating as a transient failure.
 */
export const loadAuthState = async (userId: string): Promise<AuthState | null> => {
  const cached = await cacheStore.get(stateKey(userId)).catch(() => null);
  if (cached) {
    try {
      return JSON.parse(cached) as AuthState;
    } catch {
      // A corrupt entry is not worth failing a request over — fall through to
      // the database and overwrite it.
    }
  }

  const state = await readFromDatabase(userId);
  if (state) {
    await cacheStore.set(stateKey(userId), JSON.stringify(state), CACHE_TTL_SECONDS).catch(() => undefined);
  }
  return state;
};

/** Drops the cached copy so the next request re-reads the database. */
export const invalidateAuthState = async (userId: string): Promise<void> => {
  await cacheStore.del(stateKey(userId)).catch((err) => {
    // Worth knowing about: until the TTL lapses, a revocation has not taken
    // effect on processes reading through this cache.
    logger.error(`[session] could not invalidate cached auth state for ${userId}`, err);
  });
};

/**
 * Ends every session the account has, everywhere, immediately.
 *
 * Called on sign-out, on suspension, and on erasure. Returns the new version so
 * a caller that is also issuing fresh tokens (sign-out on one device while
 * staying signed in on another is NOT what this does — it signs out all of
 * them) mints them against the right value.
 */
export const revokeSessions = async (userId: string): Promise<number> => {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
    select: { tokenVersion: true },
  });
  await invalidateAuthState(userId);
  return user.tokenVersion;
};

/** The version to stamp on a token being minted right now. */
export const currentTokenVersion = async (userId: string): Promise<number> => {
  const state = await loadAuthState(userId);
  return state?.v ?? 0;
};

/**
 * Why a session is refused, phrased for the person holding the token.
 *
 * Suspension says so plainly: someone whose account was suspended needs to know
 * to contact support rather than reinstall the app twice and give up. A stale
 * version does not explain itself, because the ordinary cause is a sign-out on
 * another device and the interesting cause is a stolen token.
 */
export const assertSessionValid = async (claims: SignedClaims): Promise<void> => {
  const state = await loadAuthState(claims.userId);

  if (!state || state.a) {
    throw unauthorized('This account is no longer active.');
  }
  if (state.s) {
    throw unauthorized('This account has been suspended. Contact support.');
  }
  // Tokens minted before this column existed carry no `tv`; treating those as
  // version 0 keeps them working until they expire rather than signing out
  // every user on the platform the moment this deploys.
  if ((claims.tv ?? 0) < state.v) {
    throw unauthorized('This session has ended. Please sign in again.');
  }
};

/**
 * The same check, for the two places that authenticate a *phone number* rather
 * than a token: issuing an OTP session, and exchanging a refresh token. Neither
 * has a version to compare yet — the question there is only whether the account
 * is allowed to hold a session at all.
 */
export const assertAccountUsable = (user: {
  isSuspended: boolean;
  anonymisedAt: Date | null;
}): void => {
  if (user.anonymisedAt !== null) {
    throw unauthorized('This account has been closed.');
  }
  if (user.isSuspended) {
    throw unauthorized('This account has been suspended. Contact support.');
  }
};
