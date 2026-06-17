import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./db/client";
import { logger } from "./utils/logger";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    `Server listening on http://localhost:${env.PORT} (${env.NODE_ENV})`,
  );
});

/** Close the HTTP server and DB connections cleanly on shutdown signals. */
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down`);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
