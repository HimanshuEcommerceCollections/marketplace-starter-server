-- CreateEnum
-- Triage lifecycle for a public corporate wellness inquiry.
CREATE TYPE "CorporateInquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED');

-- CreateTable
-- Anonymous "Request a proposal" submissions from the Corporate Wellness page.
-- Additive table only; read/triaged by staff in the admin dashboard.
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
