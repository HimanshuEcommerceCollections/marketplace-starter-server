import { Resend } from "resend";
import { env } from "./env";
import { ApiError } from "../utils/api-error";

/**
 * Lazily-constructed singleton Resend client. Built on first use (not at import
 * time) so the app still boots in environments without email credentials
 * (dev/test): email-dependent flows surface a clear 501 until RESEND_API_KEY is
 * present. Mirrors the shape of config/stripe.ts.
 */
let client: Resend | null = null;

export function getResendClient(): Resend {
  if (!env.RESEND_API_KEY) {
    throw ApiError.notImplemented("Email is not configured (set RESEND_API_KEY)");
  }
  if (!client) {
    client = new Resend(env.RESEND_API_KEY);
  }
  return client;
}
