import "dotenv/config";
import { z } from "zod";

/**
 * Validated environment. Importing this module fails fast (process.exit) if any
 * required variable is missing or malformed, so the rest of the app can treat
 * `env` as fully trustworthy and correctly typed.
 */
/**
 * An optional string where a blank value means "unset". Commented-out-style
 * placeholders (`SMTP_HOST=""`) are common in .env files, and they must not beat
 * a code-side default — `??` alone would keep the empty string.
 */
const optionalString = () =>
  z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined));

/** Same, for numbers: a blank value must not coerce to 0 and fail validation. */
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

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
  // Expiries must be `ms`-package durations WITH a unit ("15m", "12h", "7d") —
  // jsonwebtoken reads a bare numeral like "15" as milliseconds.
  JWT_ACCESS_EXPIRES_IN: z
    .string()
    .regex(
      /^\d+(\.\d+)?\s*(ms|msecs?|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?|y|yrs?|years?)$/i,
      'JWT_ACCESS_EXPIRES_IN must be a duration with a unit, e.g. "15m", "12h", "7d" (a bare number is read as milliseconds)',
    )
    .default("15m"),
  JWT_REFRESH_EXPIRES_IN: z
    .string()
    .regex(
      /^\d+(\.\d+)?\s*(ms|msecs?|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?|y|yrs?|years?)$/i,
      'JWT_REFRESH_EXPIRES_IN must be a duration with a unit, e.g. "15m", "12h", "7d" (a bare number is read as milliseconds)',
    )
    .default("7d"),

  // Security
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  CORS_ORIGIN: z.string().default("*"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

  // Service assets are static files committed to the Next.js client's public/
  // dir and served from there; there is no upload API. SERVICE_ASSETS_FILE
  // points at the legacy JSON registry (slug -> paths) left over from that API.
  // It is still READ (and takes priority) so any deployment that accumulated
  // entries keeps rendering the same images; nothing writes it. Unset is normal
  // and falls back to <cwd>/data/service-assets.json; when that file is absent
  // (the usual case) resolution uses the committed defaults. See
  // src/config/service-image-assets.ts.
  SERVICE_ASSETS_FILE: z.string().optional(),

  // Stripe payments. Optional so the app still boots without them (dev/test):
  // payment routes respond 501 until the secret key is configured, and the
  // webhook 501s until the signing secret is set. STRIPE_PUBLISHABLE_KEY is
  // surfaced to the client so it can initialize Stripe.js.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // Brand identity stamped onto every payment this project creates. The Stripe
  // ACCOUNT is shared with sibling projects, so each intent carries
  // metadata.project = PAYMENT_PROJECT_TAG. That tag is what lets us (a) filter
  // this project's payments in the Dashboard/Search API, (b) namespace
  // idempotency keys (they are account-scoped, so an unprefixed key could
  // collide with a sibling project's), and (c) ignore webhook events belonging
  // to another project — a shared account delivers EVERY subscribed event to
  // EVERY registered endpoint. Keep the tag stable: changing it makes older
  // payments look foreign to the webhook guard.
  PAYMENT_PROJECT_TAG: z.string().min(1).default("elevate"),
  PAYMENT_BRAND_NAME: z.string().min(1).default("Elevate Health & Wellness"),
  // Appended to the ACCOUNT-level statement descriptor prefix on the customer's
  // card statement (e.g. "ACME* ELEVATE"). Env-tunable because the usable
  // length depends on that prefix: prefix + suffix must total <= 22 chars.
  // Stripe rejects < > \ " ' * — validated here so a bad value fails at boot,
  // not at charge time. Blank/unset simply omits the suffix.
  STRIPE_STATEMENT_DESCRIPTOR_SUFFIX: z
    .string()
    .max(22, "STRIPE_STATEMENT_DESCRIPTOR_SUFFIX must be at most 22 characters")
    .regex(
      /^[^<>\\"'*]*$/,
      "STRIPE_STATEMENT_DESCRIPTOR_SUFFIX cannot contain < > \\ \" ' or *",
    )
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined)),

  // Email transport. EMAIL_PROVIDER picks the adapter in
  // src/modules/email/providers: "gmail" is SMTP with Google's host/port
  // pre-filled, "smtp" is any other SMTP server (Mailgun/SES/Postmark/self
  // hosted), "resend" is Resend's HTTP API. Credentials for every adapter are
  // optional (Stripe precedent) so the app still boots without them in
  // dev/test — email-dependent flows surface a 501 naming the missing vars.
  // Unset means "auto-detect from whichever credentials are present" (resolved
  // below, after parsing): a box holding only RESEND_API_KEY must not silently
  // boot the unconfigured gmail adapter — with EMAIL_VERIFICATION_REQUIRED on,
  // that leaves every new signup unable to receive its verification email and
  // therefore unable to ever log in.
  EMAIL_PROVIDER: z.preprocess(
    blankToUndefined,
    z
      .string()
      .transform((v) => v.trim().toLowerCase())
      .pipe(z.enum(["gmail", "smtp", "resend"]))
      .optional(),
  ),

  // SMTP credentials, used by the "gmail" and "smtp" adapters. SMTP_HOST/PORT
  // may be omitted for "gmail" (it defaults to smtp.gmail.com:587). SMTP_SECURE
  // is tri-state: unset means "infer from the port" (implicit TLS on 465,
  // STARTTLS otherwise). For Gmail, SMTP_USER is the full address and
  // SMTP_PASSWORD must be a 16-character App Password — 2-Step Verification has
  // to be on, and the normal account password is rejected.
  SMTP_HOST: optionalString(),
  SMTP_PORT: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === ""
        ? undefined
        : ["true", "1", "yes", "on"].includes(v.trim().toLowerCase()),
    ),
  SMTP_USER: optionalString(),
  // Not trimmed beyond the blank check — a password is taken verbatim.
  SMTP_PASSWORD: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v : undefined)),

  // Resend HTTP API key, used by the "resend" adapter.
  RESEND_API_KEY: optionalString(),

  // Sender identity. EMAIL_FROM is an optional full override ("Name <addr>" or
  // a bare address); left unset, each adapter derives the address itself —
  // SMTP_USER for SMTP/Gmail, Resend's shared onboarding sender for Resend —
  // with EMAIL_FROM_NAME as the display name. Gmail refuses to send as an
  // address other than the authenticated account (or one of its verified
  // aliases), so on Gmail either leave EMAIL_FROM unset or point it at
  // SMTP_USER.
  EMAIL_FROM: optionalString(),
  EMAIL_FROM_NAME: z.preprocess(
    blankToUndefined,
    z.string().default("Elevate Health & Wellness"),
  ),

  // APP_URL is the FRONTEND base used to build clickable links in emails
  // (verification, booking details). EMAIL_VERIFICATION_TTL_MS controls how long
  // a verification token stays valid (default 24h).
  APP_URL: z.string().url().default("http://localhost:3000"),
  EMAIL_VERIFICATION_TTL_MS: z.coerce.number().int().positive().default(86_400_000),

  // Master switch for outbound notification email (booking confirmed/cancelled).
  // In-app notification rows are always written; this only governs whether they
  // are also emailed. Parsed like EMAIL_VERIFICATION_REQUIRED below.
  EMAIL_NOTIFICATIONS_ENABLED: z
    .string()
    .default("true")
    .transform((v) => !["false", "0", "no", "off"].includes(v.trim().toLowerCase())),

  // Master switch for the whole email-verification feature. Defaults to ON.
  // When disabled, new accounts are created ACTIVE + already-verified, no
  // verification email is sent, and the login/booking verification gates are
  // skipped. Parsed explicitly (NOT z.coerce.boolean(), which treats the string
  // "false" as true): only "false"/"0"/"no"/"off" disable it.
  EMAIL_VERIFICATION_REQUIRED: z
    .string()
    .default("true")
    .transform((v) => !["false", "0", "no", "off"].includes(v.trim().toLowerCase())),

  // ── Service coverage (areas + ZIP codes) ──────────────────────────────────
  // Booking-time enforcement of coverage. ON by default: a booking whose ZIP is
  // not served is rejected with a friendly message. Turning it OFF makes the
  // resolver still run and log its verdict but never reject — the rollback lever
  // if coverage data turns out to be wrong in production (a restart, no deploy).
  // Requires the geography migrations to have run; with an empty Area table and
  // enforcement ON, every ONSITE booking is refused.
  BOOKING_COVERAGE_ENFORCED: z
    .string()
    .default("true")
    .transform((v) => !["false", "0", "no", "off"].includes(v.trim().toLowerCase())),

  // When a customer's ZIP is not in the database at all, fall back to allowing
  // the booking against the area the client asked for, instead of refusing.
  // ON by default so an admin-created market stays bookable in the window
  // between creating it and loading its ZIP codes. Turn OFF once every ACTIVE
  // area has at least one ACTIVE ZIP.
  COVERAGE_ZIP_FALLBACK: z
    .string()
    .default("true")
    .transform((v) => !["false", "0", "no", "off"].includes(v.trim().toLowerCase())),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

/**
 * Resolve the email adapter when EMAIL_PROVIDER is unset: prefer whichever
 * transport actually has credentials. SMTP creds win over a Resend key (an
 * explicit SMTP setup is the more deliberate configuration); with neither,
 * fall back to "gmail" and let email flows 501 as before.
 */
function resolveEmailProviderDefault(
  data: z.infer<typeof EnvSchema>,
): "gmail" | "smtp" | "resend" {
  if (data.EMAIL_PROVIDER) return data.EMAIL_PROVIDER;
  if (data.SMTP_USER && data.SMTP_PASSWORD) {
    return data.SMTP_HOST ? "smtp" : "gmail";
  }
  if (data.RESEND_API_KEY) return "resend";
  return "gmail";
}

export const env = {
  ...parsed.data,
  EMAIL_PROVIDER: resolveEmailProviderDefault(parsed.data),
};
export const isProd = env.NODE_ENV === "production";
export const isDev = env.NODE_ENV === "development";
export const isTest = env.NODE_ENV === "test";

// Loud (non-fatal) boot warning: in production, verification emails are the
// gate to logging in at all. An unconfigured transport doesn't fail any env
// check, so surface it here instead of letting signups break silently.
if (isProd && env.EMAIL_VERIFICATION_REQUIRED) {
  const smtpReady = Boolean(env.SMTP_USER && env.SMTP_PASSWORD);
  const configured =
    env.EMAIL_PROVIDER === "resend" ? Boolean(env.RESEND_API_KEY) : smtpReady;
  if (!configured) {
    console.error(
      `⚠️  EMAIL_PROVIDER="${env.EMAIL_PROVIDER}" has no credentials but ` +
        "EMAIL_VERIFICATION_REQUIRED is on — new accounts cannot verify or log in. " +
        "Set SMTP_USER/SMTP_PASSWORD (gmail/smtp) or RESEND_API_KEY (resend).",
    );
  }
}
