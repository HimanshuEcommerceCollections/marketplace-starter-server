import { z } from "zod";

export const createSlotSchema = z
  .object({
    serviceId: z.string().uuid().optional(),
    providerId: z.string().uuid().optional(),
    startTime: z.coerce.date(),
    endTime: z.coerce.date(),
  })
  .refine((d) => d.serviceId || d.providerId, {
    message: "serviceId or providerId is required",
  })
  .refine((d) => d.endTime > d.startTime, {
    message: "endTime must be after startTime",
  });

export const listSlotsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  serviceId: z.string().uuid().optional(),
  providerId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const slotIdSchema = z.object({ id: z.string().uuid() });
