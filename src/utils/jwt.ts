import jwt, { type SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

export type Role =
  | 'PATIENT'
  | 'DOCTOR'
  | 'LAB_PARTNER'
  | 'PHARMACY'
  | 'DELIVERY_AGENT'
  | 'ADMIN';

/**
 * Claims carried by an access token. Profile ids are resolved server-side at
 * login and embedded so downstream handlers never have to trust a client id.
 */
export interface JwtPayload {
  userId: string;
  phoneNumber: string;
  role: Role;
  patientId?: string;
  doctorId?: string;
  labPartnerId?: string;
  pharmacyId?: string;
  /// The rider/collector profile, when this account has one.
  agentId?: string;
}

/** `typ` separates the two token classes so a refresh token cannot authenticate a request. */
type TokenType = 'access' | 'refresh';

export interface SignedClaims extends JwtPayload {
  typ: TokenType;
  jti: string;
  /**
   * The account's `tokenVersion` when this was minted. Checked against the
   * live value on every request, which is what makes a token revocable at all —
   * see sessionService.
   */
  tv: number;
}

/**
 * The only algorithm this service issues or accepts.
 *
 * Pinned rather than left to the library's default list. `jsonwebtoken` picks
 * the verifier from the token's own `alg` header when no list is given, which
 * means the token gets a say in how it is checked — the shape of every JWT
 * confusion bug there has ever been. Nothing here is asymmetric, so there is
 * exactly one right answer and it belongs on this side.
 */
const ALGORITHM = 'HS256' as const;

const sign = (payload: JwtPayload, typ: TokenType, tokenVersion: number): string => {
  const secret = typ === 'access' ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
  const expiresIn = typ === 'access' ? env.JWT_ACCESS_EXPIRES_IN : env.JWT_REFRESH_EXPIRES_IN;

  const claims: SignedClaims = { ...payload, typ, jti: randomUUID(), tv: tokenVersion };
  return jwt.sign(claims, secret, { expiresIn, algorithm: ALGORITHM } as SignOptions);
};

export const generateTokens = (payload: JwtPayload, tokenVersion: number) => ({
  accessToken: sign(payload, 'access', tokenVersion),
  refreshToken: sign(payload, 'refresh', tokenVersion),
});

const verify = (token: string, typ: TokenType): SignedClaims => {
  const secret = typ === 'access' ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
  const decoded = jwt.verify(token, secret, { algorithms: [ALGORITHM] }) as SignedClaims;

  // Reject a token minted for the other purpose even if the secret matched.
  if (decoded.typ !== typ) {
    throw new jwt.JsonWebTokenError(`Expected a ${typ} token.`);
  }
  return decoded;
};

export const verifyAccessToken = (token: string): SignedClaims => verify(token, 'access');
export const verifyRefreshToken = (token: string): SignedClaims => verify(token, 'refresh');
