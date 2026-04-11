import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { RateLimitError } from '../utils/errors';

function makeRateLimiter(windowMs: number, max: number, message: string) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new RateLimitError(message));
    },
    skip: () => env.NODE_ENV === 'test',
  });
}

/** 30 requests / 15 min per IP — for auth endpoints */
export const authRateLimit = makeRateLimiter(
  15 * 60 * 1000,
  30,
  'Too many authentication attempts. Try again in 15 minutes.',
);

/** 500 requests / 15 min per user — general API */
export const apiRateLimit = makeRateLimiter(
  15 * 60 * 1000,
  500,
  'API rate limit exceeded. Try again in 15 minutes.',
);

/** 60 requests / hour — AI endpoints */
export const aiRateLimit = makeRateLimiter(
  60 * 60 * 1000,
  env.AI_RATE_LIMIT_PER_HOUR,
  'AI request limit reached. Resets in 1 hour.',
);

/** 100 uploads / day */
export const uploadRateLimit = makeRateLimiter(
  24 * 60 * 60 * 1000,
  100,
  'Upload limit reached for today.',
);
