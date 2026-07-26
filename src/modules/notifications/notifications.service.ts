import type { Notification, Prisma } from "@prisma/client";
import { notificationsRepository } from "./notifications.repository";
import { NotificationStatus, NotificationType } from "../../enums";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { emailService } from "../email";

/** Minimal subset of a booking needed to compose a notification. */
interface BookingRef {
  id: string;
  reference: string;
}

/** Sends the email half of a notification; resolved per notification type. */
type EmailSender = (
  to: string,
  booking: BookingRef,
  recipientName?: string | null,
) => Promise<void>;

/**
 * Persists in-app notifications and emails them to the recipient. The row is the
 * source of truth and is written first; its `status` then records what happened
 * to the email — PENDING (not attempted: email disabled or unconfigured), SENT,
 * or FAILED. Delivery is best-effort by design: a mail outage must never fail
 * the booking or webhook that triggered it.
 */
export class NotificationsService {
  async notifyBookingConfirmed(
    userId: string,
    booking: BookingRef,
  ): Promise<Notification> {
    const notification = await notificationsRepository.create({
      userId,
      type: NotificationType.BOOKING_CONFIRMED,
      title: "Booking confirmed",
      body: `Your payment was received and booking ${booking.reference} is confirmed.`,
      data: { bookingId: booking.id } as Prisma.InputJsonValue,
    });

    await this.email(notification, userId, booking, (to, ref, name) =>
      emailService.sendBookingConfirmedEmail(to, ref, name),
    );

    return notification;
  }

  async notifyBookingCancelled(
    userId: string,
    booking: BookingRef,
  ): Promise<Notification> {
    const notification = await notificationsRepository.create({
      userId,
      type: NotificationType.BOOKING_CANCELLED,
      title: "Booking cancelled",
      body: `Booking ${booking.reference} was cancelled following a refund.`,
      data: { bookingId: booking.id } as Prisma.InputJsonValue,
    });

    await this.email(notification, userId, booking, (to, ref, name) =>
      emailService.sendBookingCancelledEmail(to, ref, name),
    );

    return notification;
  }

  /**
   * Best-effort email delivery for a persisted notification. Never throws: every
   * failure is logged and recorded on the row instead. Rows left PENDING were
   * never attempted, so a future delivery worker can still pick them up.
   */
  private async email(
    notification: Notification,
    userId: string,
    booking: BookingRef,
    send: EmailSender,
  ): Promise<void> {
    if (!env.EMAIL_NOTIFICATIONS_ENABLED) return;
    if (!emailService.isConfigured()) {
      logger.warn(
        `Notification ${notification.id} not emailed: email provider "${env.EMAIL_PROVIDER}" is not configured`,
      );
      return;
    }

    try {
      const recipient = await notificationsRepository.findRecipient(userId);
      if (!recipient?.email) {
        logger.warn(`Notification ${notification.id} has no recipient address`);
        return;
      }

      await send(recipient.email, booking, recipient.name);
      await notificationsRepository.updateStatus(
        notification.id,
        NotificationStatus.SENT,
      );
    } catch (err) {
      logger.error(`Failed to email notification ${notification.id}`, err);
      try {
        await notificationsRepository.updateStatus(
          notification.id,
          NotificationStatus.FAILED,
        );
      } catch (statusErr) {
        logger.error(
          `Failed to mark notification ${notification.id} as FAILED`,
          statusErr,
        );
      }
    }
  }
}

export const notificationsService = new NotificationsService();
