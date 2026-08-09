-- Professional applications + invited accounts.
--
-- Three changes, in dependency order:
--   1. UserStatus gains INVITED (provisioned, emailed, no password set yet).
--   2. VerificationToken gains a `purpose` so a signup link can never be replayed
--      against an invite (and vice versa).
--   3. CorporateInquiry is RENAMED to ProfessionalApplication and reshaped from
--      B2B lead fields to practitioner-application fields. The rename preserves
--      existing rows and their ids — nothing is dropped and recreated.

-- AlterEnum
-- Safe in PG 12+ inside a transaction because no row is written with the new
-- value in this same migration (the application starts using it afterwards).
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'INVITED' AFTER 'PENDING_VERIFICATION';

-- CreateEnum
CREATE TYPE "VerificationPurpose" AS ENUM ('EMAIL_VERIFICATION', 'INVITE');

-- AlterTable
-- Existing tokens are all signup verifications, which the default backfills.
ALTER TABLE "VerificationToken"
    ADD COLUMN "purpose" "VerificationPurpose" NOT NULL DEFAULT 'EMAIL_VERIFICATION';

-- CreateIndex
CREATE INDEX "VerificationToken_userId_purpose_idx" ON "VerificationToken"("userId", "purpose");

-- CreateEnum
CREATE TYPE "ProfessionalApplicationStatus" AS ENUM ('NEW', 'REVIEWING', 'ACCEPTED', 'REJECTED');

-- RenameTable + constraints/indexes (Postgres carries the data across).
ALTER TABLE "CorporateInquiry" RENAME TO "ProfessionalApplication";
ALTER TABLE "ProfessionalApplication" RENAME CONSTRAINT "CorporateInquiry_pkey" TO "ProfessionalApplication_pkey";
ALTER INDEX "CorporateInquiry_status_idx" RENAME TO "ProfessionalApplication_status_idx";
ALTER INDEX "CorporateInquiry_createdAt_idx" RENAME TO "ProfessionalApplication_createdAt_idx";

-- Reshape the status column onto the new lifecycle. Old triage states map onto
-- the closest new one: CONTACTED/QUALIFIED were both "being worked" → REVIEWING,
-- and CLOSED was terminal-without-onboarding → REJECTED. The DEFAULT must be
-- dropped before the type swap and restored after.
ALTER TABLE "ProfessionalApplication" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ProfessionalApplication"
    ALTER COLUMN "status" TYPE "ProfessionalApplicationStatus"
    USING (
        CASE "status"::text
            WHEN 'NEW' THEN 'NEW'
            WHEN 'CONTACTED' THEN 'REVIEWING'
            WHEN 'QUALIFIED' THEN 'REVIEWING'
            WHEN 'CLOSED' THEN 'REJECTED'
            ELSE 'NEW'
        END
    )::"ProfessionalApplicationStatus";
ALTER TABLE "ProfessionalApplication" ALTER COLUMN "status" SET DEFAULT 'NEW';

DROP TYPE "CorporateInquiryStatus";

-- Reshape the payload columns. `eventType` (the requested format select) becomes
-- `serviceCategory` (the practitioner's primary service) — both are the single
-- required non-contact field, so renaming keeps existing submissions readable
-- rather than blanking them.
ALTER TABLE "ProfessionalApplication" RENAME COLUMN "eventType" TO "serviceCategory";

-- B2B-only fields have no practitioner equivalent.
ALTER TABLE "ProfessionalApplication" DROP COLUMN "company";
ALTER TABLE "ProfessionalApplication" DROP COLUMN "headcount";
ALTER TABLE "ProfessionalApplication" DROP COLUMN "preferredDate";

ALTER TABLE "ProfessionalApplication"
    ADD COLUMN "credential" TEXT,
    ADD COLUMN "experienceYears" INTEGER,
    ADD COLUMN "serviceArea" TEXT,
    ADD COLUMN "website" TEXT,
    ADD COLUMN "reviewedAt" TIMESTAMP(3),
    ADD COLUMN "reviewedById" TEXT,
    ADD COLUMN "invitedUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalApplication_invitedUserId_key" ON "ProfessionalApplication"("invitedUserId");
