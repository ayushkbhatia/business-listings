import { acceptedWindow } from "@/lib/reviews/eligibility";
import { EMPTY_REVIEW_FIELDS, type ReviewFields } from "@/lib/reviews/write";
import type {
  OtherEnquiries,
  ReviewWriteData,
  ReviewWriteEnquiry,
  ReviewWriteSupplier,
  WrittenReview,
} from "@/lib/reviews/write-view";

/**
 * Board 10f's world, as `loadReviewWrite` would read it — for the gallery.
 *
 * One fixed clock, 15 Sep 2026, the day the board posts. `ENQ-8802`, the deep
 * clean AMC Marina Facilities accepted from Sparkle Facilities Services on
 * 2 Aug at AED 9,600 (the corrected figure), and the rail's two other enquiries
 * as corrected at export: `ENQ-8841` with Al Waha, accepted 21 Aug and open until
 * 19 Nov, beside `ENQ-8744`, which nobody replied to.
 */

export const REVIEW_WRITE_NOW = new Date("2026-09-15T08:00:00+04:00");

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);

/** A 1×1 transparent GIF: a photo tile with nothing in it, as the board draws `IMG 1`. */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export const sparkle: ReviewWriteSupplier = {
  id: "biz-sparkle",
  slug: "sparkle-facilities-services",
  displayName: "Sparkle Facilities Services",
  categoryCode: "FM",
  listed: true,
};

const alWaha: ReviewWriteSupplier = {
  id: "biz-alwaha",
  slug: "al-waha-industrial-supplies",
  displayName: "Al Waha Industrial Supplies",
  categoryCode: "VF",
  listed: true,
};

const acceptedOn = at("2026-08-02T14:00:00+04:00");

export const amc: ReviewWriteEnquiry = {
  id: "enq-8802",
  ref: "ENQ-8802",
  headline: "Deep clean AMC, 3 retail units",
  place: "Sharjah",
  acceptedAt: acceptedOn,
  value: { kind: "goods", fils: 960_000n },
};

const others: OtherEnquiries = {
  rows: [
    {
      id: "enq-8841",
      ref: "ENQ-8841",
      headline: "Chilled water riser — 40 valves",
      state: {
        kind: "open",
        closesOn: acceptedWindow(at("2026-08-21T10:00:00+04:00"), null)!.closesOn,
        supplierName: "Al Waha Industrial Supplies",
        draft: false,
      },
    },
    { id: "enq-8744", ref: "ENQ-8744", headline: "Fire-rated ducting Ø300", state: { kind: "no_reply" } },
  ],
  more: 0,
};

const photo = (n: number) => ({ path: `biz-sparkle/review/enq-8802/img-${n}.jpg`, width: 1600, height: 1200, bytes: 180_000 });

export const drawnFields: ReviewFields = {
  overall: 4,
  quotedAccurate: 5,
  onTime: 3,
  asDescribed: 4,
  responsiveness: 5,
  body: "Quote matched the final invoice to the dirham. Crew arrived a day late on the first visit but stayed until it was done, and the supervisor answers his phone.",
  showCompanyName: true,
  photos: [photo(1), photo(2)],
};

const photoUrls = Object.fromEntries(drawnFields.photos.map((p) => [p.path, BLANK]));

export function drawnReview(): Extract<ReviewWriteData, { kind: "form" }> {
  return {
    kind: "form",
    mode: "new",
    reviewId: null,
    enquiry: amc,
    supplier: sparkle,
    provenance: "accepted_quote",
    window: acceptedWindow(acceptedOn, null),
    company: "Marina Facilities LLC",
    fields: drawnFields,
    photoUrls,
    draftSavedAt: new Date(REVIEW_WRITE_NOW.getTime() - 6 * 60_000),
    editableUntil: null,
    others,
  };
}

export function emptyReview(): Extract<ReviewWriteData, { kind: "form" }> {
  return { ...drawnReview(), fields: { ...EMPTY_REVIEW_FIELDS }, photoUrls: {}, draftSavedAt: null };
}

/** A buyer with no company on the account: one way to sign, and the reason said. */
export function anonymousReview(): Extract<ReviewWriteData, { kind: "form" }> {
  return {
    ...drawnReview(),
    company: null,
    provenance: "verified_enquiry",
    enquiry: { ...amc, acceptedAt: null, value: null },
    fields: { ...drawnFields, showCompanyName: false, photos: [], asDescribed: null, onTime: null },
    photoUrls: {},
    window: { anchor: "replied", from: at("2026-07-28T00:00:00Z"), closesOn: at("2026-10-26T00:00:00Z") },
  };
}

export function editReview(): Extract<ReviewWriteData, { kind: "form" }> {
  return {
    ...drawnReview(),
    mode: "edit",
    reviewId: "rev-8802",
    window: null,
    draftSavedAt: null,
    editableUntil: new Date(REVIEW_WRITE_NOW.getTime() + 13 * DAY),
  };
}

function written(over: Partial<WrittenReview> = {}): WrittenReview {
  const postedAt = new Date(REVIEW_WRITE_NOW.getTime() - DAY);
  return {
    id: "rev-8802",
    fields: drawnFields,
    photoUrls,
    createdAt: postedAt,
    editableUntil: new Date(postedAt.getTime() + 14 * DAY),
    editable: true,
    edited: false,
    heldAt: null,
    removedAt: null,
    sellerReply: null,
    sellerRepliedAt: null,
    replyRemoved: false,
    ...over,
  };
}

const reviewed = (review: WrittenReview): ReviewWriteData => ({
  kind: "reviewed",
  enquiry: amc,
  supplier: sparkle,
  provenance: "accepted_quote",
  company: "Marina Facilities LLC",
  review,
  others,
});

export const reviewedEditable = () => reviewed(written());
export const reviewedReplied = () =>
  reviewed(
    written({
      editable: false,
      sellerReply: "Thank you. The first visit slipped because of a vehicle problem; the standby van now covers early slots.",
      sellerRepliedAt: new Date(REVIEW_WRITE_NOW.getTime() - 2 * 60 * 60_000),
    }),
  );
export const reviewedFixed = () =>
  reviewed(
    written({
      createdAt: new Date(REVIEW_WRITE_NOW.getTime() - 30 * DAY),
      editableUntil: new Date(REVIEW_WRITE_NOW.getTime() - 16 * DAY),
      editable: false,
      edited: true,
    }),
  );
export const reviewedHeld = () =>
  reviewed(written({ editable: false, heldAt: new Date(REVIEW_WRITE_NOW.getTime() - 3 * 60 * 60_000) }));
export const reviewedRemoved = () =>
  reviewed(written({ editable: false, removedAt: new Date(REVIEW_WRITE_NOW.getTime() - DAY) }));

export function windowClosed(): ReviewWriteData {
  const acceptedLong = at("2026-05-18T11:00:00+04:00");
  return {
    kind: "closed",
    enquiry: { ...amc, ref: "ENQ-8611", headline: "Post-fit-out deep clean, one office floor", place: "Business Bay", acceptedAt: acceptedLong, value: { kind: "goods", fils: 480_000n } },
    supplier: sparkle,
    window: acceptedWindow(acceptedLong, null)!,
    others,
  };
}

export function notEligible(): ReviewWriteData {
  return {
    kind: "refused",
    reason: "no_confirmed_enquiry",
    enquiry: { id: "enq-8744", ref: "ENQ-8744", headline: "Fire-rated ducting Ø300" },
    others: { rows: [others.rows[0]!], more: 0 },
  };
}

export function chooseSupplier(): ReviewWriteData {
  return {
    kind: "choose",
    enquiry: { ...amc, ref: "ENQ-8790", headline: "Pallet racking, 2 bays", acceptedAt: null, value: null },
    suppliers: [alWaha, { ...sparkle, id: "biz-gulf", displayName: "Northern Gulf Trading" }],
    others,
  };
}

export function notYetOpen(): ReviewWriteData {
  return {
    kind: "not_yet_open",
    enquiry: { ...amc, ref: "ENQ-8812", headline: "Soft services AMC, 24 months", value: { kind: "proposal", feeAed: "6800.00", feeBasisLabel: "Per month" } },
    supplier: sparkle,
    opensOn: at("2026-11-01T00:00:00Z"),
    others,
  };
}
