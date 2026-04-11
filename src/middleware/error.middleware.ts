import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { randomUUID } from 'crypto';

/**
 * Central Express error handler.
 * Always returns { error: { code, message, details?, requestId } }
 */
export function errorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();

  if (err instanceof AppError && err.isOperational) {
    // Known operational error
    if (err.statusCode >= 500) {
      logger.error('Operational server error', {
        code: err.code,
        message: err.message,
        requestId,
        path: req.path,
        method: req.method,
      });
    }

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: (err as any).details,
        requestId,
      },
    });
    return;
  }

  // Unexpected / programmer error — don't leak details in production
  logger.error('Unhandled server error', {
    message: err.message,
    stack: err.stack,
    requestId,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message:
        env.NODE_ENV === 'production'
          ? 'An unexpected error occurred'
          : err.message,
      requestId,
    },
  });
}

/**
 * 404 handler — must be registered after all routes.
 */
export function notFoundMiddleware(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}
