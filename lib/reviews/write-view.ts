import type { Crumb } from "@/components/structure/Breadcrumb";
import { formatDate, formatDateShort, formatList } from "@/lib/format";
import { dubaiDayStart } from "@/lib/format/date";
import { t } from "@/lib/i18n";
import { amountWords } from "@/lib/messaging/negotiation-words";
import { feeOnBasis } from "@/lib/quote/proposal-words";
import {
  EDITABLE_DAYS,
  REPLY_WINDOW_DAYS,
  REVIEW_WINDOW_DAYS,
  type Provenance,
  type ReviewWindow,
} from "./eligibility";
import { PROVENANCE_TONE } from "./row-view";
import type { ContactKind, ReviewFields } from "./write";

/**
 * Board 10f — the page's facts, and the words it says about them.
 *
 * The loader (`write-server.ts`) reads rows into `ReviewWriteData`; this turns
 * that into strings and plain values the page and the client form render.
 * Pure, so `/dev/gallery` draws every state from a fixture through the same
 * function the route calls, and a unit test can read the words without a
 * database.
 */

/* ── Facts ─────────────────────────────────────────────────────────────────── */

export interface ReviewWriteSupplier {
  id: string;
  slug: string;
  displayName: string;
  categoryCode: string | null;
  /** `/b/:slug/reviews` exists for it: published, not suspended, claimed. */
  listed: boolean;
}

export interface ReviewWriteEnquiry {
  id: string;
  ref: string;
  headline: string;
  place: string | null;
  /** When the reviewed supplier's quote was accepted. Null on the enquiry rung. */
  acceptedAt: Date | null;
  value: { kind: "goods"; fils: bigint } | { kind: "proposal"; feeAed: string; feeBasisLabel: string } | null;
}

export type OtherEnquiryState =
  | { kind: "open"; closesOn: Date | null; supplierName: string; draft: boolean }
  | { kind: "choose"; count: number }
  | { kind: "not_yet_open"; opensOn: Date; supplierName: string }
  | { kind: "reviewed"; on: Date; supplierName: string }
  | { kind: "closed"; closedOn: Date; supplierName: string }
  /** The only supplier left to review is the one the buyer's own account sits on. */
  | { kind: "own_business"; supplierName: string }
  | { kind: "no_reply" };

export interface OtherEnquiry {
  id: string;
  ref: string;
  headline: string;
  state: OtherEnquiryState;
}

export interface OtherEnquiries {
  rows: OtherEnquiry[];
  /** Enquiries not listed. Stated, never dropped silently. */
  more: number;
}

export interface WrittenReview {
  id: string;
  fields: ReviewFields;
  photoUrls: Record<string, string>;
  createdAt: Date;
  editableUntil: Date;
  editable: boolean;
  edited: boolean;
  heldAt: Date | null;
  removedAt: Date | null;
  /** Null when there is none, or when staff removed it (`replyRemoved`). */
  sellerReply: string | null;
  sellerRepliedAt: Date | null;
  replyRemoved: boolean;
}

export type ReviewWriteData =
  | {
      kind: "refused";
      /** `not_permitted` is build plan 9.4: the person, not the enquiry, is refused. */
      reason: "not_your_enquiry" | "no_confirmed_enquiry" | "not_permitted";
      enquiry: { id: string; ref: string; headline: string } | null;
      others: OtherEnquiries;
    }
  | {
      /**
       * The subject is the business the buyer's own account sits on, and no
       * supplier reviews itself. Its own kind rather than a `refused` reason,
       * because the words name the supplier.
       */
      kind: "own_business";
      enquiry: { id: string; ref: string; headline: string };
      supplier: ReviewWriteSupplier;
      others: OtherEnquiries;
    }
  | {
      kind: "choose";
      enquiry: ReviewWriteEnquiry;
      suppliers: ReviewWriteSupplier[];
      others: OtherEnquiries;
    }
  | {
      kind: "not_yet_open";
      enquiry: ReviewWriteEnquiry;
      supplier: ReviewWriteSupplier;
      opensOn: Date;
      others: OtherEnquiries;
    }
  | {
      kind: "closed";
      enquiry: ReviewWriteEnquiry;
      supplier: ReviewWriteSupplier;
      window: ReviewWindow;
      others: OtherEnquiries;
    }
  | {
      kind: "form";
      mode: "new" | "edit";
      reviewId: string | null;
      enquiry: ReviewWriteEnquiry;
      supplier: ReviewWriteSupplier;
      provenance: Provenance;
      /** Null in edit mode, and where the enquiry cannot date the supplier's reply. */
      window: ReviewWindow | null;
      company: string | null;
      fields: ReviewFields;
      photoUrls: Record<string, string>;
      draftSavedAt: Date | null;
      editableUntil: Date | null;
      others: OtherEnquiries;
    }
  | {
      kind: "reviewed";
      enquiry: ReviewWriteEnquiry;
      supplier: ReviewWriteSupplier;
      provenance: Provenance;
      company: string | null;
      review: WrittenReview;
      others: OtherEnquiries;
    };

/* ── Words ─────────────────────────────────────────────────────────────────── */

export interface JobCardView {
  supplierName: string;
  categoryCode: string | null;
  /** `ENQ-8802 · Accepted 2 Aug 2026 · Deep clean AMC · Sharjah · AED 9,600`. */
  meta: string;
  provenance: { label: string; tone: "ok" | "neutral" } | null;
}

export interface RailRule {
  holds: boolean;
  text: string;
}

export interface RailStep {
  title: string;
  body: string;
}

export interface OtherEnquiryView {
  id: string;
  headline: string;
  href: string;
  meta: string;
  state: string;
  tone: "open" | "muted";
}

export type ReviewWriteBody =
  | { kind: "form" }
  | {
      kind: "notice";
      title: string;
      body: string;
      links: { label: string; href: string }[];
    }
  | {
      kind: "choose";
      body: string;
      options: { id: string; label: string; href: string }[];
    }
  | {
      kind: "reviewed";
      status: { tone: "ok" | "warn" | "bad" | "neutral"; label: string; body: string };
      editHref: string | null;
      listingHref: string | null;
      listingLabel: string | null;
    };

export interface ReviewWriteView {
  title: string;
  lede: string | null;
  crumbs: Crumb[];
  band: string | null;
  job: JobCardView | null;
  rules: RailRule[];
  steps: RailStep[] | null;
  others: { rows: OtherEnquiryView[]; more: string | null; moreHref: string | null; empty: string };
  body: ReviewWriteBody;
}

export interface BuildOptions {
  now: Date;
  /** The claim token a provisional buyer arrived with, carried on every link. */
  token: string | null;
  /** `?posted=1` / `?saved=1` after a write that could not land on the listing. */
  flash?: "posted" | "saved" | null;
}

function withToken(href: string, token: string | null): string {
  if (!token) return href;
  return `${href}${href.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;
}

export function reviewHref(ref: string, token: string | null, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ enq: ref, ...extra });
  return withToken(`/review/new?${params.toString()}`, token);
}

export function trackingHref(ref: string, token: string | null): string {
  return withToken(`/enquiry/${ref}`, token);
}

/** Where a posted review is seen: the listing's reviews page, anchored (`B10`). */
export function listingReviewHref(slug: string, reviewId: string): string {
  return `/b/${slug}/reviews#review-${reviewId}`;
}

const CRUMB_HEADLINE = 32;

function clipped(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  const cut = chars.slice(0, max).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function valueWords(value: ReviewWriteEnquiry["value"]): string | null {
  if (!value) return null;
  return value.kind === "goods" ? amountWords(value.fils) : feeOnBasis(value);
}

export function jobMeta(enquiry: ReviewWriteEnquiry): string {
  // A requirement that already names its place ("… in Jumeirah") is not followed by "· Jumeirah".
  const place =
    enquiry.place && !enquiry.headline.toLowerCase().includes(enquiry.place.toLowerCase()) ? enquiry.place : null;
  return [
    enquiry.ref,
    enquiry.acceptedAt ? t("reviewwrite.job.accepted", { date: formatDate(enquiry.acceptedAt) }) : null,
    enquiry.headline,
    place,
    valueWords(enquiry.value),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function windowWords(window: ReviewWindow, supplierName: string): string {
  return t(`reviewwrite.band.${window.anchor}` as "reviewwrite.band.accepted", {
    date: formatDate(window.closesOn),
    days: REVIEW_WINDOW_DAYS,
    supplier: supplierName,
  });
}

export function contactKindWords(kinds: readonly ContactKind[]): string {
  return formatList(kinds.map((kind) => t(`reviewwrite.contact.${kind}` as "reviewwrite.contact.phone")));
}

/** `19 Nov` in the current year, `19 Nov 2025` otherwise — a narrow column cannot carry the year it does not need. */
function railDate(value: Date, now: Date): string {
  const year = (date: Date) => dubaiDayStart(date).getUTCFullYear();
  return year(value) === year(now) ? formatDateShort(value) : formatDate(value);
}

function otherView(row: OtherEnquiry, token: string | null, now: Date): OtherEnquiryView {
  const formatDate = (value: Date) => railDate(value, now);
  const meta = (who: string) => (who ? `${row.ref} · ${who}` : row.ref);
  const base = { id: row.id, headline: row.headline, href: reviewHref(row.ref, token) };
  const { state } = row;
  switch (state.kind) {
    case "open":
      return {
        ...base,
        meta: meta(state.supplierName),
        state: state.closesOn
          ? t(state.draft ? "reviewwrite.other.draft_until" : "reviewwrite.other.open_until", {
              date: formatDate(state.closesOn),
            })
          : t(state.draft ? "reviewwrite.other.draft" : "reviewwrite.other.open"),
        tone: "open",
      };
    case "choose":
      return {
        ...base,
        meta: meta(t("reviewwrite.other.replied_count", { count: state.count })),
        state: t("reviewwrite.other.choose"),
        tone: "open",
      };
    case "not_yet_open":
      return {
        ...base,
        meta: meta(state.supplierName),
        state: t("reviewwrite.other.opens", { date: formatDate(state.opensOn) }),
        tone: "muted",
      };
    case "reviewed":
      return {
        ...base,
        meta: meta(state.supplierName),
        state: t("reviewwrite.other.reviewed", { date: formatDate(state.on) }),
        tone: "muted",
      };
    case "closed":
      return {
        ...base,
        meta: meta(state.supplierName),
        state: t("reviewwrite.other.closed", { date: formatDate(state.closedOn) }),
        tone: "muted",
      };
    case "own_business":
      return {
        ...base,
        meta: meta(state.supplierName),
        state: t("reviewwrite.other.own_business"),
        tone: "muted",
      };
    case "no_reply":
      return {
        ...base,
        href: trackingHref(row.ref, token),
        meta: meta(t("reviewwrite.other.no_reply")),
        state: t("reviewwrite.other.not_eligible"),
        tone: "muted",
      };
  }
}

export function reviewRules(): RailRule[] {
  return [
    { holds: true, text: t("reviewwrite.rule.gate") },
    { holds: true, text: t("reviewwrite.rule.one", { days: EDITABLE_DAYS }) },
    { holds: false, text: t("reviewwrite.rule.traceable") },
    { holds: false, text: t("reviewwrite.rule.own") },
    { holds: false, text: t("reviewwrite.rule.seller") },
  ];
}

export function reviewSteps(supplier: ReviewWriteSupplier, provenance: Provenance): RailStep[] {
  return [
    {
      title: t("reviewwrite.step.check.title"),
      body: t(`reviewwrite.step.check.${provenance}` as "reviewwrite.step.check.accepted_quote"),
    },
    supplier.listed
      ? {
          title: t("reviewwrite.step.publish.title"),
          body: t("reviewwrite.step.publish.listed", { supplier: supplier.displayName }),
        }
      : {
          title: t("reviewwrite.step.publish.title_unlisted"),
          body: t("reviewwrite.step.publish.unlisted", { supplier: supplier.displayName }),
        },
    {
      title: t("reviewwrite.step.notify.title"),
      body: t("reviewwrite.step.notify.body", { days: REPLY_WINDOW_DAYS }),
    },
    {
      title: t("reviewwrite.step.edit.title", { days: EDITABLE_DAYS }),
      body: t("reviewwrite.step.edit.body"),
    },
  ];
}

function job(enquiry: ReviewWriteEnquiry, supplier: ReviewWriteSupplier, provenance: Provenance | null): JobCardView {
  return {
    supplierName: supplier.displayName,
    categoryCode: supplier.categoryCode,
    meta: jobMeta(enquiry),
    provenance: provenance
      ? {
          label: t(`reviewpage.provenance.${provenance}` as "reviewpage.provenance.accepted_quote"),
          tone: PROVENANCE_TONE[provenance],
        }
      : null,
  };
}

export function buildReviewWrite(data: ReviewWriteData, options: BuildOptions): ReviewWriteView {
  const { token } = options;

  const others = {
    rows: data.others.rows.map((row) => otherView(row, token, options.now)),
    // The inbox needs an account; a buyer on a claim token has no list to send them to.
    more: data.others.more > 0 ? t("reviewwrite.other.more", { count: data.others.more }) : null,
    moreHref: data.others.more > 0 && !token ? "/account/enquiries" : null,
    // Build plan 9.4: an account that may not review has no enquiry it may review.
    empty:
      data.kind === "refused" && data.reason === "not_permitted"
        ? t("reviewwrite.other.not_permitted")
        : t("reviewwrite.other.empty"),
  };

  const crumbs = (enquiry: { ref: string; headline: string } | null, last: string): Crumb[] => [
    ...(token ? [] : [{ label: t("reviewwrite.crumb.enquiries"), href: "/account/enquiries" }]),
    ...(enquiry
      ? [{ label: `${enquiry.ref} ${clipped(enquiry.headline, CRUMB_HEADLINE)}`, href: trackingHref(enquiry.ref, token) }]
      : []),
    { label: last },
  ];

  switch (data.kind) {
    case "refused": {
      const ref = data.enquiry?.ref ?? "";
      return {
        // The other refusals are about the enquiry; this one is about the account.
        title:
          data.reason === "not_permitted"
            ? t("reviewwrite.refused.not_permitted.h1")
            : t("reviewwrite.refused.title"),
        lede: null,
        crumbs: crumbs(data.enquiry, t("reviewwrite.crumb.write")),
        band: null,
        job: null,
        rules: reviewRules(),
        steps: null,
        others,
        body: {
          kind: "notice",
          title: t(`reviewwrite.refused.${data.reason}.title` as "reviewwrite.refused.not_your_enquiry.title"),
          body: t(`reviewwrite.refused.${data.reason}.body` as "reviewwrite.refused.not_your_enquiry.body", { ref }),
          links: data.enquiry
            ? [{ label: t("reviewwrite.back_to", { ref }), href: trackingHref(ref, token) }]
            : token
              ? []
              : [{ label: t("reviewwrite.crumb.enquiries"), href: "/account/enquiries" }],
        },
      };
    }

    case "own_business": {
      const { enquiry, supplier } = data;
      return {
        // Like `not_permitted`, about the account — but about this one supplier, by name.
        title: t("reviewwrite.refused.own_business.h1", { supplier: supplier.displayName }),
        lede: null,
        crumbs: crumbs(enquiry, t("reviewwrite.crumb.write")),
        band: null,
        job: null,
        rules: reviewRules(),
        steps: null,
        others,
        body: {
          kind: "notice",
          title: t("reviewwrite.refused.own_business.title", { supplier: supplier.displayName }),
          body: t("reviewwrite.refused.own_business.body", { supplier: supplier.displayName, ref: enquiry.ref }),
          links: [{ label: t("reviewwrite.back_to", { ref: enquiry.ref }), href: trackingHref(enquiry.ref, token) }],
        },
      };
    }

    case "choose":
      return {
        title: t("reviewwrite.choose.title"),
        lede: null,
        crumbs: crumbs(data.enquiry, t("reviewwrite.crumb.write")),
        band: null,
        job: null,
        rules: reviewRules(),
        steps: null,
        others,
        body: {
          kind: "choose",
          body: t("reviewwrite.choose.body", { ref: data.enquiry.ref, count: data.suppliers.length }),
          options: data.suppliers.map((supplier) => ({
            id: supplier.id,
            label: supplier.displayName,
            href: reviewHref(data.enquiry.ref, token, { about: supplier.id }),
          })),
        },
      };

    case "not_yet_open":
      return {
        title: t("reviewwrite.title.new", { supplier: data.supplier.displayName }),
        lede: null,
        crumbs: crumbs(data.enquiry, t("reviewwrite.crumb.write")),
        band: t("reviewwrite.band.opens", { date: formatDate(data.opensOn) }),
        job: job(data.enquiry, data.supplier, "accepted_quote"),
        rules: reviewRules(),
        steps: null,
        others,
        body: {
          kind: "notice",
          title: t("reviewwrite.not_yet_open.title", { date: formatDate(data.opensOn) }),
          body: t("reviewwrite.not_yet_open.body", { date: formatDate(data.opensOn) }),
          links: [{ label: t("reviewwrite.back_to", { ref: data.enquiry.ref }), href: trackingHref(data.enquiry.ref, token) }],
        },
      };

    case "closed":
      return {
        title: t("reviewwrite.title.new", { supplier: data.supplier.displayName }),
        lede: null,
        crumbs: crumbs(data.enquiry, t("reviewwrite.crumb.write")),
        band: t("reviewwrite.band.closed", { date: formatDate(data.window.closesOn) }),
        job: job(data.enquiry, data.supplier, data.enquiry.acceptedAt ? "accepted_quote" : "verified_enquiry"),
        rules: reviewRules(),
        steps: null,
        others,
        // The form is absent, not disabled (§States): the rule and the day, and a way out.
        body: {
          kind: "notice",
          title: t("reviewwrite.closed.title", { date: formatDate(data.window.closesOn) }),
          body: t(`reviewwrite.closed.body.${data.window.anchor}` as "reviewwrite.closed.body.accepted", {
            days: REVIEW_WINDOW_DAYS,
            from: formatDate(data.window.from),
            date: formatDate(data.window.closesOn),
            supplier: data.supplier.displayName,
          }),
          links: [{ label: t("reviewwrite.back_to", { ref: data.enquiry.ref }), href: trackingHref(data.enquiry.ref, token) }],
        },
      };

    case "form":
      return {
        title: t(data.mode === "edit" ? "reviewwrite.title.edit" : "reviewwrite.title.new", {
          supplier: data.supplier.displayName,
        }),
        lede:
          data.mode === "edit"
            ? t("reviewwrite.lede.edit")
            : t(data.company ? "reviewwrite.lede.company" : "reviewwrite.lede.anonymous", { days: EDITABLE_DAYS }),
        crumbs: crumbs(data.enquiry, t(data.mode === "edit" ? "reviewwrite.crumb.edit" : "reviewwrite.crumb.write")),
        band:
          data.mode === "edit" && data.editableUntil
            ? t("reviewwrite.band.editable", { date: formatDate(data.editableUntil) })
            : data.window
              ? windowWords(data.window, data.supplier.displayName)
              : null,
        job: job(data.enquiry, data.supplier, data.provenance),
        rules: reviewRules(),
        steps: data.mode === "edit" ? null : reviewSteps(data.supplier, data.provenance),
        others,
        body: { kind: "form" },
      };

    case "reviewed": {
      const { review, supplier } = data;
      const status = reviewedStatus(data, options);
      const visible = supplier.listed && !review.heldAt && !review.removedAt;
      return {
        title: t("reviewwrite.title.reviewed", { supplier: supplier.displayName }),
        lede: null,
        crumbs: crumbs(data.enquiry, t("reviewwrite.crumb.reviewed")),
        band: review.editable
          ? t("reviewwrite.band.editable", { date: formatDate(review.editableUntil) })
          : review.removedAt
            ? null
            : t("reviewwrite.band.fixed", { date: formatDate(fixedSince(review)) }),
        job: job(data.enquiry, supplier, data.provenance),
        rules: reviewRules(),
        steps: null,
        others,
        body: {
          kind: "reviewed",
          status,
          editHref: review.editable ? reviewHref(data.enquiry.ref, token, { edit: "1" }) : null,
          listingHref: visible ? listingReviewHref(supplier.slug, review.id) : null,
          listingLabel: visible ? t("reviewwrite.reviewed.see_listing", { supplier: supplier.displayName }) : null,
        },
      };
    }
  }
}

/** The day a review stopped being editable: the earliest of the window, a reply, a hold. */
function fixedSince(review: WrittenReview): Date {
  const candidates = [review.editableUntil, review.sellerRepliedAt, review.heldAt].filter(
    (value): value is Date => value !== null,
  );
  return new Date(Math.min(...candidates.map((value) => value.getTime())));
}

function reviewedStatus(
  data: Extract<ReviewWriteData, { kind: "reviewed" }>,
  options: BuildOptions,
): { tone: "ok" | "warn" | "bad" | "neutral"; label: string; body: string } {
  const { review, supplier } = data;
  const name = supplier.displayName;
  if (review.removedAt) {
    return {
      tone: "bad",
      label: t("reviewwrite.reviewed.removed.label"),
      body: t("reviewwrite.reviewed.removed.body", { date: formatDate(review.removedAt) }),
    };
  }
  if (review.heldAt) {
    return {
      tone: "warn",
      label: t("reviewwrite.reviewed.held.label"),
      body: t("reviewwrite.reviewed.held.body", { supplier: name }),
    };
  }
  if (review.sellerReply !== null || review.replyRemoved) {
    return {
      tone: "neutral",
      label: t("reviewwrite.reviewed.replied.label"),
      body: t("reviewwrite.reviewed.replied.body", {
        supplier: name,
        date: formatDate(review.sellerRepliedAt ?? review.createdAt),
      }),
    };
  }
  if (options.flash === "posted" || options.flash === "saved") {
    return {
      tone: "ok",
      label: t(options.flash === "posted" ? "reviewwrite.reviewed.posted.label" : "reviewwrite.reviewed.saved.label"),
      body: supplier.listed
        ? t("reviewwrite.reviewed.posted.listed", { supplier: name, date: formatDate(review.editableUntil) })
        : t("reviewwrite.reviewed.posted.unlisted", { supplier: name, date: formatDate(review.editableUntil) }),
    };
  }
  if (review.editable) {
    return {
      tone: "ok",
      label: t("reviewwrite.reviewed.editable.label"),
      body: t("reviewwrite.reviewed.editable.body", { date: formatDate(review.editableUntil) }),
    };
  }
  return {
    tone: "neutral",
    label: t("reviewwrite.reviewed.fixed.label"),
    body: t("reviewwrite.reviewed.fixed.body", { date: formatDate(fixedSince(review)) }),
  };
}
