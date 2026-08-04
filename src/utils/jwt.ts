import jwt, { type SignOptions } from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

export type Role = 'PATIENT' | 'DOCTOR' | 'LAB_PARTNER' | 'PHARMACY' | 'ADMIN';

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
}

/** `typ` separates the two token classes so a refresh token cannot authenticate a request. */
type TokenType = 'access' | 'refresh';

interface SignedClaims extends JwtPayload {
  typ: TokenType;
  jti: string;
}

const sign = (payload: JwtPayload, typ: TokenType): string => {
  const secret = typ === 'access' ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
  const expiresIn = typ === 'access' ? env.JWT_ACCESS_EXPIRES_IN : env.JWT_REFRESH_EXPIRES_IN;

  const claims: SignedClaims = { ...payload, typ, jti: randomUUID() };
  return jwt.sign(claims, secret, { expiresIn } as SignOptions);
};

export const generateTokens = (payload: JwtPayload) => ({
  accessToken: sign(payload, 'access'),
  refreshToken: sign(payload, 'refresh'),
});

const verify = (token: string, typ: TokenType): SignedClaims => {
  const secret = typ === 'access' ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
  const decoded = jwt.verify(token, secret) as SignedClaims;

  // Reject a token minted for the other purpose even if the secret matched.
  if (decoded.typ !== typ) {
    throw new jwt.JsonWebTokenError(`Expected a ${typ} token.`);
  }
  return decoded;
};

export const verifyAccessToken = (token: string): SignedClaims => verify(token, 'access');
export const verifyRefreshToken = (token: string): SignedClaims => verify(token, 'refresh');
