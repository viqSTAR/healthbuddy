import { createHmac } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * One configured secret, several independent keys.
 *
 * `JWT_ACCESS_SECRET` had grown into the key for four unrelated things: signing
 * access tokens, hashing OTPs, signing document download links, and signing
 * mock payment handoffs. Nothing was exploitable — the signed messages have
 * different shapes and none of them collide — but it is a standing invitation
 * for the one that does. A signature scheme where an attacker can get the
 * server to sign a chosen string under purpose A, and then present it as a
 * valid token for purpose B, is a real class of bug, and the only thing
 * preventing it here was that nobody had picked the wrong format yet.
 *
 * Deriving a separate key per purpose removes the question. Each key is an HMAC
 * of a fixed label under the configured secret, so operators still manage one
 * secret and rotating it rotates all four together — which is the behaviour
 * they already had.
 *
 * The labels are part of the wire format: changing one invalidates everything
 * signed under it. That is fine for all of these (an OTP lives five minutes, a
 * document link five, a mock payment is development-only), but it is the reason
 * they are written out literally rather than derived from a filename or an enum
 * someone might rename.
 */
const derive = (label: string): Buffer =>
  createHmac('sha256', env.JWT_ACCESS_SECRET).update(`healthbuddy.v1.${label}`).digest();

/** Keys the OTP hash, so a Redis dump cannot be replayed into a login. */
export const OTP_KEY = derive('otp-hash');

/** Signs short-lived document download links. */
export const DOCUMENT_LINK_KEY = derive('document-link');

/** Stands in for a gateway secret under PAYMENT_PROVIDER=mock. */
export const MOCK_PAYMENT_KEY = derive('mock-payment');
