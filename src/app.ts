import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env, isTest, isProd } from "./config/env";
import { apiRouter } from "./routes";
import { errorHandler } from "./middleware/error-handler";
import { notFound } from "./middleware/not-found";
import { generalRateLimiter } from "./middleware/rate-limit";

/** Build and configure the Express app. Does not start listening. */
export function createApp() {
  const app = express();

  app.disable("x-powered-by");

  // Security & parsing
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(","),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging (quiet during tests)
  if (!isTest) {
    app.use(morgan(isProd ? "combined" : "dev"));
  }

  // Rate limiting + versioned API
  app.use("/api", generalRateLimiter);
  app.use("/api/v1", apiRouter);

  // 404 + error handling (must come last)
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
