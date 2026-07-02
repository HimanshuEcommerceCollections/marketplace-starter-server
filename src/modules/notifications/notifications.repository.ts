import { prisma } from "../../db/client";
import type { Prisma } from "@prisma/client";

export class NotificationsRepository {
  create(data: Prisma.NotificationUncheckedCreateInput) {
    return prisma.notification.create({ data });
  }
}

export const notificationsRepository = new NotificationsRepository();
