import { Router } from "express";
import { prisma } from "../db/client";
import { authRouter } from "../modules/auth";
import { usersRouter } from "../modules/users";
import { servicesRouter } from "../modules/services";
import { bookingsRouter } from "../modules/bookings";
import { availabilityRouter } from "../modules/availability";
import { waitlistRouter } from "../modules/waitlist";
import { reviewsRouter } from "../modules/reviews";
import { adminRouter } from "../modules/admin";
import { paymentsRouter } from "../modules/payments";
import { corporateInquiryRouter } from "../modules/corporateInquiry";
import { professionalApplicationsRouter } from "../modules/professionalApplications";
import { areasRouter } from "../modules/areas";
import { zipCodesRouter } from "../modules/zipCodes";
import { coverageRouter } from "../modules/coverage";

/**
 * Liveness/readiness probe (also verifies DB connectivity). Exported as its own
 * router so app.ts can mount it BEFORE the general rate limiter — platform
 * health checks must never consume the shared request budget or get 429'd
 * (Render would restart a perfectly healthy instance).
 */
export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected" });
  } catch {
    res.status(503).json({ status: "degraded", db: "unreachable" });
  }
});

/** API v1 router — aggregates every feature module under one mount point. */
export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/services", servicesRouter);
apiRouter.use("/bookings", bookingsRouter);
apiRouter.use("/availability", availabilityRouter);
apiRouter.use("/waitlist", waitlistRouter);
apiRouter.use("/reviews", reviewsRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/payments", paymentsRouter);
apiRouter.use("/corporate-inquiries", corporateInquiryRouter);
apiRouter.use("/professional-applications", professionalApplicationsRouter);

// Service coverage: admin-managed geography (areas + their ZIP codes) and the
// per-service availability rules resolved from them at booking time. `/coverage`
// also carries the public ZIP availability check the booking flow calls.
apiRouter.use("/areas", areasRouter);
apiRouter.use("/zip-codes", zipCodesRouter);
apiRouter.use("/coverage", coverageRouter);
