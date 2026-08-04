import type { Request, Response, NextFunction } from 'express';
import { z, type ZodType } from 'zod';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validates and REPLACES req.body/query/params with the parsed result, so
 * handlers receive typed, stripped data instead of raw client input.
 */
export const validate =
  (schemas: Schemas) =>
  (req: Request, res: Response, next: NextFunction): void => {
    for (const key of ['body', 'query', 'params'] as const) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (!result.success) {
        res.status(400).json({
          success: false,
          error: 'Request validation failed.',
          details: result.error.issues.map((i) => ({
            field: i.path.join('.') || key,
            message: i.message,
          })),
        });
        return;
      }

      // Express 5 exposes req.query via a getter, so assign through defineProperty.
      Object.defineProperty(req, key, { value: result.data, writable: true, configurable: true });
    }
    next();
  };

/* ---------- Shared field schemas ---------- */

export const phoneSchema = z
  .string()
  .trim()
  .min(8, 'Phone number is too short.')
  .max(20, 'Phone number is too long.')
  .regex(/^\+?[0-9\s\-()]+$/, 'Phone number contains invalid characters.');

export const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'The verification code must be exactly 6 digits.');

export const uuidSchema = z.string().uuid('Must be a valid id.');

export const latitudeSchema = z
  .number()
  .min(-90, 'Latitude must be between -90 and 90.')
  .max(90, 'Latitude must be between -90 and 90.');

export const longitudeSchema = z
  .number()
  .min(-180, 'Longitude must be between -180 and 180.')
  .max(180, 'Longitude must be between -180 and 180.');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
