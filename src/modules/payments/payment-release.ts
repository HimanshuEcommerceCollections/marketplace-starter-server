import { logger } from "../../utils/logger";
import { PaymentStatus } from "../../enums";
import { paymentsRepository } from "./payments.repository";
import { resolveProvider } from "./providers";

/**
 * Release (cancel) the open provider intent for a booking that is being
 * cancelled, so a customer with a still-live client secret — an open checkout
 * tab, a pending 3DS redirect — can no longer complete a charge for a service
 * that will never happen. Best-effort: a provider hiccup must not block the
 * cancellation itself; the webhook transition guard is the backstop.
 *
 * Lives outside payments.service on purpose: payments.service imports
 * bookingsService, so bookings.service calling back into it would create a
 * circular import. This file depends only on the repository and providers.
 */
export async function releasePaymentForBooking(bookingId: string): Promise<void> {
  try {
    const payment = await paymentsRepository.findByBookingId(bookingId);
    if (!payment?.externalId) return;
    if (
      payment.status !== PaymentStatus.PENDING &&
      payment.status !== PaymentStatus.AUTHORIZED
    ) {
      return; // settled (PAID/REFUNDED/…) — refunds are a deliberate staff action
    }
    await resolveProvider(payment.provider ?? undefined).cancelIntent(
      payment.externalId,
    );
    logger.info("Released open payment intent for cancelled booking", {
      bookingId,
      paymentId: payment.id,
      externalId: payment.externalId,
    });
  } catch (err) {
    logger.error("Failed to release payment intent for cancelled booking", {
      bookingId,
      err,
    });
  }
}
