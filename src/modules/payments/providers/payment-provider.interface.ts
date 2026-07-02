/**
 * Provider-agnostic payment port. Booking/payment business logic depends on
 * this interface, never on a concrete SDK, so adding Razorpay/PayPal later is a
 * new adapter with zero changes to the service layer.
 *
 * All money values are integer MINOR units (cents), matching the rest of the
 * codebase and the Booking price snapshot.
 */

export type ProviderEventKind =
  | "payment_succeeded"
  | "payment_failed"
  | "payment_canceled"
  | "refunded"
  | "unhandled";

/** Neutral shape every provider event is mapped to before the service sees it. */
export interface ProviderEvent {
  id: string; // provider event id — the idempotency key
  type: string; // raw provider event type, kept for audit/logging
  kind: ProviderEventKind;
  externalId: string | null; // the PaymentIntent/charge reference this event concerns
  amountRefunded?: number; // minor units, present on refund events
}

export interface CreateIntentParams {
  amount: number; // minor units
  currency: string; // ISO code, e.g. "usd"
  bookingId: string;
  paymentId: string;
  idempotencyKey: string;
}

export interface CreatedIntent {
  externalId: string; // provider PaymentIntent id
  clientSecret: string;
}

export interface RefundParams {
  externalId: string; // provider PaymentIntent id
  amount?: number; // minor units; omit for a full refund
  idempotencyKey: string;
}

export interface CreatedRefund {
  externalId: string; // provider refund id
  status: string;
}

export interface PaymentProvider {
  readonly name: string;
  /** Request header carrying the webhook signature (e.g. "stripe-signature"). */
  readonly signatureHeader: string;

  createIntent(params: CreateIntentParams): Promise<CreatedIntent>;
  /** Returns the client secret of an existing intent if it is still payable, else null. */
  retrieveOpenIntent(externalId: string): Promise<{ clientSecret: string } | null>;
  /** Verifies the signature against the raw body and maps to a neutral event. Throws on a bad signature. */
  verifyAndParseEvent(rawBody: Buffer | string, signature: string): ProviderEvent;
  refund(params: RefundParams): Promise<CreatedRefund>;
}
