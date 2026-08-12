import { z } from 'zod';

// Environment variable validation
export const envSchema = z.object({
  PORT: z.string().default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().optional(),
  ENCRYPTION_KEY: z.string().length(64),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  GOOGLE_AI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  REDIS_URL: z.string().url().optional(),
  SALESFORCE_CLIENT_ID: z.string().min(1),
  SALESFORCE_CLIENT_SECRET: z.string().min(1),
  SALESFORCE_REDIRECT_URI: z.string().url(),
  HMAC_SECRET: z.string().min(32, 'HMAC_SECRET must be at least 32 characters'),
  ADMIN_USER: z.string().optional(),
  ADMIN_PASS: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_PRIVATE_KEY: z.string().optional()
});
