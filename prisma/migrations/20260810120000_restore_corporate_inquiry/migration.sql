-- Restore CorporateInquiry as its own table, separate from ProfessionalApplication.
--
-- The previous migration RENAMED CorporateInquiry into ProfessionalApplication on
-- the mistaken belief that corporate proposal requests and practitioner
-- applications were the same intake. They are not: a company asking for an
-- on-site wellness program has nothing to do with a therapist applying to join.
--
-- This recreates the corporate table, moves the carried-over rows back into it,
-- and leaves ProfessionalApplication empty for its actual purpose. The two now
-- coexist, fed by two different public forms.

-- CreateEnum
CREATE TYPE "CorporateInquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED');

-- CreateTable — identical to the original 20260713000000 definition.
CREATE TABLE "CorporateInquiry" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "headcount" TEXT,
    "eventType" TEXT NOT NULL,
    "preferredDate" TEXT,
    "notes" TEXT,
    "status" "CorporateInquiryStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorporateInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CorporateInquiry_status_idx" ON "CorporateInquiry"("status");

-- CreateIndex
CREATE INDEX "CorporateInquiry_createdAt_idx" ON "CorporateInquiry"("createdAt");

-- Move the corporate rows back.
--
-- At apply time every row in ProfessionalApplication is a corporate lead carried
-- across by the rename — no practitioner has applied through the new form yet.
-- `invitedUserId IS NULL` is belt-and-braces: a genuine accepted application has
-- an account behind it and must never be dragged into the corporate table.
--
-- `company` was DROPPED by the previous migration and cannot be recovered from
-- the row. It is NOT NULL here, so it is reconstructed from the contact email's
-- domain label ("dana@northwind.test" -> "Northwind"), which is right for the
-- seeded/demo rows this affects. `headcount` and `preferredDate` were dropped
-- too and stay null — they were optional. Contact details, notes, status, ids
-- and timestamps all survive intact.
INSERT INTO "CorporateInquiry" (
    "id", "company", "contactName", "contactEmail", "contactPhone",
    "headcount", "eventType", "preferredDate", "notes", "status",
    "createdAt", "updatedAt"
)
SELECT
    "id",
    COALESCE(
        NULLIF(initcap(split_part(split_part("contactEmail", '@', 2), '.', 1)), ''),
        'Unknown'
    ),
    "contactName",
    "contactEmail",
    "contactPhone",
    NULL,
    "serviceCategory",
    NULL,
    "notes",
    (
        CASE "status"::text
            WHEN 'NEW' THEN 'NEW'
            WHEN 'REVIEWING' THEN 'CONTACTED'
            WHEN 'ACCEPTED' THEN 'QUALIFIED'
            WHEN 'REJECTED' THEN 'CLOSED'
            ELSE 'NEW'
        END
    )::"CorporateInquiryStatus",
    "createdAt",
    "updatedAt"
FROM "ProfessionalApplication"
WHERE "invitedUserId" IS NULL;

DELETE FROM "ProfessionalApplication" WHERE "invitedUserId" IS NULL;
