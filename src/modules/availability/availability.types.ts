import type { z } from "zod";
import type { createSlotSchema, listSlotsSchema } from "./availability.validation";

export type CreateSlotDto = z.infer<typeof createSlotSchema>;
export type ListSlotsQuery = z.infer<typeof listSlotsSchema>;
