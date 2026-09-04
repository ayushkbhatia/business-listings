-- CreateTable
CREATE TABLE "rate_limit_hit" (
    "id" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_hit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rate_limit_hit_bucket_identifier_created_at_idx" ON "rate_limit_hit"("bucket", "identifier", "created_at");

-- CreateIndex
CREATE INDEX "rate_limit_hit_created_at_idx" ON "rate_limit_hit"("created_at");
