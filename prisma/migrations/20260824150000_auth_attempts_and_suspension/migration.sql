-- Handoff 2, step 2. Auth: the three failure states need somewhere to live.

-- CreateEnum
CREATE TYPE "auth_attempt_kind" AS ENUM ('otp_request', 'otp_verify', 'reset_request');

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "suspended_at" TIMESTAMP(3),
ADD COLUMN     "wants_to_list" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "auth_attempt" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "kind" "auth_attempt_kind" NOT NULL,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_attempt_identifier_kind_created_at_idx" ON "auth_attempt"("identifier", "kind", "created_at");

-- CreateIndex
CREATE INDEX "auth_attempt_created_at_idx" ON "auth_attempt"("created_at");
