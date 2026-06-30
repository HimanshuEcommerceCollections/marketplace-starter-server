import Stripe from "stripe";
import { env } from "./env";
import { ApiError } from "../utils/api-error";

/**
 * Lazily-constructed singleton Stripe client. Built on first use (not at import
 * time) so the app still boots in environments without Stripe credentials
 * (dev/test): payment routes simply respond 501 until the keys are present.
 *
 * The SDK pins its own API version; we intentionally don't override it here.
 */
let client: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw ApiError.notImplemented("Stripe is not configured (set STRIPE_SECRET_KEY)");
  }
  if (!client) {
    client = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return client;
}
