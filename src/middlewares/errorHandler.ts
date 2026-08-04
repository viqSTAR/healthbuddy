import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/AppError.js';
import { isProduction, env } from '../config/env.js';

/** Maps an unknown thrown value to a client-safe status + message. */
const classify = (err: any): { status: number; message: string; expose: boolean } => {
  if (err instanceof AppError) {
    return { status: err.statusCode, message: err.message, expose: true };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return { status: 409, message: 'That record already exists.', expose: true };
    }
    if (err.code === 'P2025') {
      return { status: 404, message: 'Record not found.', expose: true };
    }
    if (err.code === 'P2003') {
      return { status: 400, message: 'Referenced record does not exist.', expose: true };
    }
  }

  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return {
        status: 413,
        message: `That file is larger than the ${env.MAX_UPLOAD_MB} MB limit.`,
        expose: true,
      };
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return { status: 400, message: 'Send the file as the "file" field.', expose: true };
    }
    return { status: 400, message: 'File upload failed.', expose: true };
  }

  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return { status: 400, message: 'Malformed JSON body.', expose: true };
  }

  // Anything unrecognised is a bug, not a client error — do not echo its
  // message back, since internal errors routinely embed table names and paths.
  return { status: 500, message: 'Internal server error.', expose: false };
};

export const errorHandler = (err: any, req: Request, res: Response, _next: NextFunction) => {
  const { status, message, expose } = classify(err);

  const context = `${req.method} ${req.originalUrl}`;
  if (status >= 500) {
    logger.error(`[${status}] ${context} — ${err?.message}`, err?.stack ?? '');
  } else {
    logger.warn(`[${status}] ${context} — ${message}`);
  }

  res.status(status).json({
    success: false,
    error: expose ? message : 'Internal server error.',
    // Stack traces are development-only AND never attached to exposed 4xx.
    ...(!isProduction && !expose && err?.stack ? { stack: err.stack } : {}),
  });
};

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({ success: false, error: `No route matches ${req.method} ${req.originalUrl}.` });
};
