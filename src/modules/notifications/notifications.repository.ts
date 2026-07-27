import { prisma } from "../../db/client";
import type { Prisma, NotificationStatus } from "@prisma/client";

export class NotificationsRepository {
  create(data: Prisma.NotificationUncheckedCreateInput) {
    return prisma.notification.create({ data });
  }

  /** Delivery status transition (PENDING → SENT/FAILED) after an email attempt. */
  updateStatus(id: string, status: NotificationStatus) {
    return prisma.notification.update({ where: { id }, data: { status } });
  }

  /** Address + name needed to email the owner of a notification. */
  findRecipient(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
  }
}

export const notificationsRepository = new NotificationsRepository();
