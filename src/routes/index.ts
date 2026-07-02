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

/** API v1 router — aggregates every feature module under one mount point. */
export const apiRouter = Router();

// Liveness/readiness probe (also verifies DB connectivity).
apiRouter.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected" });
  } catch {
    res.status(503).json({ status: "degraded", db: "unreachable" });
  }
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/services", servicesRouter);
apiRouter.use("/bookings", bookingsRouter);
apiRouter.use("/availability", availabilityRouter);
apiRouter.use("/waitlist", waitlistRouter);
apiRouter.use("/reviews", reviewsRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/payments", paymentsRouter);
