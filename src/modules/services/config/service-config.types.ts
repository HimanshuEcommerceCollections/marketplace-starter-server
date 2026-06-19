import type { z } from "zod";
import type { ConfigInputType, ConfigApplies, LocationMode } from "../../../enums";
import type {
  createConfigGroupSchema,
  updateConfigGroupSchema,
  createConfigOptionSchema,
  updateConfigOptionSchema,
} from "./service-config.validation";

export type CreateConfigGroupDto = z.infer<typeof createConfigGroupSchema>;
export type UpdateConfigGroupDto = z.infer<typeof updateConfigGroupSchema>;
export type CreateConfigOptionDto = z.infer<typeof createConfigOptionSchema>;
export type UpdateConfigOptionDto = z.infer<typeof updateConfigOptionSchema>;

/** A choice within a group (serialized API contract). */
export interface ConfigOptionResponse {
  id: string;
  key: string; // == pricing modifier option id (verbatim source id)
  label: string;
  priceDelta: number; // signed minor units (cents); 0 = no change
  isDefault: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A configurable dimension with its ordered options nested in. */
export interface ConfigGroupResponse {
  id: string;
  serviceId: string;
  key: string; // == pricing modifier id (verbatim source id)
  label: string;
  inputType: ConfigInputType;
  applies: ConfigApplies;
  isRequired: boolean;
  sortOrder: number;
  priceDelta: number | null; // group-level delta for QUANTITY/TOGGLE; null for SELECT/MULTISELECT
  selectMin: number | null;
  selectMax: number | null;
  quantityMin: number | null;
  quantityMax: number | null;
  quantityStep: number | null;
  options: ConfigOptionResponse[]; // empty for QUANTITY/TOGGLE
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
  categoryId: string;
  priceAmount: number; // BASE for booking math, cents
  fromPrice: number | null; // DISPLAY-ONLY "From $X"; never summed into price
  minBooking: number | null;
  currency: string;
  durationMinutes: number;
  locationMode: LocationMode; // default/primary
  locationModes: LocationMode[]; // full set offered (booking picks one)
  serviceType: string | null;
  comingSoon: boolean;
  badges: string[];
  iconPath: string; // lucide icon NAME, resolved from config by slug
  isActive: boolean;
  configGroups: ConfigGroupResponse[];
  createdAt: Date;
  updatedAt: Date;
}
