-- CreateEnum
CREATE TYPE "notification_event" AS ENUM ('enquiry_received', 'enquiry_unanswered', 'enquiry_escalated', 'quote_received', 'quote_revised', 'quote_accepted', 'quote_expiring', 'review_posted', 'review_requested', 'document_expiring', 'weekly_digest');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('whatsapp', 'sms', 'email', 'in_app');

-- CreateEnum
CREATE TYPE "template_approval" AS ENUM ('draft', 'pending_meta', 'live', 'retired');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('queued', 'deferred', 'sent', 'failed', 'skipped');

-- AlterTable
ALTER TABLE "enquiry" ADD COLUMN     "contact_released_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "enquiry_line" ADD COLUMN     "target_unit_price_aed" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "enquiry_recipient" ADD COLUMN     "nudged_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "quote" ADD COLUMN     "expires_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "claim_token" TEXT,
ADD COLUMN     "claimed_at" TIMESTAMP(3),
ADD COLUMN     "is_provisional" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "notification_template" (
    "id" TEXT NOT NULL,
    "event" "notification_event" NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "template_approval" NOT NULL DEFAULT 'draft',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "action_label" TEXT,
    "action_path" TEXT,
    "meta_template_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preference" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "routing" JSONB NOT NULL DEFAULT '{}',
    "quiet_hours_enabled" BOOLEAN NOT NULL DEFAULT true,
    "quiet_from_hour" INTEGER NOT NULL DEFAULT 21,
    "quiet_to_hour" INTEGER NOT NULL DEFAULT 7,
    "quiet_on_sunday" BOOLEAN NOT NULL DEFAULT true,
    "high_value_override_aed" INTEGER DEFAULT 50000,
    "escalate_to_user_id" UUID,
    "escalate_after_minutes" INTEGER NOT NULL DEFAULT 120,
    "nudge_enabled" BOOLEAN NOT NULL DEFAULT true,
    "nudge_after_hours" INTEGER NOT NULL DEFAULT 24,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery" (
    "id" TEXT NOT NULL,
    "template_id" TEXT,
    "event" "notification_event" NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'queued',
    "recipient_user_id" UUID,
    "business_id" TEXT,
    "enquiry_id" TEXT,
    "reason" TEXT,
    "scheduled_for" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_request" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "buyer_id" UUID NOT NULL,
    "enquiry_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_template_event_channel_status_idx" ON "notification_template"("event", "channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_template_event_channel_locale_version_key" ON "notification_template"("event", "channel", "locale", "version");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preference_business_id_key" ON "notification_preference"("business_id");

-- CreateIndex
CREATE INDEX "notification_delivery_event_business_id_created_at_idx" ON "notification_delivery"("event", "business_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_delivery_status_scheduled_for_idx" ON "notification_delivery"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "review_request_business_id_sent_at_idx" ON "review_request"("business_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "review_request_business_id_buyer_id_key" ON "review_request"("business_id", "buyer_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_claim_token_key" ON "user"("claim_token");

-- AddForeignKey
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "notification_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_request" ADD CONSTRAINT "review_request_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_request" ADD CONSTRAINT "review_request_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_request" ADD CONSTRAINT "review_request_enquiry_id_fkey" FOREIGN KEY ("enquiry_id") REFERENCES "enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "business_display_name_trgm_idx" RENAME TO "business_display_name_idx";

-- RenameIndex
ALTER INDEX "business_trade_name_trgm_idx" RENAME TO "business_trade_name_idx";

-- RenameIndex
ALTER INDEX "product_search_text_trgm_idx" RENAME TO "product_search_text_idx";
