-- CreateTable
-- Single-use email-verification tokens. Only a SHA-256 hash of the emailed token
-- is stored (the plaintext lives solely in the verification link). Mirrors the
-- RefreshToken table. Additive table only.
CREATE TABLE "VerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_tokenHash_key" ON "VerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "VerificationToken_userId_idx" ON "VerificationToken"("userId");

-- AddForeignKey
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: grandfather every EXISTING account as already-verified so switching on
-- the "unverified users cannot log in / book" gate never locks out anyone who
-- signed up before this feature shipped. Only rows with a NULL emailVerifiedAt are
-- touched. New signups created AFTER this migration start with emailVerifiedAt =
-- NULL and status = PENDING_VERIFICATION (set by the application) and must verify.
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP WHERE "emailVerifiedAt" IS NULL;
