import type { Prisma } from "@prisma/client";
import { notificationsRepository } from "./notifications.repository";
import { NotificationType } from "../../enums";

/** Minimal subset of a booking needed to compose a notification. */
interface BookingRef {
  id: string;
  reference: string;
}

/**
 * Persists in-app notifications. Delivery (email/push) is out of scope here —
 * rows are written with the default PENDING status for a future delivery worker.
 */
export class NotificationsService {
  notifyBookingConfirmed(userId: string, booking: BookingRef) {
    return notificationsRepository.create({
      userId,
      type: NotificationType.BOOKING_CONFIRMED,
      title: "Booking confirmed",
      body: `Your payment was received and booking ${booking.reference} is confirmed.`,
      data: { bookingId: booking.id } as Prisma.InputJsonValue,
    });
  }

  notifyBookingCancelled(userId: string, booking: BookingRef) {
    return notificationsRepository.create({
      userId,
      type: NotificationType.BOOKING_CANCELLED,
      title: "Booking cancelled",
      body: `Booking ${booking.reference} was cancelled following a refund.`,
      data: { bookingId: booking.id } as Prisma.InputJsonValue,
    });
  }
}

export const notificationsService = new NotificationsService();
