import "server-only";
import { prisma } from "@/lib/db/client";
import { resolveTradeKind, tradeKindOrigin } from "@/lib/taxonomy/trade-kind";
import { loadTradeKinds } from "@/lib/taxonomy/service";
import type { SellsKind } from "@/lib/db/generated/enums";

/**
 * Board `2b-s` — what a seller says they sell.
 *
 * A confirmation, not an interrogation. `4d-s` has already resolved a kind from
 * the categories the licence put this business in; this reads that, states it
 * as a recommendation with the evidence beside it, and lets the seller overrule
 * it without friction.
 *
 * ## The rule that shapes this whole module
 *
 * **A recommendation may only come from a decision somebody made.**
 *
 * `resolveTradeKind` never returns null — a category with nothing set anywhere
 * above it falls back to `goods`, because the product behaved that way before
 * the column existed and an unset taxonomy must not change what the site does.
 * That fallback is correct for *rendering* and useless as *evidence*: it says
 * nothing about the business, only that ops has not reached that row yet.
 *
 * Production has 0 of 440 categories set. If the fallback counted, every seller
 * on the platform would be shown "we sell products · MATCHES YOUR LICENCE" over
 * a licence nobody had read. So the recommendation is built from
 * `tradeKindOrigin`, which distinguishes a decided value from a fallback, and
 * an undecided taxonomy produces no recommendation at all — which is AC2:
 * *"the pre-selection ... is absent when the mapping is ambiguous"*.
 *
 * ## Why the evidence is the licence text and not our category names
 *
 * B3. `Business.licenceActivity` is the trading activity as the register words
 * it, carried over at import — "Auditing of accounts · Tax consultancy". The
 * seller recognises their own licence; they do not recognise our taxonomy, and
 * paraphrasing register prose into our names is how a confirmation screen stops
 * confirming anything.
 */

/** Why there is no recommendation, when there is none. */
export type NoRecommendation =
  /** The business is in no categories yet — nothing to read. */
  | "no_categories"
  /** Every category falls back rather than answering; ops has not set them. */
  | "taxonomy_undecided";

export interface KindRecommendation {
  /** Null means: offer the three options neutrally and say why. */
  suggested: Exclude<SellsKind, "unset"> | null;
  /** Set when `suggested` is null, so the screen can say which silence it is. */
  because: NoRecommendation | null;
  /** The licence's own words. Rendered verbatim, never paraphrased. */
  licenceActivity: string | null;
  licenceNumber: string;
  licenceAuthority: string;
  /** The categories that were read, with what each one actually answered. */
  read: { name: string; kind: "goods" | "services"; decided: boolean }[];
  /** What the seller has already said, if they have been here before. */
  current: SellsKind;
  /** Once published, the change belongs in Settings where it is confirmed. */
  published: boolean;
}

/**
 * What to pre-select, and the evidence for it.
 *
 * Reads every category the business holds — primary and extras — because a firm
 * that supplies equipment and services it holds one of each, and that is
 * precisely the case `both` exists for.
 */
export async function recommendKind(businessId: string): Promise<KindRecommendation | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      sellsKind: true,
      publishedAt: true,
      licenceActivity: true,
      licenceNumber: true,
      licenceAuthority: true,
      primaryCategoryId: true,
      categories: { select: { categoryId: true } },
    },
  });
  if (!business) return null;

  const rows = await loadTradeKinds();

  /*
     Primary first, then the extras, deduplicated.

     `unverifiedActivityAt` is deliberately NOT filtered here. That flag means a
     reviewer has not yet confirmed the category against the licence, and board
     2c keeps such a category out of the fan-out — but this screen is asking the
     seller what they sell, and a category they added themselves is evidence of
     their intent whether or not a reviewer has been round yet.
  */
  const ids = [
    ...new Set([business.primaryCategoryId, ...business.categories.map((c) => c.categoryId)]),
  ];

  const names = await prisma.category.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(names.map((row) => [row.id, row.name]));

  const read = ids.map((id) => {
    const origin = tradeKindOrigin(rows, id);
    return {
      name: nameOf.get(id) ?? "—",
      kind: resolveTradeKind(rows, id),
      // `own` and `inherited` are both decisions somebody made. `default` is
      // the absence of one, and is the only state that cannot be evidence.
      decided: origin.from !== "default",
    };
  });

  const base = {
    licenceActivity: business.licenceActivity,
    licenceNumber: business.licenceNumber,
    licenceAuthority: String(business.licenceAuthority),
    read,
    current: business.sellsKind,
    published: business.publishedAt !== null,
  };

  if (ids.length === 0) {
    return { ...base, suggested: null, because: "no_categories" };
  }

  const decided = read.filter((row) => row.decided);
  if (decided.length === 0) {
    return { ...base, suggested: null, because: "taxonomy_undecided" };
  }

  const goods = decided.some((row) => row.kind === "goods");
  const services = decided.some((row) => row.kind === "services");

  return {
    ...base,
    suggested: goods && services ? "both" : services ? "services" : "goods",
    because: null,
  };
}

/** What the seller may answer. `unset` is a state, never a choice. */
export const SELLS_CHOICES = ["services", "goods", "both"] as const;
export type SellsChoice = (typeof SELLS_CHOICES)[number];

export function isSellsChoice(value: string): value is SellsChoice {
  return (SELLS_CHOICES as readonly string[]).includes(value);
}

export type SetKindResult = { ok: true } | { ok: false; error: "not_found" | "published" };

/**
 * Record the seller's own answer.
 *
 * **It writes nothing but the declaration.** No product is converted, no
 * service is created, no category is changed — the same rule `4d-s` B5 states
 * for the other half of the fork, and the reason the copy on the screen can
 * promise that switching keeps your data.
 *
 * Refuses once the business is published. Not because the answer is frozen, but
 * because after publication the change has consequences a five-second onboarding
 * click should not carry — it belongs in Settings, confirmed, which is where
 * this route sends a published seller.
 */
export async function setSellsKind(
  businessId: string,
  kind: SellsChoice,
): Promise<SetKindResult> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { publishedAt: true },
  });
  if (!business) return { ok: false, error: "not_found" };
  if (business.publishedAt !== null) return { ok: false, error: "published" };

  await prisma.business.update({ where: { id: businessId }, data: { sellsKind: kind } });
  return { ok: true };
}

/**
 * Change the declaration after publication — board `2b-s` B5.
 *
 * The onboarding screen promises "you can switch in Settings at any time", and
 * B5 says not to ship that copy without the behaviour. This is the behaviour.
 *
 * **It converts nothing**, which is the whole point and the reason the promise
 * is safe to make. A product keeps its stock level and a service keeps its
 * scope; the fields the other kind does not have stay empty for the seller to
 * fill. Silent conversion would destroy data, and it is the one thing both
 * halves of this fork — `4d-s` B5 and this — refuse to do.
 *
 * Audited is the wrong word here and deliberately not used: `AuditEvent` records
 * *staff* decisions and its `actorId` is a staff seat. This is the seller
 * changing their own listing, so it goes through the listing's own revision
 * trail like every other thing a seller edits about themselves.
 */
export async function changeSellsKind(
  businessId: string,
  kind: SellsChoice,
): Promise<{ ok: true; changed: boolean } | { ok: false; error: "not_found" }> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { sellsKind: true },
  });
  if (!business) return { ok: false, error: "not_found" };
  if (business.sellsKind === kind) return { ok: true, changed: false };

  await prisma.business.update({ where: { id: businessId }, data: { sellsKind: kind } });
  return { ok: true, changed: true };
}
