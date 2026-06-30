import { Prisma } from "@prisma/client";
import { prisma } from "../../db/client";
import { PaymentStatus } from "../../enums";

/** Either the shared client or a transaction-scoped client. */
type DbClient = Prisma.TransactionClient | typeof prisma;

const bookingSelect = {
  booking: { select: { id: true, customerId: true, reference: true, status: true } },
} satisfies Prisma.PaymentInclude;

export type PaymentWithBooking = Prisma.PaymentGetPayload<{
  include: typeof bookingSelect;
}>;

export class PaymentsRepository {
  findById(id: string) {
    return prisma.payment.findUnique({ where: { id } });
  }
  findByIdWithBooking(id: string) {
    return prisma.payment.findUnique({ where: { id }, include: bookingSelect });
  }
  findByBookingId(bookingId: string) {
    return prisma.payment.findUnique({ where: { bookingId } });
  }
  findByExternalId(externalId: string) {
    return prisma.payment.findFirst({ where: { externalId }, include: bookingSelect });
  }

  /** One Payment per booking (bookingId is unique). Re-requesting an intent for
   *  a non-paid booking resets it to PENDING and clears the stale external id. */
  upsertForBooking(data: {
    bookingId: string;
    amount: number;
    currency: string;
    provider: string;
  }) {
    return prisma.payment.upsert({
      where: { bookingId: data.bookingId },
      create: {
        bookingId: data.bookingId,
        amount: data.amount,
        currency: data.currency,
        provider: data.provider,
        status: PaymentStatus.PENDING,
      },
      update: {
        amount: data.amount,
        currency: data.currency,
        provider: data.provider,
        status: PaymentStatus.PENDING,
        externalId: null,
      },
    });
  }

  update(id: string, data: Prisma.PaymentUncheckedUpdateInput) {
    return prisma.payment.update({ where: { id }, data });
  }

  updateStatus(id: string, status: PaymentStatus, client: DbClient = prisma) {
    return client.payment.update({ where: { id }, data: { status } });
  }

  findWebhookEvent(eventId: string) {
    return prisma.webhookEvent.findUnique({ where: { eventId } });
  }

  recordWebhookEvent(
    data: { provider: string; eventId: string; type: string },
    client: DbClient = prisma,
  ) {
    return client.webhookEvent.create({ data });
  }
}

export const paymentsRepository = new PaymentsRepository();
