import { z } from "zod";
import { ConfigSelectionType, ConfigStatus } from "../../../enums";

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
const descriptionSchema = z.string().trim().max(500);
const sortOrderSchema = z.number().int().nonnegative().default(0);
const priceModifierSchema = z
  .number()
  .int("Price modifier must be a whole number of cents")
  .nonnegative("Price modifier must be zero or greater");

/**
 * POST /groups — a new group is created INACTIVE (server default); it can only be
 * activated once it has >= 1 option, so status is not settable at create time.
 */
export const createConfigGroupSchema = z.object({
  key: keySchema,
  label: labelSchema,
  selectionType: z.nativeEnum(ConfigSelectionType),
  isRequired: z.boolean().default(false),
  sortOrder: sortOrderSchema,
});

export const updateConfigGroupSchema = z
  .object({
    key: keySchema,
    label: labelSchema,
    selectionType: z.nativeEnum(ConfigSelectionType),
    isRequired: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
    status: z.nativeEnum(ConfigStatus),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

export const createConfigOptionSchema = z.object({
  key: keySchema,
  label: labelSchema,
  priceModifier: priceModifierSchema.default(0),
  description: descriptionSchema.optional(),
  sortOrder: sortOrderSchema,
  status: z.nativeEnum(ConfigStatus).default(ConfigStatus.ACTIVE),
});

export const updateConfigOptionSchema = z
  .object({
    key: keySchema,
    label: labelSchema,
    priceModifier: priceModifierSchema,
    description: descriptionSchema.nullable(),
    sortOrder: z.number().int().nonnegative(),
    status: z.nativeEnum(ConfigStatus),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

/** PATCH /groups/order — full ordered set of this service's group ids. */
export const reorderGroupsSchema = z.object({
  groupIds: z.array(z.string().uuid()).min(1, "Provide at least one group id"),
});

/** PATCH /groups/:groupId/options/order — full ordered set of this group's option ids. */
export const reorderOptionsSchema = z.object({
  optionIds: z.array(z.string().uuid()).min(1, "Provide at least one option id"),
});

/** POST /price — the option ids a customer has selected (may be empty). */
export const priceQuerySchema = z.object({
  optionIds: z.array(z.string().uuid()).default([]),
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
