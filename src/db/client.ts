import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";

/**
 * Single shared PrismaClient. Reused across dev hot-reloads (via globalThis) so
 * we don't exhaust the database connection pool by creating a new client on
 * every reload.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
