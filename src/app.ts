import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env, isTest, isProd } from "./config/env";
import { apiRouter, healthRouter } from "./routes";
import { paymentsWebhookRouter } from "./modules/payments";
import { errorHandler } from "./middleware/error-handler";
import { notFound } from "./middleware/not-found";
import { generalRateLimiter } from "./middleware/rate-limit";

/** Build and configure the Express app. Does not start listening. */
export function createApp() {
  const app = express();

  app.disable("x-powered-by");

  // Behind a reverse proxy (Render terminates TLS and forwards traffic),
  // req.ip is the proxy's address unless Express is told to read
  // X-Forwarded-For. Without this every visitor shares ONE rate-limit bucket —
  // 10 failed logins by anyone lock out sign-in site-wide. `1` trusts exactly
  // one hop (the platform proxy), so clients still can't spoof their IP.
  app.set("trust proxy", 1);

  // Security & parsing
  app.use(helmet());
  app.use(
    cors({
      // Trim entries: "https://a.com, https://b.com" must not yield a
      // " https://b.com" that never matches.
      origin:
        env.CORS_ORIGIN === "*"
          ? true
          : env.CORS_ORIGIN.split(",").map((o) => o.trim()),
      credentials: true,
    }),
  );
  // Provider webhooks (Stripe, …) verify a signature against the EXACT raw
  // request body, so they must receive the unparsed body. Mounted with
  // express.raw() BEFORE express.json() (and before the /api rate limiter) so
  // the global JSON parser never touches the payload. Bypasses auth by design —
  // authenticity is proven by the signature.
  app.use(
    "/api/v1/payments/webhook",
    express.raw({ type: "application/json" }),
    paymentsWebhookRouter,
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging (quiet during tests)
  if (!isTest) {
    app.use(morgan(isProd ? "combined" : "dev"));
  }

  // Health probe stays OUTSIDE the rate limiter (see routes/index.ts for why).
  app.use("/api/v1/health", healthRouter);

  // Rate limiting + versioned API
  app.use("/api", generalRateLimiter);
  app.use("/api/v1", apiRouter);

  // 404 + error handling (must come last)
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
