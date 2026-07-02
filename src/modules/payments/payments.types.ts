import type { z } from "zod";
import type { PaymentStatus } from "@prisma/client";
import type { createIntentSchema, refundSchema } from "./payments.validation";

export type CreateIntentDto = z.infer<typeof createIntentSchema>;
export type RefundDto = z.infer<typeof refundSchema>;

/** Returned to the client so it can confirm the payment with the provider SDK. */
export interface CreateIntentResult {
  paymentId: string;
  clientSecret: string;
  amount: number; // minor units
  currency: string;
  publishableKey: string | null;
}

/** Serialized Payment row (dates as ISO 8601 strings, per project convention). */
export interface PaymentResponse {
  id: string;
  bookingId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  provider: string | null;
  externalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RefundResult {
  paymentId: string;
  refundId: string;
  status: string;
}
