import type { z } from "zod";
import type { ConfigSelectionType, ConfigStatus, LocationMode, ServiceStatus } from "../../../enums";
import type {
  createConfigGroupSchema,
  updateConfigGroupSchema,
  createConfigOptionSchema,
  updateConfigOptionSchema,
  reorderGroupsSchema,
  reorderOptionsSchema,
} from "./service-config.validation";

export type CreateConfigGroupDto = z.infer<typeof createConfigGroupSchema>;
export type UpdateConfigGroupDto = z.infer<typeof updateConfigGroupSchema>;
export type CreateConfigOptionDto = z.infer<typeof createConfigOptionSchema>;
export type UpdateConfigOptionDto = z.infer<typeof updateConfigOptionSchema>;
export type ReorderGroupsDto = z.infer<typeof reorderGroupsSchema>;
export type ReorderOptionsDto = z.infer<typeof reorderOptionsSchema>;

/** A choice within a group (serialized API contract). */
export interface ConfigOptionResponse {
  id: string;
  key: string; // == pricing modifier option id (verbatim source id)
  label: string;
  priceModifier: number; // surcharge in minor units (cents); 0 = no change
  description: string | null;
  sortOrder: number;
  status: ConfigStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** A configurable dimension with its ordered options nested in. */
export interface ConfigGroupResponse {
  id: string;
  serviceId: string;
  key: string; // == pricing modifier id (verbatim source id)
  label: string;
  selectionType: ConfigSelectionType;
  isRequired: boolean;
  sortOrder: number;
  status: ConfigStatus;
  options: ConfigOptionResponse[];
  createdAt: Date;
  updatedAt: Date;
}

/** Booking-UI payload — a service WITH its full nested configuration. */
export interface ServiceWithConfigResponse {
  id: string;
  name: string;
  slug: string;
  pricingRef: string | null;
  summary: string | null;
  description: string | null;
  priceAmount: number; // BASE for booking math, cents
  fromPrice: number | null; // DISPLAY-ONLY "From $X"; never summed into price
  minBooking: number | null;
  currency: string;
  durationMinutes: number;
  locationMode: LocationMode; // default/primary
  locationModes: LocationMode[]; // full set offered (booking picks one)
  serviceType: string | null;
  badges: string[];
  iconPath: string; // lucide icon NAME, resolved from config by slug
  status: ServiceStatus;
  configGroups: ConfigGroupResponse[];
  createdAt: Date;
  updatedAt: Date;
}
