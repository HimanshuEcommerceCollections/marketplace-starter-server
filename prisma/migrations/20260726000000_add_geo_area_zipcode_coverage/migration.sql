-- EXPAND phase of the ServiceArea enum -> Area table conversion.
--
-- Everything here is ADDITIVE and backwards-compatible: the legacy
-- "Booking"."area" enum column and "User"."area" array are left untouched, so the
-- previously-deployed server keeps working against this schema while the new one
-- rolls out. The enum type itself is NOT dropped here — that is the separate
-- CONTRACT migration, which is irreversible and must not run until the new server
-- has been live and verified.
--
-- Hand-authored (the convention for every migration in this folder). Idempotent
-- where it can be, so a partial failure can be re-run.

-- CreateEnum
CREATE TYPE "GeoStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CoverageEffect" AS ENUM ('ALLOW', 'DENY');

-- CreateEnum
CREATE TYPE "CoverageSource" AS ENUM ('ZIP_RULE', 'AREA_RULE', 'AREA_FALLBACK', 'NOT_APPLICABLE');

-- CreateTable: an admin-managed operating market. Replaces the ServiceArea enum.
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "stateCode" TEXT NOT NULL DEFAULT 'NC',
    "countryCode" TEXT NOT NULL DEFAULT 'US',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "status" "GeoStatus" NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable: a 5-digit USPS ZIP owned by exactly ONE Area.
CREATE TABLE "ZipCode" (
    "id" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "zipCode" TEXT NOT NULL,
    "city" TEXT,
    "stateCode" TEXT NOT NULL DEFAULT 'NC',
    "countryCode" TEXT NOT NULL DEFAULT 'US',
    "status" "GeoStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZipCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Service <-> Area coverage rule (the DEFAULT tier).
CREATE TABLE "ServiceAreaCoverage" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "effect" "CoverageEffect",
    "autoIncludeNewZips" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceAreaCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Service <-> ZipCode coverage rule (the MOST SPECIFIC tier).
CREATE TABLE "ServiceZipCoverage" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "zipCodeId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "effect" "CoverageEffect",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceZipCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Area_name_key" ON "Area"("name");
CREATE UNIQUE INDEX "Area_slug_key" ON "Area"("slug");
CREATE INDEX "Area_status_sortOrder_idx" ON "Area"("status", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ZipCode_zipCode_key" ON "ZipCode"("zipCode");
-- Referential-integrity anchor for the composite FK on ServiceZipCoverage.
CREATE UNIQUE INDEX "ZipCode_id_areaId_key" ON "ZipCode"("id", "areaId");
CREATE INDEX "ZipCode_areaId_status_idx" ON "ZipCode"("areaId", "status");

-- CreateIndex: prefix search. Under the en_US.UTF-8 collation Supabase defaults
-- to, a plain btree CANNOT serve LIKE 'x%'. text_pattern_ops is what turns every
-- debounced keystroke in the admin ZIP search and the coverage picker into an
-- index scan instead of a seq scan.
CREATE INDEX "ZipCode_zipCode_idx" ON "ZipCode"("zipCode" text_pattern_ops);
CREATE INDEX "ZipCode_areaId_zipCode_idx" ON "ZipCode"("areaId", "zipCode" text_pattern_ops);
CREATE INDEX "ZipCode_city_idx" ON "ZipCode"("city" text_pattern_ops);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAreaCoverage_serviceId_areaId_key" ON "ServiceAreaCoverage"("serviceId", "areaId");
CREATE INDEX "ServiceAreaCoverage_areaId_idx" ON "ServiceAreaCoverage"("areaId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceZipCoverage_serviceId_zipCodeId_key" ON "ServiceZipCoverage"("serviceId", "zipCodeId");
CREATE INDEX "ServiceZipCoverage_zipCodeId_idx" ON "ServiceZipCoverage"("zipCodeId");
CREATE INDEX "ServiceZipCoverage_serviceId_areaId_idx" ON "ServiceZipCoverage"("serviceId", "areaId");

-- AddForeignKey: Restrict, not Cascade — an Area with ZIPs must not be deletable.
-- Retirement is status = ARCHIVED.
ALTER TABLE "ZipCode" ADD CONSTRAINT "ZipCode_areaId_fkey"
  FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceAreaCoverage" ADD CONSTRAINT "ServiceAreaCoverage_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceAreaCoverage" ADD CONSTRAINT "ServiceAreaCoverage_areaId_fkey"
  FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceZipCoverage" ADD CONSTRAINT "ServiceZipCoverage_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: the COMPOSITE FK. ON UPDATE RESTRICT is the whole point — it is
-- what makes a ZIP physically unmovable between areas while a service rule
-- references it under the old area. CASCADE here would silently repoint the rule
-- to the new area, which IS the bug this constraint exists to prevent.
ALTER TABLE "ServiceZipCoverage" ADD CONSTRAINT "ServiceZipCoverage_zipCodeId_areaId_fkey"
  FOREIGN KEY ("zipCodeId", "areaId") REFERENCES "ZipCode"("id", "areaId") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AlterTable: optimistic-concurrency token for the coverage editor. Bumped on
-- every coverage write so two coordinators editing different areas of the same
-- service get a loud 409 rather than a silent lost update.
ALTER TABLE "Service" ADD COLUMN "coverageVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: coverage on the booking — FKs for joins, snapshots for history.
-- areaId stays NULLABLE FOREVER: historical bookings legitimately hold NULL
-- (area was optional), and REMOTE bookings never resolve one. A DB-level NOT NULL
-- would be an unrollbackable mistake; enforcement is zod + the service layer.
ALTER TABLE "Booking" ADD COLUMN "areaId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "zipCodeId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "postalCode" TEXT;
ALTER TABLE "Booking" ADD COLUMN "areaNameSnapshot" TEXT;
ALTER TABLE "Booking" ADD COLUMN "coverageSource" "CoverageSource";

-- CreateIndex
CREATE INDEX "Booking_areaId_idx" ON "Booking"("areaId");
CREATE INDEX "Booking_zipCodeId_idx" ON "Booking"("zipCodeId");
CREATE INDEX "Booking_postalCode_idx" ON "Booking"("postalCode");

-- AddForeignKey: Restrict, not the Prisma default SetNull — a booking's geography
-- is history and must never be silently nulled.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_areaId_fkey"
  FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_zipCodeId_fkey"
  FOREIGN KEY ("zipCodeId") REFERENCES "ZipCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: the literal ZIP the customer typed, beside the address they typed.
ALTER TABLE "user_details" ADD COLUMN "postalCode" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- CHECK constraints. Prisma has no CHECK DSL, so these are hand-written. Zod is
-- the primary validator; these are the guarantee that no seed script, psql
-- session, or future bulk importer can bypass the invariants.
-- ─────────────────────────────────────────────────────────────────────────────

-- Format backstops. Scoped by country so adding CA/UK needs a NEW check rather
-- than a rewrite of this one. TEXT + regex, never CHAR(2): Postgres char(n) is
-- blank-padded (bpchar) and compares surprisingly against text.
ALTER TABLE "ZipCode" ADD CONSTRAINT "ZipCode_zipCode_us_format_check"
  CHECK ("countryCode" <> 'US' OR "zipCode" ~ '^[0-9]{5}$');

ALTER TABLE "ZipCode" ADD CONSTRAINT "ZipCode_stateCode_format_check"
  CHECK ("stateCode" ~ '^[A-Z]{2}$');

ALTER TABLE "Area" ADD CONSTRAINT "Area_stateCode_format_check"
  CHECK ("stateCode" ~ '^[A-Z]{2}$');

ALTER TABLE "Area" ADD CONSTRAINT "Area_countryCode_format_check"
  CHECK ("countryCode" ~ '^[A-Z]{2}$');

-- `effect` is NULLABLE in the Prisma model so a future payload-only row (per-area
-- pricing, per-ZIP fee) is representable WITHOUT asserting a coverage verdict.
-- There is no payload column today, so a NULL-effect row would be meaningless
-- garbage — forbid it. When priceAdjustmentAmount lands, WIDEN these to
--   CHECK ("effect" IS NOT NULL OR "priceAdjustmentAmount" IS NOT NULL)
-- One line, no data migration, no re-audit of existing rows.
ALTER TABLE "ServiceAreaCoverage" ADD CONSTRAINT "ServiceAreaCoverage_payload_check"
  CHECK ("effect" IS NOT NULL);

ALTER TABLE "ServiceZipCoverage" ADD CONSTRAINT "ServiceZipCoverage_payload_check"
  CHECK ("effect" IS NOT NULL);
