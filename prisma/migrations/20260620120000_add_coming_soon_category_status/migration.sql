-- AlterEnum
-- Adds the user-visible COMING_SOON state to CategoryStatus, ordered between
-- ACTIVE and INACTIVE to mirror prisma/schema.prisma. `ADD VALUE` is additive
-- and non-destructive: existing rows keep their current status.
ALTER TYPE "CategoryStatus" ADD VALUE 'COMING_SOON' BEFORE 'INACTIVE';
