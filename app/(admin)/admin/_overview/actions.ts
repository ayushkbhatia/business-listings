"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireStaff } from "@/lib/auth/staff";
import { OVERVIEW_CACHE_TAG } from "@/lib/console/overview";

/**
 * *Refresh figures* — the overview's §States row *snapshot stale*.
 *
 * The month's figures are cached, ten minutes for the month in progress and
 * six hours for a closed one, and the header says when they were computed.
 * This throws the cache away so the next render computes them again. It writes
 * nothing anybody can see — no record moves — so it is not a staff mutation and
 * writes no audit row; it costs one recomputation and is open to every seat
 * that can open the screen.
 */
export async function refreshOverview(): Promise<void> {
  await requireStaff();
  revalidateTag(OVERVIEW_CACHE_TAG, { expire: 0 });
  revalidatePath("/admin");
}
