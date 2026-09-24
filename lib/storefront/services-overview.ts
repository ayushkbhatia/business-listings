import { sectorSlug } from "@/lib/onboarding/service-profile";

/**
 * Board `1d-s` — the rules of the storefront a firm that sells work gets.
 *
 * Pure, so each rule is a unit test and the gallery can render every state from
 * plain objects. The loader in `lib/storefront/services.ts` fetches; this
 * decides.
 */

/* ── Sectors, declared ───────────────────────────────────────────────────── */

export interface DeclaredSector {
  label: string;
  /** The firm's own number. Null means not declared, which is not zero. */
  engagements: number | null;
}

/**
 * The sector chips, in the order the firm listed them — B8.
 *
 * Joined on the matching form, so a count saved under *Free Zone* still reads
 * against a sector since re-typed as *free zone*. A count whose sector is no
 * longer listed is dropped rather than rendered: the chip is the claim, and a
 * number with no chip is a number about nothing on this page.
 */
export function declaredSectors(
  sectorsServed: readonly string[],
  engagements: readonly { sectorSlug: string; engagements: number }[],
): DeclaredSector[] {
  const counts = new Map(engagements.map((row) => [row.sectorSlug, row.engagements]));
  return sectorsServed.map((label) => {
    const count = counts.get(sectorSlug(label));
    return { label, engagements: count !== undefined && count > 0 ? count : null };
  });
}

/**
 * Whether the disclaimer is owed.
 *
 * B8 puts it directly beneath the counts. A row of sectors with no numbers on
 * it makes no claim about volume, and a sentence disclaiming counts nobody
 * printed reads as a page that forgot to render them.
 */
export function carriesCounts(sectors: readonly DeclaredSector[]): boolean {
  return sectors.some((sector) => sector.engagements !== null);
}

/* ── Credentials ─────────────────────────────────────────────────────────── */

/** How many rows the overview shows before *see all credentials*. The board draws four. */
export const OVERVIEW_CREDENTIALS = 4;

/**
 * The overview's credentials, and how many are behind the link.
 *
 * Order is the loader's — verified first, then by kind — so the four shown are
 * the four most worth showing. At or under the cut there is no link, which is
 * the board's *one credential* state: a *see all* that shows the same rows is a
 * door into the room you are standing in.
 */
export function overviewCredentials<T>(
  rows: readonly T[],
  shown: number = OVERVIEW_CREDENTIALS,
): { shown: T[]; more: number } {
  return { shown: rows.slice(0, shown), more: Math.max(0, rows.length - shown) };
}

/**
 * The credential the hero names beside the licence badge, if one has earned it.
 *
 * **Only a register-verified one.** The render pairs *Licence verified* with the
 * FTA agent number, and a claim in that position would read as a second
 * platform check sitting beside the first — which is the one thing `8b-s` B10
 * forbids. No register is connected today (`lib/credentials/fta.ts` is a seam),
 * so this is null on every live listing, and that is the correct render rather
 * than a gap.
 */
export function heroCredential<T extends { verified: boolean; expiresOn?: Date | null }>(
  rows: readonly T[],
  /**
   * The start of the UAE day. A checked credential whose confirmed date has
   * passed is not named here — board `6a-s` B4, the rule every badge of a
   * checked credential follows (`currentCheckedCredential`). The table below
   * the hero still lists it with its date, which is a true thing to print.
   */
  today?: Date,
): T | null {
  return (
    rows.find(
      (row) =>
        row.verified &&
        (today === undefined || !row.expiresOn || row.expiresOn.getTime() >= today.getTime()),
    ) ?? null
  );
}

/* ── Services ────────────────────────────────────────────────────────────── */

/** How many service rows the overview draws before *all N services*. */
export const OVERVIEW_SERVICES = 4;

/**
 * Which service the composer opens on — B11.
 *
 * The one the buyer arrived asking about, when they arrived from `1g-s` or the
 * services tab and it is still live; otherwise the firm's first, which is the
 * work it leads with. A slug for a draft or a deleted service falls through to
 * the first rather than to an empty select: the buyer came to enquire, and a
 * form that refuses to open because a link went stale has lost the enquiry.
 */
export function composerService(
  services: readonly { slug: string }[],
  requested: string | null | undefined,
): string | null {
  if (requested && services.some((service) => service.slug === requested)) return requested;
  return services[0]?.slug ?? null;
}
