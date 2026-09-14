import type { HomeRail } from "@/lib/content/home-rails";
import type { ChipRow, CuratedBusiness, SearchedTerm, SlotRow } from "@/lib/content/homepage";
import { blockIsVerification, CHIP_CAP, chipHref, firstFreePosition, SLOT_COUNT, slotOrder, type FeatureBlock } from "@/lib/content/homepage-rules";
import { formatCount, formatDate, formatDuration } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";

/**
 * Board 6h — every string and number the screen shows, from the service's rows.
 *
 * Pure, so the gallery renders the same presenter over fixtures that the route
 * renders over the database. The client components below it receive strings
 * and plain data, never a function or a `Date`.
 */

/** A featured licence this close to its date is called out in the warn panel. */
export const EXPIRY_NOTICE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CurationData {
  slots: SlotRow[];
  chips: ChipRow[];
  rails: HomeRail[];
  /** Name matches for `find`, or empty when nothing was searched. */
  candidates: CuratedBusiness[];
  suggestions: CuratedBusiness[];
  searched: SearchedTerm[];
  find: string;
  /** Businesses in the directory — what four slots are measured against. */
  businesses: number;
  canWrite: boolean;
}

export interface BusinessView {
  id: string;
  name: string;
  initials: string;
  storefrontHref: string;
  tierLabel: string;
  eligible: boolean;
  signals: string;
  licence: string;
  /** The failed condition, as a sentence. Null when eligible. */
  block: string | null;
  /** The next step for a blocked business: its account, where the tier is decided. */
  action: { label: string; href: string } | null;
}

export interface SlotView {
  position: number;
  positionLabel: string;
  business: BusinessView | null;
  /** On a slot held by a blocked business: it renders empty on the home page. */
  emptyOnHome: string | null;
  removeLabel: string | null;
}

export interface ChipView {
  id: string;
  label: string;
  href: string;
  removeLabel: string;
}

export interface RailView {
  key: string;
  name: string;
  source: string;
  curated: boolean;
  board: string | null;
  boardHref: string | null;
  boardNote: string | null;
  items: string;
}

export interface NoticeView {
  tone: "warn" | "neutral";
  eyebrow: string;
  lead: string;
  body: string;
}

export interface CurationView {
  canWrite: boolean;
  slots: SlotView[];
  order: (string | null)[];
  live: number;
  firstFree: number | null;
  meta: string;
  chips: ChipView[];
  chipCount: string;
  chipFull: boolean;
  searched: { query: string; searches: string; state: string; tone: "ok" | "warn" | "neutral" }[];
  find: string;
  candidates: BusinessView[];
  suggestions: BusinessView[];
  rails: RailView[];
  notice: NoticeView;
  cost: string;
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toLocaleUpperCase("en"))
    .join("");
}

function blockText(block: FeatureBlock, business: CuratedBusiness): string {
  return t(`curation.block.${block}` as MessageKey, { date: formatDate(business.licenceExpiry) });
}

/** "Industrial & MEP · Jebel Ali FZ · 126 reviews · replies in ~2 h · 1,204 products". */
function signals(business: CuratedBusiness): string {
  const parts = [business.sectorName];
  if (business.areaName) parts.push(business.areaName);
  parts.push(
    business.reviewCount > 0
      ? t("curation.signal.reviews", { count: business.reviewCount, n: formatCount(business.reviewCount) })
      : t("curation.signal.no_reviews"),
  );
  parts.push(
    business.responseTimeMedianMs !== null
      ? t("curation.signal.replies", { duration: formatDuration(business.responseTimeMedianMs) })
      : t("curation.signal.no_reply_time"),
  );
  // A service firm's depth is its services — the one card on the rail that says the directory is not only goods.
  const services = business.sellsKind === "services" || (business.sellsKind === "both" && business.serviceCount > 0);
  const goods = business.sellsKind !== "services";
  if (goods && business.productCount > 0) {
    parts.push(t("curation.signal.products", { count: business.productCount, n: formatCount(business.productCount) }));
  }
  if (services && business.serviceCount > 0) {
    parts.push(t("curation.signal.services", { count: business.serviceCount, n: formatCount(business.serviceCount) }));
  }
  if (business.productCount === 0 && business.serviceCount === 0) parts.push(t("curation.signal.no_catalogue"));
  return parts.join(" · ");
}

function presentBusiness(business: CuratedBusiness): BusinessView {
  const tier = Math.max(0, Math.min(2, business.verificationTier));
  return {
    id: business.id,
    name: business.displayName,
    initials: initials(business.displayName),
    storefrontHref: `/b/${business.slug}`,
    tierLabel: t("curation.tier", { tier: String(tier), label: t(`verify.t${tier}` as MessageKey) }),
    eligible: business.block === null,
    signals: signals(business),
    licence: t("curation.licence", { date: formatDate(business.licenceExpiry) }),
    block: business.block ? blockText(business.block, business) : null,
    action: business.block
      ? {
          label: t(blockIsVerification(business.block) ? "curation.open_verification" : "curation.open_account"),
          href: `/admin/businesses/${business.id}`,
        }
      : null,
  };
}

function presentNotice(slots: SlotRow[], now: Date): NoticeView {
  const vacated = slots.find((slot) => slot.business?.block);
  if (vacated?.business) {
    return {
      tone: "warn",
      eyebrow: t("curation.notice.eyebrow"),
      lead: t("curation.notice.vacated_lead", { position: String(vacated.position), business: vacated.business.displayName }),
      body: t("curation.notice.vacated_body", { condition: blockText(vacated.business.block!, vacated.business) }),
    };
  }

  const soonest = slots
    .flatMap((slot) => (slot.business ? [{ position: slot.position, business: slot.business }] : []))
    .filter(({ business }) => {
      const left = business.licenceExpiry.getTime() - now.getTime();
      return left >= 0 && left <= EXPIRY_NOTICE_DAYS * DAY_MS;
    })
    .sort((a, b) => a.business.licenceExpiry.getTime() - b.business.licenceExpiry.getTime())[0];
  if (soonest) {
    return {
      tone: "warn",
      eyebrow: t("curation.notice.eyebrow"),
      lead: t("curation.notice.expiring_lead", { business: soonest.business.displayName, date: formatDate(soonest.business.licenceExpiry) }),
      body: t("curation.notice.expiring_body", { position: String(soonest.position) }),
    };
  }

  return {
    tone: "neutral",
    eyebrow: t("curation.notice.eyebrow"),
    lead: t("curation.notice.none_lead", { days: formatCount(EXPIRY_NOTICE_DAYS) }),
    body: t("curation.notice.none_body"),
  };
}

function presentRail(rail: HomeRail): RailView {
  // The noun agrees with the number it sits beside: "1 sector", "3 of 4 cards".
  const unit = t(`curation.rails.unit.${rail.key}` as MessageKey, { count: rail.limit ?? rail.count });
  return {
    key: rail.key,
    name: t(`curation.rails.name.${rail.key}` as MessageKey),
    source: t(`curation.rails.source.${rail.source}` as MessageKey),
    curated: rail.source === "curated",
    board: rail.board,
    boardHref: rail.href,
    boardNote: rail.board ? t(`curation.rails.note.${rail.key}` as MessageKey) : null,
    items:
      rail.limit !== null
        ? t("curation.rails.items_of", { n: formatCount(rail.count), limit: formatCount(rail.limit), unit })
        : t("curation.rails.items", { n: formatCount(rail.count), unit }),
  };
}

export function presentCuration(data: CurationData, now: Date = new Date()): CurationView {
  const held = data.slots.flatMap((slot) => (slot.business ? [{ position: slot.position, businessId: slot.business.id }] : []));
  const live = data.slots.filter((slot) => slot.business && !slot.business.block).length;

  return {
    canWrite: data.canWrite,
    slots: data.slots.map((slot) => ({
      position: slot.position,
      positionLabel: t("curation.slot", { position: String(slot.position) }),
      business: slot.business ? presentBusiness(slot.business) : null,
      emptyOnHome: slot.business?.block ? t("curation.empty_on_home", { position: String(slot.position) }) : null,
      removeLabel: slot.business ? t("curation.remove_named", { business: slot.business.displayName }) : null,
    })),
    order: slotOrder(held),
    live,
    firstFree: firstFreePosition(held),
    meta: t("curation.meta", { live: formatCount(live), slots: formatCount(SLOT_COUNT), chips: formatCount(data.chips.length) }),
    chips: data.chips.map((chip) => ({
      id: chip.id,
      label: chip.label,
      href: chipHref(chip.query),
      removeLabel: t("curation.chips.remove_named", { label: chip.label }),
    })),
    chipCount: t("curation.chips.count", { count: formatCount(data.chips.length), cap: formatCount(CHIP_CAP) }),
    chipFull: data.chips.length >= CHIP_CAP,
    searched: data.searched.map((term) => ({
      query: term.query,
      searches: formatCount(term.searches),
      state: t(!term.answered ? "curation.searched.unanswered" : term.chipped ? "curation.searched.chipped" : "curation.searched.answered"),
      tone: !term.answered ? "warn" : term.chipped ? "ok" : "neutral",
    })),
    find: data.find,
    candidates: data.candidates.map(presentBusiness),
    suggestions: data.suggestions.map(presentBusiness),
    rails: data.rails.map(presentRail),
    notice: presentNotice(data.slots, now),
    cost: t("curation.cost_body", { businesses: formatCount(data.businesses), slots: formatCount(SLOT_COUNT) }),
  };
}
