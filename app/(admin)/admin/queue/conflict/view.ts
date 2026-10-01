import type { ClaimPartyReason } from "@/lib/db/generated/enums";
import type { ClaimSide, ConflictReview, LogEntry } from "@/lib/claims/review";
import type { RecommendationBasis, Signal } from "@/lib/claims/signals";
import { formatCount, formatDateShort, formatDateTime, formatDuration, formatMonth, formatPhone, formatRating, formatRelative } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";

/**
 * Board 4c — the conflict screen, as words.
 *
 * Everything the screen states is resolved here, on the server, from the read
 * model (`lib/claims/review.ts`): every row's sentence and the colour of its
 * outcome, every tag, the rail's figures and the log. The client receives
 * strings and plain data and composes only the confirm sheet, whose sentences
 * depend on what the reviewer picks. A function never crosses the boundary.
 */

export type Tone = "ok" | "warn" | "bad" | "neutral";

export interface RowView {
  key: string;
  label: string;
  value: string;
  tone: Tone | "muted" | "body";
  mono?: boolean;
  /** A second line under the value — the licence's source-holding, an expiry. */
  note?: { text: string; tone: Tone | "muted" } | null;
}

export interface CardView {
  id: string;
  label: string;
  title: string;
  tag: { text: string; tone: Tone } | null;
  recommended: boolean;
  rows: RowView[];
  file: { href: string; label: string; filename: string } | null;
  tenancyFile: { href: string; label: string } | null;
  live: boolean;
  /** Null where this claim can be awarded; otherwise why it cannot. */
  awardBlocked: string | null;
}

export interface SheetClaim {
  id: string;
  label: string;
  licence: string | null;
  /** From our register. Null means the reviewer types it for a split. */
  legalName: string | null;
  needsExpiry: boolean;
  hasListing: { name: string; slug: string } | null;
  lapsed: boolean;
  /** `B13`'s hint against the source licence, worded. Null where it looks like a branch. */
  branchHint: string | null;
  defaultReason: ClaimPartyReason;
}

export interface LogLine {
  text: string;
  stamp: string;
  done: boolean;
  late?: boolean;
}

export interface ConflictView {
  id: string;
  /** `decide` for an ops lead on an open conflict; `read` for everybody else. */
  mode: "decide" | "read";
  open: boolean;
  challenge: boolean;
  docsOut: boolean;
  banner: { lead: string; body: string };
  notices: { key: string; tone: "info" | "warn"; body: string; fix?: string }[];
  incumbent: { title: string; since: string | null; body: string } | null;
  cards: CardView[];
  recommendedId: string | null;
  basis: string | null;
  sheet: SheetClaim[];
  sourceLicence: string;
  waitingEnquiries: number;
  holders: { id: string; name: string }[];
  assignee: string | null;
  rail: {
    name: string;
    place: string;
    rows: RowView[];
    cost: string | null;
    log: LogLine[];
    award: { label: string; claimId: string } | null;
    split: { label: string; keeperId: string; secondId: string } | null;
  };
  resolved: {
    sentence: string;
    note: string;
    released: string | null;
    notified: string;
    producedHref: string | null;
    auditHref: string;
  } | null;
  dissolved: string | null;
}

const SIGNAL_LABEL: Record<Signal["key"], MessageKey> = {
  trade_name: "admin.conflict.row.trade_name",
  address: "admin.conflict.row.address",
  phone: "admin.conflict.row.phone",
  email_domain: "admin.conflict.row.email",
};

const OUTCOME_TONE: Record<Signal["outcome"], RowView["tone"]> = {
  match: "ok",
  partial: "warn",
  none: "bad",
  unknown: "muted",
};

function signalRow(signal: Signal): RowView {
  const value =
    signal.detail === "not_in_register"
      ? t("admin.conflict.signal.not_in_register")
      : t(`admin.conflict.signal.${signal.key}.${signal.detail}` as MessageKey, {
          value: signal.key === "phone" && signal.value ? formatPhone(signal.value) : (signal.value ?? ""),
        });
  return { key: signal.key, label: t(SIGNAL_LABEL[signal.key]), value, tone: OUTCOME_TONE[signal.outcome] };
}

function tagFor(review: ConflictReview, side: ClaimSide): { text: string; tone: Tone } | null {
  if (side.outcome === "withdrawn") return { text: t("admin.conflict.tag.withdrawn"), tone: "neutral" };
  const resolution = review.resolution;
  if (resolution) {
    if (side.id === resolution.awardedId) return { text: t("admin.conflict.tag.awarded"), tone: "ok" };
    if (side.id === resolution.secondId && resolution.kind === "split_into_two") return { text: t("admin.conflict.tag.split"), tone: "neutral" };
    if (side.id === resolution.secondId && resolution.kind === "merge_as_branches") return { text: t("admin.conflict.tag.branch"), tone: "neutral" };
    if (side.outcome === "rejected") return { text: t("admin.conflict.tag.not_awarded"), tone: "bad" };
  }
  const strength = review.assessment.strength.get(side.id) ?? null;
  if (strength === "stronger") return { text: t("admin.conflict.tag.stronger"), tone: "ok" };
  if (strength === "partial") return { text: t("admin.conflict.tag.partial"), tone: "warn" };
  if (strength === "none") return { text: t("admin.conflict.tag.none"), tone: "bad" };
  return null;
}

function claimantValue(side: ClaimSide): string {
  const name = side.claimantName ?? side.accountName;
  if (!name) return t("admin.conflict.claimant_unnamed");
  return side.role ? t("admin.conflict.claimant_value", { name, role: t(`verify.role.${side.role}` as MessageKey) }) : name;
}

/**
 * Which of the four reasons a claim that loses is most plausibly owed, from the
 * same signals that scored it — a default for the reviewer to confirm, never a
 * choice made for them.
 */
function defaultReason(review: ConflictReview, side: ClaimSide): ClaimPartyReason {
  if (review.docsRequest && !side.tenancyDocument) return "documents_not_received";
  if (side.route === "phone_callback") return "not_confirmed_by_phone";
  if (review.claims.some((other) => other.id !== side.id && other.scored.holdsSourceLicence) && !side.scored.holdsSourceLicence) {
    return "not_source_licence";
  }
  return "details_do_not_match";
}

function cardFor(review: ConflictReview, side: ClaimSide): CardView {
  const licenceNote = side.licenceNumber
    ? side.scored.holdsSourceLicence
      ? { text: t("admin.conflict.holds_source"), tone: "ok" as const }
      : { text: t("admin.conflict.not_source"), tone: "muted" as const }
    : null;
  const rows: RowView[] = [
    { key: "claimant", label: t("admin.conflict.row.claimant"), value: claimantValue(side), tone: "body" },
    signalRow(side.scored.signals.find((signal) => signal.key === "trade_name")!),
    {
      key: "licence",
      label: t("admin.conflict.row.licence"),
      value: side.licenceNumber ?? t("admin.conflict.no_licence"),
      tone: side.licenceNumber ? ("body") : "muted",
      mono: side.licenceNumber !== null,
      note: side.scored.licenceLapsed && side.licenceExpiry
        ? { text: t("admin.conflict.lapsed", { date: formatDateShort(side.licenceExpiry) }), tone: "bad" }
        : licenceNote,
    },
    ...side.scored.signals.filter((signal) => signal.key !== "trade_name").map(signalRow),
  ];
  if (review.docsRequest) {
    rows.push({
      key: "tenancy",
      label: t("admin.conflict.row.tenancy"),
      value: side.tenancyDocument
        ? t("admin.conflict.tenancy.received", { date: formatDateShort(side.tenancyDocument.createdAt) })
        : t("admin.conflict.tenancy.waiting"),
      tone: side.tenancyDocument ? "ok" : "warn",
    });
  }
  const call = review.log.findLast((entry): entry is Extract<LogEntry, { kind: "call" }> => entry.kind === "call" && entry.claim === side.label);
  if (call) {
    rows.push({
      key: "call",
      label: t("admin.conflict.row.call"),
      value:
        call.to === "public_record"
          ? call.confirmed
            ? t("admin.conflict.call.public_confirmed")
            : t("admin.conflict.call.public_unconfirmed")
          : t("admin.conflict.call.supplied"),
      tone: call.to === "public_record" ? (call.confirmed ? "ok" : "bad") : "warn",
    });
  }

  return {
    id: side.id,
    label: side.label,
    title: t("admin.conflict.card.title", { label: side.label, date: formatDateShort(side.createdAt) }),
    tag: tagFor(review, side),
    recommended: review.state !== "resolved" && review.assessment.recommended === side.id,
    rows,
    file: side.document
      ? { href: `/admin/queue/claim/${side.id}/document`, label: t("admin.conflict.open_file"), filename: side.document.filename }
      : null,
    tenancyFile: side.tenancyDocument ? { href: `/admin/queue/claim/${side.id}/document?file=tenancy`, label: t("admin.conflict.open_tenancy") } : null,
    live: side.live,
    awardBlocked: side.scored.licenceLapsed ? t("admin.conflict.cannot_award") : null,
  };
}

function logLine(entry: LogEntry): LogLine {
  const stamp = formatDateTime(entry.at);
  const actor = "actor" in entry ? (entry.actor ?? t("admin.conflict.log.someone")) : "";
  switch (entry.kind) {
    case "claim_received":
      return {
        stamp,
        done: true,
        text: entry.opened
          ? t("admin.conflict.log.received_opened", { label: entry.claim })
          : t("admin.conflict.log.received", { label: entry.claim }),
      };
    case "claim_withdrawn":
      return { stamp, done: true, text: t("admin.conflict.log.withdrawn", { label: entry.claim }) };
    case "tenancy_received":
      return { stamp, done: true, text: t("admin.conflict.log.tenancy", { label: entry.claim }) };
    case "call":
      return {
        stamp,
        done: true,
        text: t(entry.to === "public_record" ? "admin.conflict.log.call_public" : "admin.conflict.log.call_supplied", {
          actor,
          label: entry.claim ?? "",
          outcome: t(entry.confirmed ? "admin.conflict.log.call_confirmed" : "admin.conflict.log.call_not_confirmed"),
        }),
      };
    case "assigned":
      return { stamp, done: true, text: t("admin.conflict.log.assigned", { actor }) };
    case "docs_requested":
      return { stamp, done: true, text: t("admin.conflict.log.docs", { actor }) };
    case "escalated":
      return { stamp, done: true, text: t("admin.conflict.log.escalated", { actor }) };
    case "resolved":
      return {
        stamp,
        done: true,
        text: t("admin.conflict.log.resolved", {
          actor,
          resolution: entry.resolution ? t(`admin.conflict.resolution.${entry.resolution}` as MessageKey) : "",
        }),
      };
    case "dissolved":
      return { stamp, done: true, text: t("admin.conflict.log.dissolved") };
  }
}

const BASIS: Record<RecommendationBasis, MessageKey> = {
  source_licence: "admin.conflict.basis.source_licence",
  matches: "admin.conflict.basis.matches",
  call: "admin.conflict.basis.call",
};

export function conflictView(
  review: ConflictReview,
  options: {
    canResolve: boolean;
    holders: { id: string; name: string }[];
    assignee: string | null;
    now: Date;
  },
): ConflictView {
  const { now } = options;
  const open = review.state !== "resolved" && review.state !== "dissolved";
  const live = review.claims.filter((side) => side.live);
  const labelOf = (id: string | null) => review.claims.find((side) => side.id === id)?.label ?? "";

  /* The banner leads with the fact that settles most conflicts (§Flagged 1). */
  const holders = review.claims.filter((side) => side.outcome !== "withdrawn" && side.scored.holdsSourceLicence);
  const sourceLicence = review.source.record.licenceNumber;
  const banner = review.challenge
    ? { lead: t("admin.conflict.banner.challenge_lead"), body: t("admin.conflict.banner.challenge_body") }
    : {
        lead: t("admin.conflict.banner.race_lead", { n: formatCount(review.claims.filter((side) => side.outcome !== "withdrawn").length) }),
        body:
          holders.length === 1
            ? t("admin.conflict.banner.source_held", { label: holders[0]!.label, licence: sourceLicence })
            : holders.length > 1
              ? t("admin.conflict.banner.source_many", { licence: sourceLicence })
              : t("admin.conflict.banner.source_none", { licence: sourceLicence }),
      };

  const notices: ConflictView["notices"] = [];
  if (open && !options.canResolve) {
    notices.push({ key: "moderator", tone: "info", body: t("admin.conflict.moderator") });
  }
  if (open && review.escalation) {
    notices.push({
      key: "escalated",
      tone: "info",
      body: [
        t("admin.conflict.escalated", { name: review.escalation.to ?? t("admin.conflict.log.someone"), when: formatRelative(review.escalation.at, { now }) }),
        t("admin.conflict.escalated_note", { note: review.escalation.note }),
      ].join(" "),
    });
  }
  if (open && review.docsRequest) {
    const received = live.filter((side) => side.tenancyDocument).length;
    notices.push(
      review.docsRequest.receivedAt
        ? { key: "docs", tone: "info", body: t("admin.conflict.docs_received", { when: formatRelative(review.docsRequest.at, { now }) }) }
        : {
            key: "docs",
            tone: "warn",
            body: t("admin.conflict.docs_requested", {
              when: formatRelative(review.docsRequest.at, { now }),
              received: formatCount(received),
              count: formatCount(live.length),
            }),
            fix: t("admin.conflict.docs_fix"),
          },
    );
  }

  const cards = review.claims.map((side) => cardFor(review, side));
  const recommended = review.assessment.recommended;
  const others = live.filter((side) => side.id !== recommended);

  /* The rail (B9): one query's count and its unit, and the log (B14). */
  const listing = review.listing;
  const origin = review.source.origin;
  const railRows: RowView[] = [
    {
      key: "source",
      label: t("admin.conflict.rail.source"),
      value:
        origin.kind === "self_added"
          ? t("admin.conflict.rail.source_self")
          : origin.kind === "licence_import"
            ? t("admin.conflict.rail.source_import", { month: formatMonth(origin.importedAt) })
            : t("admin.conflict.rail.source_import_unknown"),
      tone: "body",
    },
    { key: "source_licence", label: t("admin.conflict.rail.source_licence"), value: sourceLicence, tone: "body", mono: true },
    { key: "views", label: t("admin.conflict.rail.views"), value: formatCount(listing.views30d), tone: "body", mono: true },
    {
      key: "reviews",
      label: t("admin.conflict.rail.reviews"),
      value:
        listing.reviewCount === 0
          ? t("admin.conflict.rail.reviews_none")
          : listing.rating !== null
            ? t("admin.conflict.rail.reviews_value", { n: formatCount(listing.reviewCount), rating: formatRating(listing.rating) })
            : t("admin.conflict.rail.reviews_count", { count: listing.reviewCount, n: formatCount(listing.reviewCount) }),
      tone: listing.reviewCount === 0 ? "muted" : ("body"),
    },
    {
      key: "waiting",
      label: t("admin.conflict.rail.waiting"),
      value:
        listing.waitingEnquiries === 0
          ? t("admin.conflict.rail.waiting_none")
          : t("admin.conflict.rail.waiting_value", { count: listing.waitingEnquiries, n: formatCount(listing.waitingEnquiries) }),
      tone: listing.waitingEnquiries > 0 && open ? "bad" : "muted",
    },
  ];
  const cost =
    !open || listing.waitingEnquiries === 0
      ? null
      : review.challenge
        ? t("admin.conflict.rail.cost_challenge", { count: listing.waitingEnquiries, n: formatCount(listing.waitingEnquiries) })
        : listing.waitingBuyers === listing.waitingEnquiries
          ? t("admin.conflict.rail.cost_buyers", { count: listing.waitingBuyers, n: formatCount(listing.waitingBuyers) })
          : t("admin.conflict.rail.cost_enquiries", {
              enquiries: formatCount(listing.waitingEnquiries),
              buyers: formatCount(listing.waitingBuyers),
            });

  const log = review.log.map(logLine);
  if (open) {
    const clock = review.clock;
    log.push({
      text: t("admin.conflict.log.due"),
      stamp: clock.paused
        ? t("admin.conflict.log.paused")
        : clock.late
          ? t("admin.conflict.log.overdue", { time: formatDuration(clock.overdueMs) })
          : t("admin.conflict.log.due_in", { time: formatDuration(clock.remainingMs) }),
      done: false,
      late: clock.late,
    });
  }

  const decide = open && options.canResolve;
  const award =
    decide && !review.challenge && recommended && live.some((side) => side.id === recommended)
      ? {
          claimId: recommended,
          label:
            live.length === 2
              ? t("admin.conflict.cta.award_both", { label: labelOf(recommended) })
              : t("admin.conflict.cta.award_all", { label: labelOf(recommended), n: formatCount(live.length) }),
        }
      : null;
  const splitSecond = others.length === 1 ? others[0]! : null;
  const split =
    award && splitSecond && splitSecond.licenceNumber
      ? { label: t("admin.conflict.cta.split", { label: splitSecond.label }), keeperId: recommended!, secondId: splitSecond.id }
      : null;

  const resolution = review.resolution;
  const resolved = resolution
    ? {
        sentence: (() => {
          const name = resolution.by ?? t("admin.conflict.log.someone");
          const date = formatDateTime(resolution.at);
          switch (resolution.kind) {
            case "award":
              return t("admin.conflict.resolved.award", { label: labelOf(resolution.awardedId), name, date });
            case "split_into_two":
              return t("admin.conflict.resolved.split", { label: labelOf(resolution.awardedId), second: labelOf(resolution.secondId), name, date });
            case "merge_as_branches":
              return t("admin.conflict.resolved.merge", { label: labelOf(resolution.awardedId), second: labelOf(resolution.secondId), name, date });
            case "keep_owner":
              return t("admin.conflict.resolved.keep", { name, date });
            default:
              return t("admin.conflict.resolved.legacy", { name, date, resolution: t(`admin.conflict.resolution.${resolution.kind}` as MessageKey) });
          }
        })(),
        note: t("admin.conflict.resolved.note", { note: resolution.note }),
        released:
          resolution.awardedId && resolution.enquiriesReleased > 0
            ? t("admin.conflict.resolved.released", { count: resolution.enquiriesReleased, n: formatCount(resolution.enquiriesReleased) })
            : null,
        notified: t("admin.conflict.resolved.notified", { count: resolution.notifications, n: formatCount(resolution.notifications) }),
        producedHref: resolution.producedBusiness ? `/b/${resolution.producedBusiness.slug}` : null,
        auditHref: `/admin/audit?subject=${encodeURIComponent(`ClaimConflict:${review.id}`)}`,
      }
    : null;

  return {
    id: review.id,
    mode: decide ? "decide" : "read",
    open,
    challenge: review.challenge,
    docsOut: review.state === "docs_requested",
    banner,
    notices,
    incumbent: review.incumbent
      ? {
          title: t("admin.conflict.card.owner_title"),
          since: review.incumbent.since ? t("admin.conflict.card.owner_since", { date: formatDateShort(review.incumbent.since) }) : null,
          body: t("admin.conflict.card.owner_body"),
        }
      : null,
    cards,
    recommendedId: open ? recommended : null,
    basis: review.assessment.basis ? t(BASIS[review.assessment.basis]) : null,
    sheet: live.map((side) => ({
      id: side.id,
      label: side.label,
      licence: side.licenceNumber,
      legalName: side.register?.tradeName ?? null,
      needsExpiry: !side.register?.licenceExpiry && !side.licenceExpiry,
      hasListing:
        side.register?.businessId && side.register.businessId !== review.business.id && side.register.businessName && side.register.businessSlug
          ? { name: side.register.businessName, slug: side.register.businessSlug }
          : null,
      lapsed: side.scored.licenceLapsed,
      branchHint:
        side.licenceNumber && !side.branchOfSource
          ? t("admin.conflict.sheet.branch_hint", { licence: side.licenceNumber, source: sourceLicence })
          : null,
      defaultReason: defaultReason(review, side),
    })),
    sourceLicence,
    waitingEnquiries: listing.waitingEnquiries,
    holders: options.holders,
    assignee: options.assignee,
    rail: {
      name: review.business.displayName,
      place: t("admin.conflict.rail.place", {
        category: review.source.categoryName,
        area: [review.business.areaName, review.business.emirate ? t(`emirate.${review.business.emirate}` as MessageKey) : null].filter(Boolean).join(", "),
      }),
      rows: railRows,
      cost,
      log,
      award,
      split,
    },
    resolved,
    dissolved: review.dissolvedAt ? t("admin.conflict.dissolved.body", { date: formatDateTime(review.dissolvedAt) }) : null,
  };
}
