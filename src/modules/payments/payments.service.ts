import { Prisma, type Payment } from "@prisma/client";
import { prisma } from "../../db/client";
import { ApiError } from "../../utils/api-error";
import { logger } from "../../utils/logger";
import { env } from "../../config/env";
import { Messages } from "../../constants/messages";
import { BookingStatus, PaymentStatus } from "../../enums";
import { bookingsService } from "../bookings/bookings.service";
import type { BookingRequester } from "../bookings/bookings.types";
import { notificationsService } from "../notifications";
import { paymentsRepository, type PaymentWithBooking } from "./payments.repository";
import { resolveProvider, type PaymentProvider } from "./providers";
import type {
  CreateIntentResult,
  PaymentResponse,
  RefundDto,
  RefundResult,
} from "./payments.types";

export class PaymentsService {
  /**
   * Create (or reuse) a provider PaymentIntent for a PENDING booking. The
   * charge amount is taken ONLY from the persisted booking snapshot — the
   * client never supplies it.
   */
  async createIntent(
    bookingId: string,
    requester: BookingRequester,
  ): Promise<CreateIntentResult> {
    const provider = resolveProvider();
    const booking = await bookingsService.getEntity(bookingId, requester);

    if (booking.status === BookingStatus.CANCELLED) {
      throw ApiError.badRequest("Cannot pay for a cancelled booking");
    }
    if (booking.status !== BookingStatus.PENDING) {
      throw ApiError.badRequest(Messages.PAYMENT.BOOKING_NOT_PAYABLE);
    }

    const existing = await paymentsRepository.findByBookingId(bookingId);
    if (existing?.status === PaymentStatus.PAID) {
      throw ApiError.conflict(Messages.PAYMENT.ALREADY_PAID);
    }

    // Reuse a still-open intent so repeat calls never create duplicate intents.
    if (
      existing &&
      existing.externalId &&
      (existing.status === PaymentStatus.PENDING ||
        existing.status === PaymentStatus.AUTHORIZED)
    ) {
      const reused = await provider.retrieveOpenIntent(existing.externalId);
      if (reused) {
        return this.toIntentResult(existing, reused.clientSecret);
      }
    }

    const payment = await paymentsRepository.upsertForBooking({
      bookingId: booking.id,
      amount: booking.priceAmount,
      currency: booking.currency,
      provider: provider.name,
    });

    const intent = await provider.createIntent({
      amount: booking.priceAmount,
      currency: booking.currency,
      bookingId: booking.id,
      paymentId: payment.id,
      // Suffixed with the row's upsert timestamp: a bare `intent_<id>` would be
      // replayed by the provider for 24h, handing back a CANCELED intent from a
      // previous attempt and locking the customer out of paying. Duplicate
      // intents across calls are already prevented by the reuse branch above.
      idempotencyKey: `intent_${payment.id}_${payment.updatedAt.getTime()}`,
    });

    const updated = await paymentsRepository.update(payment.id, {
      externalId: intent.externalId,
    });

    logger.info("Created payment intent", {
      paymentId: payment.id,
      bookingId: booking.id,
      externalId: intent.externalId,
      amount: booking.priceAmount,
      currency: booking.currency,
    });

    return this.toIntentResult(updated, intent.clientSecret);
  }

  async getById(
    id: string,
    requester: BookingRequester,
  ): Promise<PaymentResponse> {
    const payment = await paymentsRepository.findByIdWithBooking(id);
    if (!payment) throw ApiError.notFound("Payment not found");
    if (!requester.isStaff && payment.booking.customerId !== requester.id) {
      throw ApiError.forbidden("You cannot access this payment");
    }
    return this.serialize(payment);
  }

  /**
   * Staff-initiated refund. The Payment/Booking state is updated only when the
   * provider confirms via the refund webhook — never optimistically here.
   */
  async refund(id: string, dto: RefundDto): Promise<RefundResult> {
    const provider = resolveProvider();
    const payment = await paymentsRepository.findById(id);
    if (!payment) throw ApiError.notFound("Payment not found");
    if (
      payment.status !== PaymentStatus.PAID &&
      payment.status !== PaymentStatus.PARTIALLY_REFUNDED
    ) {
      throw ApiError.badRequest(Messages.PAYMENT.NOT_REFUNDABLE);
    }
    if (!payment.externalId) {
      throw ApiError.badRequest("Payment has no provider reference to refund");
    }
    if (dto.amount && dto.amount > payment.amount) {
      throw ApiError.badRequest("Refund amount exceeds the payment amount");
    }

    // Validate against the REMAINING balance, not the original total, so an
    // over-refund fails here with a clear message instead of as an opaque
    // provider error. The refunded-so-far total also keys the idempotency:
    // a double-clicked request (state unchanged) replays safely, while a
    // deliberate second refund of the same amount (state advanced) is a new
    // key — with the old static key it silently never happened.
    const refundedSoFar = await provider.retrieveRefundedTotal(payment.externalId);
    if (
      refundedSoFar !== null &&
      dto.amount &&
      dto.amount > payment.amount - refundedSoFar
    ) {
      throw ApiError.badRequest(
        "Refund amount exceeds the remaining refundable balance",
      );
    }

    const refund = await provider.refund({
      externalId: payment.externalId,
      amount: dto.amount,
      idempotencyKey: `refund_${payment.id}_${dto.amount ?? "full"}_${refundedSoFar ?? "unknown"}`,
    });

    logger.info("Initiated refund", {
      paymentId: payment.id,
      externalId: payment.externalId,
      amount: dto.amount ?? payment.amount,
      refundId: refund.externalId,
    });

    return { paymentId: payment.id, refundId: refund.externalId, status: refund.status };
  }

  /**
   * Verify, de-duplicate, and apply a provider webhook event. Idempotent: a
   * redelivered event short-circuits on the WebhookEvent ledger, and concurrent
   * duplicates collide on its unique eventId inside the transaction.
   */
  async handleProviderEvent(
    provider: PaymentProvider,
    rawBody: Buffer | string,
    signature: string,
  ) {
    const event = provider.verifyAndParseEvent(rawBody, signature);

    // The provider account is shared with sibling projects, and a shared account
    // delivers every subscribed event to every registered endpoint — so a good
    // chunk of what arrives here belongs to another project. Drop those before
    // they touch the DB: no ledger row (ignoring is inherently idempotent), no
    // error log. Only a tag that is PRESENT and MISMATCHED is discarded; an
    // absent tag falls through to the lookup below so payments created before
    // tagging existed still settle correctly.
    if (event.projectTag && event.projectTag !== env.PAYMENT_PROJECT_TAG) {
      logger.debug("Ignoring webhook event from another project", {
        provider: provider.name,
        eventId: event.id,
        type: event.type,
        projectTag: event.projectTag,
      });
      return { received: true, ignored: true };
    }

    if (await paymentsRepository.findWebhookEvent(event.id)) {
      logger.info("Ignoring duplicate webhook event", {
        provider: provider.name,
        eventId: event.id,
        type: event.type,
      });
      return { received: true, duplicate: true };
    }

    // Events we don't act on (and any without a payment reference) are still
    // recorded so redeliveries short-circuit.
    if (event.kind === "unhandled" || !event.externalId) {
      await paymentsRepository.recordWebhookEvent({
        provider: provider.name,
        eventId: event.id,
        type: event.type,
      });
      return { received: true, handled: false };
    }

    const payment = await paymentsRepository.findByExternalId(event.externalId);
    if (!payment) {
      // Not an error: with the project guard above, reaching here means an
      // UNTAGGED event we can't attribute — typically a sibling project on the
      // shared account that doesn't stamp metadata.project.
      logger.warn("Webhook references an unknown payment", {
        eventId: event.id,
        externalId: event.externalId,
      });
      await paymentsRepository.recordWebhookEvent({
        provider: provider.name,
        eventId: event.id,
        type: event.type,
      });
      return { received: true, handled: false };
    }

    let paymentStatus: PaymentStatus;
    let bookingStatus: BookingStatus | undefined;
    switch (event.kind) {
      case "payment_succeeded":
        // Payment captured — but the booking stays PENDING for an admin/
        // coordinator to confirm or reject. Only staff move it to CONFIRMED
        // (business rule: a paid request is reviewed before it's confirmed).
        paymentStatus = PaymentStatus.PAID;
        break;
      case "payment_failed":
      case "payment_canceled":
        paymentStatus = PaymentStatus.FAILED;
        break;
      case "refunded": {
        // Compare against the authoritative booking-snapshot amount on our row.
        const fullyRefunded = (event.amountRefunded ?? 0) >= payment.amount;
        paymentStatus = fullyRefunded
          ? PaymentStatus.REFUNDED
          : PaymentStatus.PARTIALLY_REFUNDED;
        if (fullyRefunded) bookingStatus = BookingStatus.CANCELLED;
        break;
      }
      default:
        throw ApiError.internal("Unreachable webhook event kind");
    }

    // Providers do not guarantee delivery ORDER, only (at-least-once) delivery.
    // Without this guard a late `payment_intent.succeeded` delivered after
    // `charge.refunded` would flip a fully-refunded payment back to PAID. The
    // event is still recorded in the ledger so its redelivery short-circuits.
    if (this.isStaleTransition(payment.status, paymentStatus)) {
      logger.warn("Ignoring out-of-order webhook transition", {
        eventId: event.id,
        type: event.type,
        paymentId: payment.id,
        currentStatus: payment.status,
        eventStatus: paymentStatus,
      });
      await paymentsRepository.recordWebhookEvent({
        provider: provider.name,
        eventId: event.id,
        type: event.type,
      });
      return { received: true, handled: false };
    }

    // Money captured for a booking that is no longer happening (the customer
    // paid from a stale checkout tab, or the intent-cancel race lost). The
    // capture is a fact — record PAID so the refund flow works — but flag it
    // loudly: nothing else will prompt the manual refund this needs.
    if (
      paymentStatus === PaymentStatus.PAID &&
      payment.booking.status === BookingStatus.CANCELLED
    ) {
      logger.error("Payment captured for a CANCELLED booking — needs manual refund", {
        eventId: event.id,
        paymentId: payment.id,
        bookingId: payment.bookingId,
        bookingReference: payment.booking.reference,
        amount: payment.amount,
      });
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Insert the ledger row first: the unique eventId makes concurrent
        // duplicate deliveries collide here (P2002) instead of double-applying.
        await paymentsRepository.recordWebhookEvent(
          { provider: provider.name, eventId: event.id, type: event.type },
          tx,
        );
        await paymentsRepository.updateStatus(payment.id, paymentStatus, tx);
        if (bookingStatus) {
          // Same transaction as the payment so money + booking stay consistent.
          await tx.booking.update({
            where: { id: payment.bookingId },
            data: { status: bookingStatus },
          });
        }
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        logger.info("Concurrent duplicate webhook event ignored", {
          eventId: event.id,
        });
        return { received: true, duplicate: true };
      }
      throw err;
    }

    logger.info("Processed payment webhook", {
      eventId: event.id,
      type: event.type,
      paymentId: payment.id,
      paymentStatus,
      bookingStatus,
    });

    await this.notify(payment, bookingStatus);

    return { received: true, handled: true };
  }

  /**
   * True when applying `next` on top of `current` would move the payment
   * BACKWARD in its lifecycle — the signature of an out-of-order webhook.
   * Forward moves and same-status no-ops are allowed.
   */
  private isStaleTransition(current: PaymentStatus, next: PaymentStatus): boolean {
    switch (current) {
      case PaymentStatus.REFUNDED:
        // Fully settled; nothing may follow.
        return next !== PaymentStatus.REFUNDED;
      case PaymentStatus.PARTIALLY_REFUNDED:
        // Only further refund progress is meaningful.
        return (
          next !== PaymentStatus.REFUNDED &&
          next !== PaymentStatus.PARTIALLY_REFUNDED
        );
      case PaymentStatus.PAID:
        // A capture can only move on to refunds; a late failed/canceled event
        // for the same intent must not un-pay it.
        return next === PaymentStatus.FAILED || next === PaymentStatus.PENDING;
      default:
        // PENDING/AUTHORIZED/FAILED accept whatever the provider reports.
        return false;
    }
  }

  /** Best-effort notification write; a failure here must never fail the webhook.
   *  Only a booking-status change (e.g. full refund → CANCELLED) notifies here —
   *  the "booking confirmed" notice is sent when a coordinator confirms, not at
   *  payment time (a paid booking is still PENDING review). */
  private async notify(
    payment: PaymentWithBooking,
    bookingStatus?: BookingStatus,
  ): Promise<void> {
    try {
      if (bookingStatus === BookingStatus.CANCELLED) {
        await notificationsService.notifyBookingCancelled(
          payment.booking.customerId,
          payment.booking,
        );
      }
    } catch (err) {
      logger.error("Failed to write payment notification", err);
    }
  }

  private toIntentResult(payment: Payment, clientSecret: string): CreateIntentResult {
    return {
      paymentId: payment.id,
      clientSecret,
      amount: payment.amount,
      currency: payment.currency,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
    };
  }

  private serialize(payment: Payment): PaymentResponse {
    return {
      id: payment.id,
      bookingId: payment.bookingId,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      provider: payment.provider,
      externalId: payment.externalId,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
    };
  }
}

export const paymentsService = new PaymentsService();
