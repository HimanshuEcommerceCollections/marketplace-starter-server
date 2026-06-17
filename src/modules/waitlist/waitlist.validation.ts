import { z } from "zod";
import { WaitlistStatus } from "../../enums";

export const joinWaitlistSchema = z.object({
  serviceId: z.string().uuid(),
  desiredDate: z.coerce.date().optional(),
});

export const listWaitlistSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  serviceId: z.string().uuid().optional(),
  status: z.nativeEnum(WaitlistStatus).optional(),
});

export const waitlistIdSchema = z.object({ id: z.string().uuid() });
