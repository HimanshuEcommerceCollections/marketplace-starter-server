import { Router } from "express";
import { asyncHandler } from "../../utils/async-handler";
import { authenticate } from "../../middleware/authenticate";
import { authorize } from "../../middleware/authorize";
import { validate } from "../../middleware/validate";
import { publicFormRateLimiter } from "../../middleware/rate-limit";
import { UserRole } from "../../enums";
import { professionalApplicationsController } from "./professional-applications.controller";
import {
  createProfessionalApplicationSchema,
  listProfessionalApplicationsSchema,
  professionalApplicationIdSchema,
  updateProfessionalApplicationStatusSchema,
  acceptProfessionalApplicationSchema,
} from "./professional-applications.validation";

export const professionalApplicationsRouter = Router();

// Public: anyone can apply to join the marketplace (no auth).
professionalApplicationsRouter.post(
  "/",
  publicFormRateLimiter,
  validate({ body: createProfessionalApplicationSchema }),
  asyncHandler(professionalApplicationsController.create),
);

// Staff: read + triage.
const staffOnly = [
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR),
] as const;

professionalApplicationsRouter.get(
  "/",
  ...staffOnly,
  validate({ query: listProfessionalApplicationsSchema }),
  asyncHandler(professionalApplicationsController.list),
);
professionalApplicationsRouter.get(
  "/:id",
  ...staffOnly,
  validate({ params: professionalApplicationIdSchema }),
  asyncHandler(professionalApplicationsController.getById),
);
professionalApplicationsRouter.patch(
  "/:id/status",
  ...staffOnly,
  validate({
    params: professionalApplicationIdSchema,
    body: updateProfessionalApplicationStatusSchema,
  }),
  asyncHandler(professionalApplicationsController.updateStatus),
);

// Accept creates a real account with a real role, which is account provisioning
// — the same thing POST /users guards behind SYSTEM_ADMIN. A coordinator can
// triage and reject, but only an admin decides who gets onto the platform.
professionalApplicationsRouter.post(
  "/:id/accept",
  authenticate,
  authorize(UserRole.SYSTEM_ADMIN),
  validate({
    params: professionalApplicationIdSchema,
    body: acceptProfessionalApplicationSchema,
  }),
  asyncHandler(professionalApplicationsController.accept),
);
professionalApplicationsRouter.post(
  "/:id/reject",
  ...staffOnly,
  validate({ params: professionalApplicationIdSchema }),
  asyncHandler(professionalApplicationsController.reject),
);
