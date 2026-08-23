-- CreateEnum
CREATE TYPE "role" AS ENUM ('buyer', 'seller_owner', 'seller_manager', 'seller_sales', 'seller_finance', 'staff_moderator', 'staff_field', 'staff_finance', 'staff_ops_lead');

-- CreateEnum
CREATE TYPE "emirate" AS ENUM ('abu_dhabi', 'dubai', 'sharjah', 'ajman', 'umm_al_quwain', 'ras_al_khaimah', 'fujairah');

-- CreateEnum
CREATE TYPE "template_status" AS ENUM ('draft', 'live', 'retired');

-- CreateEnum
CREATE TYPE "field_type" AS ENUM ('select', 'multiselect', 'number', 'number_range', 'text', 'boolean');

-- CreateEnum
CREATE TYPE "claim_status" AS ENUM ('unclaimed', 'claimed', 'disputed');

-- CreateEnum
CREATE TYPE "listing_source" AS ENUM ('licence_import', 'self_added');

-- CreateEnum
CREATE TYPE "team_size_band" AS ENUM ('b1_10', 'b11_50', 'b51_200', 'b201_500', 'b500_plus');

-- CreateEnum
CREATE TYPE "authority" AS ENUM ('DED', 'ADDED', 'SHJ', 'AJM', 'UAQ', 'RAK', 'FUJ', 'DMCC', 'JAFZA', 'SAIF', 'DAFZA', 'DSO', 'DIC', 'DMC', 'DHCC', 'DWC', 'DIFC', 'ADGM', 'KIZAD', 'HFZA', 'RAKEZ', 'UAQFTZ', 'FCC', 'MFZ', 'DUQE', 'IFZA', 'SPCFZ', 'AFZ', 'TWOFOUR54', 'MASDAR', 'ADAFZ', 'DPC', 'DTEC', 'IMPZ', 'JLT', 'TECOM');

-- CreateEnum
CREATE TYPE "location_type" AS ENUM ('head_office', 'warehouse', 'trade_counter', 'depot', 'sales_office', 'workshop');

-- CreateEnum
CREATE TYPE "availability" AS ENUM ('in_stock', 'made_to_order', 'indent', 'out_of_stock');

-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('draft', 'live', 'out_of_stock');

-- CreateEnum
CREATE TYPE "media_kind" AS ENUM ('logo', 'cover', 'gallery', 'product', 'review', 'storefront');

-- CreateEnum
CREATE TYPE "document_kind" AS ENUM ('trade_licence', 'vat_certificate', 'datasheet', 'catalogue', 'certificate', 'enquiry_attachment');

-- CreateEnum
CREATE TYPE "payment_terms" AS ENUM ('advance', 'cod', 'net_15', 'net_30', 'net_60', 'lc');

-- CreateEnum
CREATE TYPE "recipient_state" AS ENUM ('delivered', 'opened', 'quoted', 'declined', 'no_response');

-- CreateEnum
CREATE TYPE "quote_status" AS ENUM ('draft', 'sent', 'read', 'accepted', 'lost', 'expired');

-- CreateEnum
CREATE TYPE "report_kind" AS ENUM ('closed', 'wrong_details', 'wrong_trade', 'claim_conflict', 'off_platform_payment', 'content', 'review_integrity');

-- CreateEnum
CREATE TYPE "report_outcome" AS ENUM ('seller_corrected', 'upheld', 'no_action');

-- CreateEnum
CREATE TYPE "sub_status" AS ENUM ('trialing', 'active', 'past_due', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('draft', 'issued', 'paid', 'overdue', 'void');

-- CreateEnum
CREATE TYPE "invoice_line_kind" AS ENUM ('subscription', 'placement', 'subscription_credit');

-- CreateEnum
CREATE TYPE "reveal_channel" AS ENUM ('phone', 'whatsapp', 'email', 'website');

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "full_name" TEXT,
    "roles" "role"[] DEFAULT ARRAY[]::"role"[],
    "business_id" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "buyer_company_id" TEXT,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trn" TEXT,
    "emirate" "emirate",
    "approval_threshold_aed" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "area" (
    "id" TEXT NOT NULL,
    "emirate" "emirate" NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "slug" TEXT NOT NULL,
    "is_free_zone" BOOLEAN NOT NULL DEFAULT false,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "name_ar" TEXT,
    "slug" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "synonyms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "default_template_id" TEXT,
    "show_on_home" BOOLEAN NOT NULL DEFAULT false,
    "accepts_rfq" BOOLEAN NOT NULL DEFAULT true,
    "requires_extra_check" BOOLEAN NOT NULL DEFAULT false,
    "publish_threshold" INTEGER NOT NULL DEFAULT 60,
    "verified_share_min" DOUBLE PRECISION NOT NULL DEFAULT 0.30,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spec_template" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "template_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spec_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spec_field" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "label_ar" TEXT,
    "type" "field_type" NOT NULL,
    "unit" TEXT,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "is_filterable" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "spec_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_template" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "platform_template_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "field_mappings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business" (
    "id" TEXT NOT NULL,
    "trade_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "licence_number" TEXT NOT NULL,
    "licence_authority" "authority" NOT NULL,
    "licence_expiry" TIMESTAMP(3) NOT NULL,
    "trn" TEXT,
    "established_year" INTEGER,
    "team_size" "team_size_band",
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT,
    "verification_tier" INTEGER NOT NULL DEFAULT 0,
    "verified_at" TIMESTAMP(3),
    "visited_at" TIMESTAMP(3),
    "visited_by_staff_id" UUID,
    "claim_status" "claim_status" NOT NULL DEFAULT 'unclaimed',
    "plan_id" TEXT,
    "primary_category_id" TEXT NOT NULL,
    "source" "listing_source" NOT NULL DEFAULT 'licence_import',
    "import_run_id" TEXT,
    "suspended_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "theme_preset" TEXT,
    "theme_hex" TEXT,
    "response_time_median_ms" INTEGER,
    "profile_strength" INTEGER,
    "spec_completeness" DOUBLE PRECISION,
    "quoted_value_aed" DECIMAL(14,2),
    "rating_overall" DOUBLE PRECISION,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "derived_at" TIMESTAMP(3),

    CONSTRAINT "business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_category" (
    "business_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_category_pkey" PRIMARY KEY ("business_id","category_id")
);

-- CreateTable
CREATE TABLE "location" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "type" "location_type" NOT NULL,
    "emirate" "emirate" NOT NULL,
    "area_id" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "phone" TEXT,
    "whatsapp" TEXT,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "hours" JSONB NOT NULL DEFAULT '{}',
    "ramadan_hours" JSONB,
    "service_radius_km" INTEGER,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "sku" TEXT,
    "category_id" TEXT NOT NULL,
    "availability" "availability" NOT NULL,
    "stock_qty" INTEGER,
    "lead_time_days" INTEGER,
    "min_order_qty" INTEGER,
    "spec_values" JSONB NOT NULL DEFAULT '{}',
    "search_text" TEXT,
    "description" TEXT,
    "status" "product_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" TEXT NOT NULL,
    "kind" "media_kind" NOT NULL,
    "storage_path" TEXT NOT NULL,
    "alt" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "business_id" TEXT,
    "product_id" TEXT,
    "review_id" TEXT,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" TEXT NOT NULL,
    "kind" "document_kind" NOT NULL,
    "storage_path" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "bytes" INTEGER,
    "mime_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "business_id" TEXT,
    "product_id" TEXT,
    "enquiry_id" TEXT,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiry" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "buyer_id" UUID NOT NULL,
    "buyer_company_id" TEXT,
    "requirement" TEXT NOT NULL,
    "deliver_to_area" TEXT,
    "needed_by" TIMESTAMP(3),
    "terms_wanted" "payment_terms",
    "closes_at" TIMESTAMP(3) NOT NULL,
    "contact_released_to_business_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiry_line" (
    "id" TEXT NOT NULL,
    "enquiry_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit" TEXT,
    "size" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "enquiry_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiry_recipient" (
    "enquiry_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "state" "recipient_state" NOT NULL DEFAULT 'delivered',
    "opened_at" TIMESTAMP(3),
    "first_reply_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enquiry_recipient_pkey" PRIMARY KEY ("enquiry_id","business_id")
);

-- CreateTable
CREATE TABLE "quote" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "enquiry_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "validity_days" INTEGER NOT NULL DEFAULT 14,
    "note" TEXT,
    "status" "quote_status" NOT NULL DEFAULT 'draft',
    "lost_reason" TEXT,
    "sent_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_line" (
    "id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "product_id" TEXT,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "lead_time_days" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quote_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" TEXT NOT NULL,
    "enquiry_id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "sender_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "quote_revision_id" TEXT,
    "flagged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "buyer_id" UUID NOT NULL,
    "enquiry_id" TEXT NOT NULL,
    "overall" INTEGER NOT NULL,
    "quoted_accurate" INTEGER NOT NULL,
    "on_time" INTEGER NOT NULL,
    "as_described" INTEGER NOT NULL,
    "responsiveness" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "show_company_name" BOOLEAN NOT NULL DEFAULT true,
    "editable_until" TIMESTAMP(3) NOT NULL,
    "seller_reply" TEXT,
    "seller_replied_at" TIMESTAMP(3),
    "removed_at" TIMESTAMP(3),
    "removal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_report" (
    "id" TEXT NOT NULL,
    "subject_business_id" TEXT NOT NULL,
    "reporter_id" UUID,
    "kind" "report_kind" NOT NULL,
    "subject_field" TEXT,
    "detail" TEXT,
    "outcome" "report_outcome",
    "outcome_reason" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthly_price_aed" INTEGER NOT NULL,
    "enquiries_per_month" INTEGER,
    "product_limit" INTEGER,
    "location_limit" INTEGER,
    "photo_limit" INTEGER,
    "team_seats" INTEGER NOT NULL,
    "ranking_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "custom_domain" BOOLEAN NOT NULL DEFAULT false,
    "site_visit_included" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" "sub_status" NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renews_at" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "entitlement_snapshot" JSONB,

    CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "placement_slot" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "emirate" "emirate",
    "monthly_price_aed" INTEGER NOT NULL,
    "starts_on" TIMESTAMP(3) NOT NULL,
    "ends_on" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "placement_slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "vat_rate" DECIMAL(4,4) NOT NULL DEFAULT 0.05,
    "status" "invoice_status" NOT NULL DEFAULT 'draft',
    "issued_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "kind" "invoice_line_kind" NOT NULL,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "amount_aed" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" TEXT NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_reveal" (
    "id" TEXT NOT NULL,
    "actor_id" UUID,
    "business_id" TEXT NOT NULL,
    "location_id" TEXT,
    "channel" "reveal_channel" NOT NULL,
    "surface" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_reveal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zero_result_query" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "category_id" TEXT,
    "emirate" "emirate",
    "filters" JSONB NOT NULL DEFAULT '{}',
    "tab" TEXT NOT NULL DEFAULT 'businesses',
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zero_result_query_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_search" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "alerts" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_search_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redirect" (
    "id" TEXT NOT NULL,
    "from_path" TEXT NOT NULL,
    "to_path" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL DEFAULT 301,
    "business_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redirect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_phone_key" ON "user"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "user_business_id_idx" ON "user"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "area_slug_key" ON "area"("slug");

-- CreateIndex
CREATE INDEX "area_emirate_idx" ON "area"("emirate");

-- CreateIndex
CREATE UNIQUE INDEX "category_slug_key" ON "category"("slug");

-- CreateIndex
CREATE INDEX "category_parent_id_idx" ON "category"("parent_id");

-- CreateIndex
CREATE INDEX "spec_template_category_id_idx" ON "spec_template"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "spec_template_category_id_version_key" ON "spec_template"("category_id", "version");

-- CreateIndex
CREATE INDEX "spec_field_template_id_is_filterable_idx" ON "spec_field"("template_id", "is_filterable");

-- CreateIndex
CREATE UNIQUE INDEX "spec_field_template_id_key_key" ON "spec_field"("template_id", "key");

-- CreateIndex
CREATE INDEX "seller_template_business_id_idx" ON "seller_template"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_slug_key" ON "business"("slug");

-- CreateIndex
CREATE INDEX "business_primary_category_id_idx" ON "business"("primary_category_id");

-- CreateIndex
CREATE INDEX "business_claim_status_idx" ON "business"("claim_status");

-- CreateIndex
CREATE INDEX "business_verification_tier_idx" ON "business"("verification_tier");

-- CreateIndex
CREATE INDEX "business_published_at_idx" ON "business"("published_at");

-- CreateIndex
CREATE INDEX "business_licence_expiry_idx" ON "business"("licence_expiry");

-- CreateIndex
CREATE INDEX "business_category_category_id_idx" ON "business_category"("category_id");

-- CreateIndex
CREATE INDEX "location_business_id_idx" ON "location"("business_id");

-- CreateIndex
CREATE INDEX "location_area_id_idx" ON "location"("area_id");

-- CreateIndex
CREATE INDEX "location_emirate_idx" ON "location"("emirate");

-- CreateIndex
CREATE INDEX "product_business_id_idx" ON "product"("business_id");

-- CreateIndex
CREATE INDEX "product_category_id_idx" ON "product"("category_id");

-- CreateIndex
CREATE INDEX "product_availability_idx" ON "product"("availability");

-- CreateIndex
CREATE UNIQUE INDEX "product_business_id_slug_key" ON "product"("business_id", "slug");

-- CreateIndex
CREATE INDEX "media_business_id_idx" ON "media"("business_id");

-- CreateIndex
CREATE INDEX "media_product_id_idx" ON "media"("product_id");

-- CreateIndex
CREATE INDEX "document_business_id_idx" ON "document"("business_id");

-- CreateIndex
CREATE INDEX "document_product_id_idx" ON "document"("product_id");

-- CreateIndex
CREATE INDEX "document_enquiry_id_idx" ON "document"("enquiry_id");

-- CreateIndex
CREATE UNIQUE INDEX "enquiry_ref_key" ON "enquiry"("ref");

-- CreateIndex
CREATE INDEX "enquiry_buyer_id_idx" ON "enquiry"("buyer_id");

-- CreateIndex
CREATE INDEX "enquiry_closes_at_idx" ON "enquiry"("closes_at");

-- CreateIndex
CREATE INDEX "enquiry_line_enquiry_id_idx" ON "enquiry_line"("enquiry_id");

-- CreateIndex
CREATE INDEX "enquiry_recipient_business_id_state_idx" ON "enquiry_recipient"("business_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "quote_ref_key" ON "quote"("ref");

-- CreateIndex
CREATE INDEX "quote_business_id_status_idx" ON "quote"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quote_enquiry_id_business_id_revision_key" ON "quote"("enquiry_id", "business_id", "revision");

-- CreateIndex
CREATE INDEX "quote_line_quote_id_idx" ON "quote_line"("quote_id");

-- CreateIndex
CREATE INDEX "message_enquiry_id_business_id_created_at_idx" ON "message"("enquiry_id", "business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "review_enquiry_id_key" ON "review"("enquiry_id");

-- CreateIndex
CREATE INDEX "review_business_id_removed_at_idx" ON "review"("business_id", "removed_at");

-- CreateIndex
CREATE INDEX "supplier_report_subject_business_id_outcome_idx" ON "supplier_report"("subject_business_id", "outcome");

-- CreateIndex
CREATE INDEX "supplier_report_kind_idx" ON "supplier_report"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_business_id_key" ON "subscription"("business_id");

-- CreateIndex
CREATE INDEX "subscription_status_renews_at_idx" ON "subscription"("status", "renews_at");

-- CreateIndex
CREATE INDEX "placement_slot_category_id_emirate_starts_on_idx" ON "placement_slot"("category_id", "emirate", "starts_on");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_ref_key" ON "invoice"("ref");

-- CreateIndex
CREATE INDEX "invoice_business_id_status_idx" ON "invoice"("business_id", "status");

-- CreateIndex
CREATE INDEX "invoice_line_invoice_id_idx" ON "invoice_line"("invoice_id");

-- CreateIndex
CREATE INDEX "audit_event_actor_id_created_at_idx" ON "audit_event"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_event_subject_idx" ON "audit_event"("subject");

-- CreateIndex
CREATE INDEX "audit_event_action_created_at_idx" ON "audit_event"("action", "created_at");

-- CreateIndex
CREATE INDEX "contact_reveal_business_id_created_at_idx" ON "contact_reveal"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "zero_result_query_query_idx" ON "zero_result_query"("query");

-- CreateIndex
CREATE INDEX "zero_result_query_created_at_idx" ON "zero_result_query"("created_at");

-- CreateIndex
CREATE INDEX "saved_search_user_id_idx" ON "saved_search"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "redirect_from_path_key" ON "redirect"("from_path");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_buyer_company_id_fkey" FOREIGN KEY ("buyer_company_id") REFERENCES "buyer_company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_default_template_id_fkey" FOREIGN KEY ("default_template_id") REFERENCES "spec_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_template" ADD CONSTRAINT "spec_template_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spec_field" ADD CONSTRAINT "spec_field_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "spec_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_template" ADD CONSTRAINT "seller_template_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_template" ADD CONSTRAINT "seller_template_platform_template_id_fkey" FOREIGN KEY ("platform_template_id") REFERENCES "spec_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business" ADD CONSTRAINT "business_primary_category_id_fkey" FOREIGN KEY ("primary_category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business" ADD CONSTRAINT "business_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business" ADD CONSTRAINT "business_visited_by_staff_id_fkey" FOREIGN KEY ("visited_by_staff_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_category" ADD CONSTRAINT "business_category_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_category" ADD CONSTRAINT "business_category_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location" ADD CONSTRAINT "location_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location" ADD CONSTRAINT "location_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_enquiry_id_fkey" FOREIGN KEY ("enquiry_id") REFERENCES "enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiry" ADD CONSTRAINT "enquiry_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiry" ADD CONSTRAINT "enquiry_buyer_company_id_fkey" FOREIGN KEY ("buyer_company_id") REFERENCES "buyer_company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiry_line" ADD CONSTRAINT "enquiry_line_enquiry_id_fkey" FOREIGN KEY ("enquiry_id") REFERENCES "enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiry_recipient" ADD CONSTRAINT "enquiry_recipient_enquiry_id_fkey" FOREIGN KEY ("enquiry_id") REFERENCES "enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiry_recipient" ADD CONSTRAINT "enquiry_recipient_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_enquiry_id_fkey" FOREIGN KEY ("enquiry_id") REFERENCES "enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_enquiry_id_fkey" FOREIGN KEY ("enquiry_id") REFERENCES "enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_quote_revision_id_fkey" FOREIGN KEY ("quote_revision_id") REFERENCES "quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_enquiry_id_fkey" FOREIGN KEY ("enquiry_id") REFERENCES "enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_report" ADD CONSTRAINT "supplier_report_subject_business_id_fkey" FOREIGN KEY ("subject_business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_report" ADD CONSTRAINT "supplier_report_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_slot" ADD CONSTRAINT "placement_slot_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "placement_slot" ADD CONSTRAINT "placement_slot_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_reveal" ADD CONSTRAINT "contact_reveal_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_reveal" ADD CONSTRAINT "contact_reveal_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_reveal" ADD CONSTRAINT "contact_reveal_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_search" ADD CONSTRAINT "saved_search_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redirect" ADD CONSTRAINT "redirect_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
