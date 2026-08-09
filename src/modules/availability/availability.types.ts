import type { z } from "zod";
import type { createSlotSchema, listSlotsSchema } from "./availability.validation";

export type CreateSlotDto = z.infer<typeof createSlotSchema>;
export type ListSlotsQuery = z.infer<typeof listSlotsSchema>;

/**
 * Authenticated caller of a slot-management endpoint (mirrors bookings'
 * requester shape). Staff (admin/coordinator) manage any provider's slots;
 * providers are scoped to their own ServiceProvider record.
 */
export interface SlotActor {
  id: string;
  isStaff: boolean;
}
