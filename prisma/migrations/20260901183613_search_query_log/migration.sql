-- CreateTable
CREATE TABLE "search_query_log" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "normalised" TEXT NOT NULL,
    "result_count" INTEGER NOT NULL,
    "category_id" TEXT,
    "emirate" "emirate",
    "tab" TEXT NOT NULL DEFAULT 'businesses',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_query_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "search_query_log_normalised_created_at_idx" ON "search_query_log"("normalised", "created_at");

-- CreateIndex
CREATE INDEX "search_query_log_created_at_idx" ON "search_query_log"("created_at");
