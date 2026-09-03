import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { verifyAccessToken, type SignedClaims, type JwtPayload, type Role } from '../utils/jwt.js';
import { assertSessionValid } from '../services/sessionService.js';
import { AppError, unauthorized, forbidden } from '../utils/AppError.js';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

/**
 * Two checks, not one.
 *
 * The signature proves the token was issued by this service. It says nothing
 * about whether the account behind it is still allowed to hold a session, and
 * that gap is what let a suspended account keep working until its token
 * expired. `assertSessionValid` closes it against the live account state — see
 * services/sessionService.
 */
export const authenticateJwt = async (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(unauthorized('Authentication required. No Bearer token provided.'));
  }

  let claims: SignedClaims;
  try {
    claims = verifyAccessToken(authHeader.slice('Bearer '.length).trim());
  } catch {
    return next(unauthorized('Invalid or expired access token.'));
  }

  try {
    await assertSessionValid(claims);
  } catch (err) {
    // A revoked session is a 401 with a reason. Anything else here is a failed
    // lookup, which must not be reported as "your token is bad" — that sends a
    // legitimate user into a sign-out loop over an outage.
    return next(
      err instanceof AppError ? err : new AppError('Could not verify the session.', 503)
    );
  }

  req.user = claims;
  next();
};

/**
 * Restricts a route to the given roles. Must be mounted AFTER authenticateJwt.
 * Previously imported but never applied, which left every admin and provider
 * queue readable by any authenticated patient.
 */
export const authorizeRoles = (...roles: Role[]) => {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden(`This endpoint requires one of: ${roles.join(', ')}.`));
    }
    next();
  };
};

/** Narrows `req.user` for handlers mounted behind authenticateJwt. */
export const requireUser = (req: AuthenticatedRequest): JwtPayload => {
  if (!req.user) throw unauthorized();
  return req.user;
};

/**
 * Resolves the caller's Patient id. Handlers previously used `userId` as if it
 * were a patient id and fell back to the literal string 'anonymous_patient',
 * which silently pooled unauthenticated writes into one shared bucket.
 */
export const requirePatientId = (req: AuthenticatedRequest): string => {
  const user = requireUser(req);
  if (!user.patientId) {
    throw forbidden('This action requires a patient profile.');
  }
  return user.patientId;
};

/**
 * Provider-profile resolvers. Each reads the id the server put in the token at
 * login — never a value supplied by the caller — so a partner can only ever act
 * on their own shop, and a doctor only on their own practice.
 */
export const requireDoctorId = (req: AuthenticatedRequest): string => {
  const user = requireUser(req);
  if (!user.doctorId) throw forbidden('This action requires a verified doctor profile.');
  return user.doctorId;
};

export const requirePharmacyId = (req: AuthenticatedRequest): string => {
  const user = requireUser(req);
  if (!user.pharmacyId) throw forbidden('This action requires a verified pharmacy profile.');
  return user.pharmacyId;
};

export const requireLabPartnerId = (req: AuthenticatedRequest): string => {
  const user = requireUser(req);
  if (!user.labPartnerId) throw forbidden('This action requires a verified lab profile.');
  return user.labPartnerId;
};

export const requireAgentId = (req: AuthenticatedRequest): string => {
  const user = requireUser(req);
  if (!user.agentId) throw forbidden('This action requires a delivery agent profile.');
  return user.agentId;
};

/** Wraps an async handler so rejected promises reach the error middleware. */
export const asyncHandler =
  <T extends AuthenticatedRequest>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
