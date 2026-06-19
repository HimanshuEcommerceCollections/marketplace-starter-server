import { z } from "zod";
import { ConfigInputType, ConfigApplies } from "../../../enums";

/** Config key = pricing modifier/option id, carried verbatim from source (never slugged).
 *  min(1) because real ids like `1`, `2` exist (beauty "Number of People"). */
const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Key may contain only lowercase letters, numbers, and hyphens");

// Labels can be as short as one char (e.g. the "1"/"2" people options).
const labelSchema = z.string().trim().min(1).max(120);
const sortOrderSchema = z.number().int().nonnegative().default(0);

export const createConfigGroupSchema = z.object({
  key: keySchema,
  label: labelSchema,
  inputType: z.nativeEnum(ConfigInputType),
  applies: z.nativeEnum(ConfigApplies).default(ConfigApplies.FLAT),
  isRequired: z.boolean().default(false),
  sortOrder: sortOrderSchema,
  // Group-level delta (QUANTITY/TOGGLE only); MVP forbids those input types in the service.
  priceDelta: z.number().int().nonnegative().optional(),
  selectMin: z.number().int().nonnegative().optional(),
  selectMax: z.number().int().nonnegative().optional(),
  quantityMin: z.number().int().positive().optional(),
  quantityMax: z.number().int().positive().optional(),
  quantityStep: z.number().int().positive().optional(),
});

export const updateConfigGroupSchema = z
  .object({
    key: keySchema,
    label: labelSchema,
    inputType: z.nativeEnum(ConfigInputType),
    applies: z.nativeEnum(ConfigApplies),
    isRequired: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
    priceDelta: z.number().int().nonnegative().nullable(),
    selectMin: z.number().int().nonnegative().nullable(),
    selectMax: z.number().int().nonnegative().nullable(),
    quantityMin: z.number().int().positive().nullable(),
    quantityMax: z.number().int().positive().nullable(),
    quantityStep: z.number().int().positive().nullable(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export const createConfigOptionSchema = z.object({
  key: keySchema,
  label: labelSchema,
  // MVP: surcharges only (>= 0). Column is signed for future discounts (design §8.4).
  priceDelta: z
    .number()
    .int("Price delta must be a whole number of cents")
    .nonnegative("Price delta must be zero or greater")
    .default(0),
  isDefault: z.boolean().default(false),
  sortOrder: sortOrderSchema,
});

export const updateConfigOptionSchema = z
  .object({
    key: keySchema,
    label: labelSchema,
    priceDelta: z
      .number()
      .int("Price delta must be a whole number of cents")
      .nonnegative("Price delta must be zero or greater"),
    isDefault: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

// Param schemas. mergeParams surfaces all of serviceId/groupId/optionId; each schema MUST
// list every param present on its route (validate replaces req.params with the parsed object).
export const serviceParamsSchema = z.object({ serviceId: z.string().uuid() });
export const groupParamsSchema = z.object({
  serviceId: z.string().uuid(),
  groupId: z.string().uuid(),
});
export const optionParamsSchema = z.object({
  serviceId: z.string().uuid(),
  groupId: z.string().uuid(),
  optionId: z.string().uuid(),
});
