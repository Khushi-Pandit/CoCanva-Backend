import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError, z } from 'zod';
import { ValidationError } from '../utils/errors';

type ValidateTarget = 'body' | 'query' | 'params';

/**
 * Factory that returns an Express middleware which validates req[target]
 * against the provided Zod schema. Replaces req[target] with the parsed
 * (coerced + stripped) output on success.
 */
export function validate(schema: AnyZodObject, target: ValidateTarget = 'body') {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req[target]);
      (req as unknown as Record<string, unknown>)[target] = parsed;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.flatten().fieldErrors;
        next(new ValidationError('Request validation failed', details));
      } else {
        next(err);
      }
    }
  };
}

// ── Common reusable schemas ──────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

export const canvasIdParamSchema = z.object({
  id: objectIdSchema,
});
