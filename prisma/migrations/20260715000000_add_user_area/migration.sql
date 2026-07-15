-- CreateEnum
CREATE TYPE "ServiceArea" AS ENUM ('RALEIGH', 'CARY', 'APEX', 'WAKE_FOREST', 'MORRISVILLE', 'GARNER', 'HOLLY_SPRINGS', 'FUQUAY_VARINA', 'KNIGHTDALE', 'WENDELL', 'ZEBULON', 'ROLESVILLE');

-- AlterTable: multi-value coverage area, empty list by default so the add is safe
-- on a populated table (no NOT NULL rewrite, no default backfill lock).
ALTER TABLE "User" ADD COLUMN "area" "ServiceArea"[] DEFAULT ARRAY[]::"ServiceArea"[];

-- Backfill existing accounts to [RALEIGH] (the brand's home city). Idempotent:
-- only rows still holding the empty-list default (or NULL) are touched, so this
-- is safe to re-run if the migration is replayed / resolved on the remote DB.
UPDATE "User"
SET "area" = ARRAY['RALEIGH']::"ServiceArea"[]
WHERE "area" = ARRAY[]::"ServiceArea"[] OR "area" IS NULL;
