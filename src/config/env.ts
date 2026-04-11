import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),

  // Database
  MONGO_URL: z.string().min(1, 'MONGO_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Firebase
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),

  // AI
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  AI_MODEL_CHAT: z.string().default('claude-opus-4-5'),
  AI_MODEL_FAST: z.string().default('claude-haiku-4-5-20251001'),
  AI_DEFAULT_MODEL: z.enum(['auto', 'claude', 'gemini', 'groq']).default('auto'),
  AI_RATE_LIMIT_PER_HOUR: z.coerce.number().default(60),

  // Storage
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().default('drawsync-assets'),
  R2_ENDPOINT: z.string().optional(),
  CDN_BASE_URL: z.string().default('http://localhost:4000/assets'),

  // Email
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('noreply@drawsync.app'),

  // Feature flags
  ENABLE_GHOST_AI: z.coerce.boolean().default(true),
  ENABLE_SPATIAL_VOICE: z.coerce.boolean().default(true),
  ENABLE_BRANCHING: z.coerce.boolean().default(true),
  ENABLE_VECTOR_SEARCH: z.coerce.boolean().default(false),

  // Dev overrides
  DEV_AUTH_BYPASS: z.coerce.boolean().default(false),
  DEV_AUTH_USER_ID: z.string().default('dev-user-firebase-uid'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
