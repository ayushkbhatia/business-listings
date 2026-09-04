/**
 * What a concierge catalogue load costs, and what it promises — the pure half.
 *
 * Split out of `pricing.ts` for one reason: `prisma/seed.mts` writes the
 * settings row, and it is a plain `tsx` script with no `--conditions=
 * react-server`. Importing anything carrying `import "server-only"` throws at
 * module load and takes the whole seed down before the first row is written, so
 * the constants a seed needs cannot live behind that fence.
 *
 * The alternative was retyping `250` in the seed beside a constant that already
 * said `250`, and two copies of a number drift — the copy that loses is the one
 * nobody is looking at. `lib/trade/hours.ts` and `lib/trade/ramadan-calendar.ts`
 * are the same split for the same reason, and `pricing.ts` re-exports these so
 * no caller has to know which half a name lives in.
 */

/** The `PlatformSetting.key` the per-plan terms live under. */
export const CATALOGUE_IMPORT_PRICING_KEY = "catalogue_import_pricing";

/** What one plan gets. `offered: false` means the panel does not render at all. */
export interface CatalogueImportTerms {
  offered: boolean;
  /** Whole dirhams. Zero where the plan includes the work. */
  feeAed: number;
}

/** Keyed by `Plan.id` — `free`, `basic`, `pro`. */
export type CatalogueImportPricing = Record<string, CatalogueImportTerms>;

/**
 * The compiled terms, and the fallback the reader merges the setting over.
 *
 * Free is not offered rather than priced. A seller on Free has a ten-product
 * cap, so keying fifty in for them would be selling work the plan cannot hold;
 * the honest answer is that the service is not part of that plan, which is what
 * `concierge.error.not_offered` says.
 */
/*
   `satisfies` rather than an annotation, so the inferred type stays the concrete
   object literal. Prisma's `InputJsonValue` does not accept a named
   `Record<string, T>` — an index signature is not a JSON object to it — and the
   seed writes this value straight into `PlatformSetting.value`. The check is
   the same either way; only the inferred type differs.
*/
export const FALLBACK_CATALOGUE_PRICING = {
  free: { offered: false, feeAed: 0 },
  basic: { offered: true, feeAed: 250 },
  pro: { offered: true, feeAed: 0 },
} satisfies CatalogueImportPricing;
