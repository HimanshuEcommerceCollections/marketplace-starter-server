// Domain enums are owned by the Prisma schema (single source of truth) and
// re-exported here so application code imports them from a stable path
// (`../enums`) rather than reaching into the generated client everywhere.
export {
  UserRole,
  UserStatus,
  BookingStatus,
  PaymentStatus,
  WaitlistStatus,
  LocationMode,
  NotificationType,
  NotificationStatus,
} from "@prisma/client";

export * from "./app.enums";
