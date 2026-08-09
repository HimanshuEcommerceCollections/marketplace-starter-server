import { createApp } from "./app";
import { env } from "./config/env";
import { prisma } from "./db/client";
import { logger } from "./utils/logger";
import { logEmailStartupState } from "./modules/email";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    `Server listening on http://localhost:${env.PORT} (${env.NODE_ENV})`,
  );
  // Surface the mail setup at boot: a missing credential is otherwise invisible
  // until the first signup tries to send.
  logEmailStartupState();
});

/** Close the HTTP server and DB connections cleanly on shutdown signals. */
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down`);
  // `close()` waits for keep-alive connections indefinitely; force the exit if
  // the drain hasn't finished within the grace period.
  const forceExit = setTimeout(() => {
    logger.error("Graceful shutdown timed out — forcing exit");
    server.closeAllConnections?.();
    process.exit(1);
  }, 10_000);
  forceExit.unref(); // the timer itself must not keep the process alive
  server.close(() => {
    clearTimeout(forceExit);
    void prisma.$disconnect().finally(() => process.exit(0));
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
