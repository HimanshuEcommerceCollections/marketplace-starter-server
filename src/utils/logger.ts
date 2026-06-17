import { isProd } from "../config/env";

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, message: string, meta?: unknown): void {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  const extra = meta === undefined ? "" : meta;
  if (level === "error") console.error(line, extra);
  else if (level === "warn") console.warn(line, extra);
  else if (level === "debug") {
    if (!isProd) console.debug(line, extra);
  } else console.log(line, extra);
}

/**
 * Minimal structured-ish logger. Swap the body for pino/winston later without
 * touching call sites.
 */
export const logger = {
  debug: (message: string, meta?: unknown) => emit("debug", message, meta),
  info: (message: string, meta?: unknown) => emit("info", message, meta),
  warn: (message: string, meta?: unknown) => emit("warn", message, meta),
  error: (message: string, meta?: unknown) => emit("error", message, meta),
};
