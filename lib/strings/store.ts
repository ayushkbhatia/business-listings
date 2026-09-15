import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/client";
import { copiesFrom, halfFor, PAIRED_LOCALE, type EntryRow, type PairedCopies, type PairedCopy } from "@/lib/i18n/paired";

/**
 * Board `12g-s` — the rows behind every paired string, read once and cached.
 *
 * Every screen that renders a pair reads it through here, so a half written on
 * `/admin/strings/paired` reaches the storefront, the dashboard and search on
 * the next render rather than the next deploy. The rows are few — a decision
 * per half — and global, so they are cached under one tag for an hour and the
 * console clears the tag on every write.
 *
 * The readers below the cached getter are exported uncached for the same reason
 * `lib/db/queries/home.ts` gives: `unstable_cache` needs a request context, and
 * a test in node does not have one.
 */

export const STRINGS_CACHE_TAG = "strings";

export async function readEntryRows(locale: string = PAIRED_LOCALE): Promise<EntryRow[]> {
  return prisma.stringEntry.findMany({
    where: { locale },
    orderBy: [{ key: "asc" }, { kind: "asc" }],
    select: { key: true, kind: true, state: true, value: true, updatedAt: true },
  });
}

const getEntryRows = unstable_cache(readEntryRows, ["string-entries"], {
  revalidate: 3600,
  tags: [STRINGS_CACHE_TAG],
});

/** Both halves of every pair, as plain data a client component can receive. */
export async function pairedCopies(): Promise<PairedCopies> {
  return copiesFrom(await getEntryRows(PAIRED_LOCALE));
}

/** The half one business reads, from its own declared kind (`B5`). */
export async function pairedCopyFor(sellsKind: "unset" | "goods" | "services" | "both"): Promise<PairedCopy> {
  return (await pairedCopies())[halfFor(sellsKind)];
}

/**
 * The same half, read without the data cache — for a service in `lib/` that a
 * test calls outside a request, where `unstable_cache` has no store to reach.
 * One small query; a page should prefer `pairedCopyFor`.
 */
export async function readPairedCopyFor(sellsKind: "unset" | "goods" | "services" | "both"): Promise<PairedCopy> {
  return copiesFrom(await readEntryRows(PAIRED_LOCALE))[halfFor(sellsKind)];
}
