import rateLimit from "express-rate-limit";
import { env } from "../config/env";

/** General API rate limiter, configured from env. */
export const generalRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later." },
});

/** Stricter limiter for auth endpoints (login/register) to slow brute force. */
export const authRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication attempts, please try again later.",
  },
});

/**
 * Limiter for email-verification endpoints (verify + resend). Keys on the target
 * email when present (the public resend body) so abuse is capped PER ADDRESS —
 * the real email-bombing guard — falling back to IP otherwise.
 *
 * IMPORTANT: behind the Next.js BFF all traffic reaches this API from one origin
 * (the proxy's IP), so the IP fallback is effectively a global bucket, not
 * per-user. The limit is therefore kept generous enough not to lock out
 * legitimate concurrent verification. For a true per-client IP cap, forward the
 * client IP from the BFF and set `trust proxy` (tracked as a follow-up).
 */
export const verifyRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const raw = (req.body as { email?: unknown } | undefined)?.email;
    const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    return email ? `verify:email:${email}` : `verify:ip:${req.ip ?? "unknown"}`;
  },
  message: {
    success: false,
    message: "Too many verification requests, please try again later.",
  },
});

/**
 * IP-keyed companion to `verifyRateLimiter` for the PUBLIC resend endpoint.
 * The per-email key above is attacker-supplied — rotating addresses mints a
 * fresh bucket per request, bypassing it entirely — so this second limiter
 * caps total requests per source IP regardless of the email in the body. Uses
 * the default keyGenerator (req.ip, IPv6-safe). Same BFF caveat as above: one
 * origin IP makes this effectively a global budget until the client IP is
 * forwarded.
 */
export const verifyIpRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many verification requests, please try again later.",
  },
});

/**
 * Limiter for anonymous public form submissions (corporate inquiries and
 * similar lead-gen endpoints). IP-keyed via the default keyGenerator; the BFF
 * caveat above applies here too, so the budget stays generous enough for
 * legitimate concurrent submissions while still blunting scripted spam.
 */
export const publicFormRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many submissions, please try again later.",
  },
});
