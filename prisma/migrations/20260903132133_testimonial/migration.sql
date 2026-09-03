-- CreateEnum
CREATE TYPE "testimonial_audience" AS ENUM ('buyer', 'supplier');

-- CreateTable
CREATE TABLE "testimonial" (
    "id" TEXT NOT NULL,
    "audience" "testimonial_audience" NOT NULL,
    "body" TEXT NOT NULL,
    "attribution" TEXT NOT NULL,
    "context" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "testimonial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "testimonial_audience_published_at_sort_order_idx" ON "testimonial"("audience", "published_at", "sort_order");
