-- CreateTable
CREATE TABLE "emirate_page" (
    "id" TEXT NOT NULL,
    "emirate" "emirate" NOT NULL,
    "category_id" TEXT NOT NULL,
    "intro" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emirate_page_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emirate_page_published_at_idx" ON "emirate_page"("published_at");

-- CreateIndex
CREATE UNIQUE INDEX "emirate_page_emirate_category_id_key" ON "emirate_page"("emirate", "category_id");

-- AddForeignKey
ALTER TABLE "emirate_page" ADD CONSTRAINT "emirate_page_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
