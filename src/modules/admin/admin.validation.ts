import { z } from "zod";

/** Optional date range for dashboard reports (reserved for future filtering). */
export const dashboardQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
