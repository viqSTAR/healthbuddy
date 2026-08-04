/**
 * An error that is safe to surface to the client, carrying the HTTP status the
 * handler should use. Anything thrown that is NOT an AppError is treated as an
 * unexpected fault and reported as a generic 500 (see middlewares/errorHandler).
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly expose = true;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const notFound = (what: string) => new AppError(`${what} not found.`, 404);
export const forbidden = (msg = 'You do not have access to this resource.') => new AppError(msg, 403);
export const unauthorized = (msg = 'Authentication required.') => new AppError(msg, 401);
export const conflict = (msg: string) => new AppError(msg, 409);
