import Stripe from "stripe";
import { getStripeClient } from "../../../config/stripe";
import { env } from "../../../config/env";
import { ApiError } from "../../../utils/api-error";
import type {
  PaymentProvider,
  CreateIntentParams,
  CreatedIntent,
  RefundParams,
  CreatedRefund,
  ProviderEvent,
} from "./payment-provider.interface";

/** PaymentIntent statuses for which the existing client secret is still usable. */
const OPEN_INTENT_STATUSES = new Set([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "processing",
]);

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  readonly signatureHeader = "stripe-signature";

  async createIntent(params: CreateIntentParams): Promise<CreatedIntent> {
    const stripe = getStripeClient();
    const intent = await stripe.paymentIntents.create(
      {
        amount: params.amount,
        currency: params.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        metadata: { bookingId: params.bookingId, paymentId: params.paymentId },
      },
      { idempotencyKey: params.idempotencyKey },
    );
    if (!intent.client_secret) {
      throw ApiError.internal("Stripe did not return a client secret");
    }
    return { externalId: intent.id, clientSecret: intent.client_secret };
  }

  async retrieveOpenIntent(
    externalId: string,
  ): Promise<{ clientSecret: string } | null> {
    const stripe = getStripeClient();
    try {
      const intent = await stripe.paymentIntents.retrieve(externalId);
      if (intent.client_secret && OPEN_INTENT_STATUSES.has(intent.status)) {
        return { clientSecret: intent.client_secret };
      }
      return null;
    } catch {
      return null;
    }
  }

  verifyAndParseEvent(rawBody: Buffer | string, signature: string): ProviderEvent {
    const stripe = getStripeClient();
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw ApiError.notImplemented("Stripe webhook secret is not configured");
    }
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        env.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      throw ApiError.badRequest("Invalid webhook signature");
    }
    return StripeProvider.mapEvent(event);
  }

  async refund(params: RefundParams): Promise<CreatedRefund> {
    const stripe = getStripeClient();
    const refund = await stripe.refunds.create(
      {
        payment_intent: params.externalId,
        ...(params.amount ? { amount: params.amount } : {}),
      },
      { idempotencyKey: params.idempotencyKey },
    );
    return { externalId: refund.id, status: refund.status ?? "pending" };
  }

  /** Map Stripe's event taxonomy onto our neutral ProviderEvent shape. */
  private static mapEvent(event: Stripe.Event): ProviderEvent {
    const base = { id: event.id, type: event.type };
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        return { ...base, kind: "payment_succeeded", externalId: pi.id };
      }
      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        return { ...base, kind: "payment_failed", externalId: pi.id };
      }
      case "payment_intent.canceled": {
        const pi = event.data.object as Stripe.PaymentIntent;
        return { ...base, kind: "payment_canceled", externalId: pi.id };
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const externalId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : (charge.payment_intent?.id ?? null);
        return {
          ...base,
          kind: "refunded",
          externalId,
          amountRefunded: charge.amount_refunded,
        };
      }
      default:
        return { ...base, kind: "unhandled", externalId: null };
    }
  }
}

export const stripeProvider = new StripeProvider();
