import "dotenv/config";
import { z } from "zod";

/**
 * Validated environment. Importing this module fails fast (process.exit) if any
 * required variable is missing or malformed, so the rest of the app can treat
 * `env` as fully trustworthy and correctly typed.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  // Database
  DATABASE_URL: z
    .string()
    .url("DATABASE_URL must be a valid Postgres connection string"),

  // JWT
  JWT_ACCESS_SECRET: z
    .string()
    .min(16, "JWT_ACCESS_SECRET must be at least 16 characters"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(16, "JWT_REFRESH_SECRET must be at least 16 characters"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

  // Security
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  CORS_ORIGIN: z.string().default("*"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

  // Service assets. Uploaded icon/cover files are written under
  // <ASSET_STORAGE_DIR>/services/<slug>/ and served at the matching
  // /services/<slug>/... URL. Defaults to the Next.js client's public/ dir
  // (sibling package) so the frontend serves them directly with no CORS or
  // origin juggling. The mutable asset registry (slug -> paths) is a JSON file
  // — NOT a TS module — because it must be read AND written at runtime; a
  // statically-imported const cannot be mutated and persisted. See
  // src/config/service-image-assets.ts.
  ASSET_STORAGE_DIR: z.string().optional(),
  SERVICE_ASSETS_FILE: z.string().optional(),

  // Stripe payments. Optional so the app still boots without them (dev/test):
  // payment routes respond 501 until the secret key is configured, and the
  // webhook 501s until the signing secret is set. STRIPE_PUBLISHABLE_KEY is
  // surfaced to the client so it can initialize Stripe.js.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const isDev = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";
