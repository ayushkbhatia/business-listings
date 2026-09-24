import "server-only";
import { prisma } from "@/lib/db/client";
import { actorFor } from "@/lib/auth/actor";
import { mayWriteReview } from "@/lib/auth/guards";
import { requirementHeadline } from "@/lib/enquiry/inbox-status";
import { quoteTotalFils } from "@/lib/quote/money";
import { toProposalFigure, PROPOSAL_FIGURE_SELECT } from "@/lib/quote/proposal";
import { canReview, isEditable, provenanceOf, reviewableReplies, reviewWindowFor } from "./eligibility";
import { reviewPhotoStorage, type ReviewPhotoStorage } from "./photos";
import { ENQUIRY_FOR_REVIEW_SELECT, toEnquiryForReview } from "./service";
import { EMPTY_REVIEW_FIELDS, parsePhotoRefs, type ReviewFields } from "./write";
import type {
  OtherEnquiry,
  ReviewWriteData,
  ReviewWriteEnquiry,
  ReviewWriteSupplier,
  WrittenReview,
} from "./write-view";

/**
 * Board 10f — everything `/review/new` renders, read for one buyer.
 *
 * **`B1`: eligibility resolves here, from the enquiry, and never from `?enq=`.**
 * The query string names which enquiry the buyer means; whether they may review
 * it, and whom, is `canReview` over rows this function reads with the buyer's id
 * in the `where`. An unknown reference and somebody else's enquiry come back as
 * the same refusal, so the route cannot be used to find out which references
 * exist.
 *
 * The page never decides a state itself. It is handed one of seven, each with
 * the facts its render needs and nothing else.
 */

/** Board 10f's *Your other enquiries* panel lists at most this many. The rest are in the inbox. */
export const OTHER_ENQUIRIES_SHOWN = 5;

const SUPPLIER_SELECT = {
  id: true,
  slug: true,
  displayName: true,
  publishedAt: true,
  suspendedAt: true,
  claimStatus: true,
  primaryCategory: { select: { code: true } },
} as const;

function toSupplier(row: {
  id: string;
  slug: string;
  displayName: string;
  publishedAt: Date | null;
  suspendedAt: Date | null;
  claimStatus: string;
  primaryCategory: { code: string } | null;
}): ReviewWriteSupplier {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    categoryCode: row.primaryCategory?.code ?? null,
    // The conditions `/b/:slug/reviews` renders under. `B10` redirects there on
    // post only when the page will exist; an unpublished listing keeps the
    // review against its record and the buyer stays here.
    listed: row.publishedAt !== null && row.suspendedAt === null && row.claimStatus !== "unclaimed",
  };
}

export async function loadReviewWrite(input: {
  buyerId: string;
  /** `?enq=` — a reference or an id. A hint, never the gate. */
  enquiry: string;
  /** `?about=` — the supplier, where a fan-out drew several replies. */
  about?: string | null;
  /** `?edit=1` on a review still inside its window. */
  edit?: boolean;
  now: Date;
  storage?: ReviewPhotoStorage;
}): Promise<ReviewWriteData> {
  const { buyerId, now } = input;
  const storage = input.storage ?? reviewPhotoStorage;

  const row = await prisma.enquiry.findFirst({
    where: { OR: [{ ref: input.enquiry }, { id: input.enquiry }], buyerId },
    select: {
      ...ENQUIRY_FOR_REVIEW_SELECT,
      ref: true,
      requirement: true,
      deliverToArea: true,
      area: { select: { name: true } },
      // `businessId` is the gate's (ENQUIRY_FOR_REVIEW_SELECT); one key, so both here.
      buyer: { select: { businessId: true, buyerCompany: { select: { name: true } } } },
      reviewDraft: true,
    },
  });

  const others = await otherEnquiries(buyerId, row?.id ?? null, now);

  if (!row) {
    return { kind: "refused", reason: "not_your_enquiry", enquiry: null, others };
  }

  const gate = toEnquiryForReview(row);
  const company = row.buyer.buyerCompany?.name ?? null;

  const baseEnquiry = async (subjectId: string | null): Promise<ReviewWriteEnquiry> => ({
    id: row.id,
    ref: row.ref,
    headline: requirementHeadline(row.requirement),
    place: row.area?.name ?? row.deliverToArea ?? null,
    acceptedAt: subjectId && gate.contactReleasedToBusinessId === subjectId ? gate.contactReleasedAt : null,
    value: subjectId && gate.contactReleasedToBusinessId === subjectId ? await acceptedValue(row.id, subjectId) : null,
  });

  /* ── Already reviewed: the buyer's own copy, whatever the gate says now. ── */
  const existing = await prisma.review.findUnique({
    where: { enquiryId: row.id },
    select: {
      id: true,
      businessId: true,
      overall: true,
      quotedAccurate: true,
      onTime: true,
      asDescribed: true,
      responsiveness: true,
      body: true,
      showCompanyName: true,
      editableUntil: true,
      createdAt: true,
      heldAt: true,
      removedAt: true,
      sellerReply: true,
      sellerRepliedAt: true,
      replyRemovedAt: true,
      media: { select: { id: true, storagePath: true, alt: true, width: true, height: true, bytes: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      business: { select: SUPPLIER_SELECT },
      enquiry: { select: { contactReleasedToBusinessId: true } },
      _count: { select: { revisions: true } },
    },
  });

  if (existing) {
    const supplier = toSupplier(existing.business);
    const enquiry = await baseEnquiry(existing.businessId);
    const editable = isEditable(existing, now);
    const provenance = provenanceOf(existing);
    const fields: ReviewFields = {
      overall: existing.overall,
      quotedAccurate: existing.quotedAccurate,
      onTime: existing.onTime,
      asDescribed: existing.asDescribed,
      responsiveness: existing.responsiveness,
      body: existing.body,
      showCompanyName: existing.showCompanyName,
      photos: existing.media.map((item) => ({
        path: item.storagePath,
        width: item.width,
        height: item.height,
        bytes: item.bytes,
      })),
    };

    if (input.edit && editable) {
      return {
        kind: "form",
        mode: "edit",
        reviewId: existing.id,
        enquiry,
        supplier,
        provenance,
        window: null,
        company,
        fields,
        photoUrls: photoUrls(storage, fields),
        draftSavedAt: null,
        editableUntil: existing.editableUntil,
        others,
      };
    }

    const review: WrittenReview = {
      id: existing.id,
      fields,
      photoUrls: photoUrls(storage, fields),
      createdAt: existing.createdAt,
      editableUntil: existing.editableUntil,
      editable,
      edited: existing._count.revisions > 0,
      heldAt: existing.heldAt,
      removedAt: existing.removedAt,
      sellerReply: existing.replyRemovedAt ? null : existing.sellerReply,
      sellerRepliedAt: existing.sellerRepliedAt,
      replyRemoved: existing.replyRemovedAt !== null,
    };
    return { kind: "reviewed", enquiry, supplier, provenance, company, review, others };
  }

  /*
     ── The matrix, before the gate. ──

     Build plan 9.4: `createReview` asks `review.create` of this person before
     it reads the enquiry, so the form is not offered to one it would refuse —
     a staff seat with no buyer role, whatever the enquiry earned. Asked of the
     record, as the service asks it; a claim-token buyer holds it by name. Their
     own review above stays readable either way.
  */
  if (!mayWriteReview(await actorFor(buyerId))) {
    return {
      kind: "refused",
      reason: "not_permitted",
      enquiry: { id: row.id, ref: row.ref, headline: requirementHeadline(row.requirement) },
      // Every other enquiry is refused for the same reason. Listing them with
      // the gate's verdict would call them open to an account that cannot post.
      others: { rows: [], more: 0 },
    };
  }

  /* ── The gate. ── */
  const verdict = canReview(buyerId, gate, input.about ?? undefined, now);

  if (!verdict.ok) {
    switch (verdict.reason) {
      case "ambiguous_subject": {
        const suppliers = await prisma.business.findMany({
          // The gate's list: never the buyer's own business, which it would refuse.
          where: { id: { in: [...reviewableReplies(gate)] } },
          orderBy: [{ displayName: "asc" }, { id: "asc" }],
          select: SUPPLIER_SELECT,
        });
        return {
          kind: "choose",
          enquiry: await baseEnquiry(null),
          suppliers: suppliers.map(toSupplier),
          others,
        };
      }
      case "not_yet_open": {
        const supplier = await supplierById(gate.contactReleasedToBusinessId!);
        return {
          kind: "not_yet_open",
          enquiry: await baseEnquiry(supplier.id),
          supplier,
          opensOn: verdict.opensOn,
          others,
        };
      }
      case "window_closed": {
        const supplier = await supplierById(verdict.businessId);
        return {
          kind: "closed",
          enquiry: await baseEnquiry(supplier.id),
          supplier,
          window: verdict.window,
          others,
        };
      }
      case "own_business":
        // Named, so the refusal reads as a fact about this supplier and this account.
        return {
          kind: "own_business",
          enquiry: { id: row.id, ref: row.ref, headline: requirementHeadline(row.requirement) },
          supplier: await supplierById(verdict.businessId),
          others,
        };
      case "already_reviewed":
      // Unreachable — `existing` above — but a review written between the two
      // reads is a review, and the refusal says so rather than offering a form.
      case "no_confirmed_enquiry":
      case "not_your_enquiry":
        return {
          kind: "refused",
          reason: verdict.reason === "not_your_enquiry" ? "not_your_enquiry" : "no_confirmed_enquiry",
          enquiry: { id: row.id, ref: row.ref, headline: requirementHeadline(row.requirement) },
          others,
        };
    }
  }

  const supplier = await supplierById(verdict.businessId);
  const window = reviewWindowFor(gate, verdict.businessId);
  const draft = row.reviewDraft && row.reviewDraft.businessId === verdict.businessId ? row.reviewDraft : null;
  const fields: ReviewFields = draft
    ? {
        overall: draft.overall,
        quotedAccurate: draft.quotedAccurate,
        onTime: draft.onTime,
        asDescribed: draft.asDescribed,
        responsiveness: draft.responsiveness,
        body: draft.body,
        showCompanyName: draft.showCompanyName,
        photos: parsePhotoRefs(draft.photos),
      }
    : { ...EMPTY_REVIEW_FIELDS, showCompanyName: company !== null };

  return {
    kind: "form",
    mode: "new",
    reviewId: null,
    enquiry: await baseEnquiry(verdict.businessId),
    supplier,
    provenance: verdict.provenance,
    window,
    company,
    fields,
    photoUrls: photoUrls(storage, fields),
    draftSavedAt: draft?.updatedAt ?? null,
    editableUntil: null,
    others,
  };
}

/**
 * The link *Write a review* opens on a storefront's reviews page, for a buyer
 * who may write one about this business — or null, and the button is absent.
 *
 * Deliberately narrow: their own enquiry, this supplier, and the gate still
 * open on it. `canReview` is asked rather than reimplemented, so the button and
 * the page it opens cannot disagree about who is eligible — including the rule
 * that no supplier reviews itself, which keeps it off a supplier's own reviews
 * page for everyone on its team.
 *
 * Board 10f: the page it opens resolves its own subject, and on a fan-out that
 * several suppliers replied to it cannot tell which one the buyer means. This
 * page already knows — it is the supplier's own — so it says so with `&about=`,
 * which nothing produced before (build plan 3.5). The reference rather than the
 * id, because that is what the buyer reads on the page it opens.
 */
export async function writeReviewLinkFor(
  buyerId: string,
  businessId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const candidates = await prisma.enquiry.findMany({
    where: {
      buyerId,
      review: null,
      OR: [
        { contactReleasedToBusinessId: businessId },
        { recipients: { some: { businessId, firstReplyAt: { not: null } } } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 5,
    // The gate's own select, so each candidate is judged on the fields `createReview` reads.
    select: { ...ENQUIRY_FOR_REVIEW_SELECT, ref: true },
  });

  for (const candidate of candidates) {
    // The window counts too: a link to a form that has closed is the disabled
    // button the reviews page promises never to show.
    if (canReview(buyerId, toEnquiryForReview(candidate), businessId, now).ok) {
      return `/review/new?${new URLSearchParams({ enq: candidate.ref, about: businessId }).toString()}`;
    }
  }
  return null;
}

function photoUrls(storage: ReviewPhotoStorage, fields: ReviewFields): Record<string, string> {
  return Object.fromEntries(fields.photos.map((photo) => [photo.path, storage.url(photo.path)]));
}

async function supplierById(id: string): Promise<ReviewWriteSupplier> {
  const row = await prisma.business.findUniqueOrThrow({ where: { id }, select: SUPPLIER_SELECT });
  return toSupplier(row);
}

/**
 * What the accepted quote was worth, for the job line under the supplier's name.
 *
 * The buyer's own figure on a page only the buyer sees — the same total the
 * accepted record prints, summed from its lines. A proposal is a fee on a basis
 * and is said as one; there is no total to invent for it.
 */
async function acceptedValue(enquiryId: string, businessId: string): Promise<ReviewWriteEnquiry["value"]> {
  const quote = await prisma.quote.findFirst({
    where: { enquiryId, businessId, status: "accepted" },
    orderBy: [{ acceptedAt: "desc" }, { revision: "desc" }, { id: "asc" }],
    select: {
      lines: { select: { qty: true, unitPrice: true } },
      proposal: { select: PROPOSAL_FIGURE_SELECT },
    },
  });
  if (!quote) return null;
  const proposal = toProposalFigure(quote.proposal);
  if (proposal) return { kind: "proposal", feeAed: proposal.feeAed, feeBasisLabel: proposal.feeBasisLabel };
  if (quote.lines.length === 0) return null;
  return {
    kind: "goods",
    fils: quoteTotalFils(quote.lines.map((line) => ({ qty: line.qty, unitPrice: line.unitPrice.toString() }))),
  };
}

/**
 * Board 10f's *Your other enquiries* — the gate drawn rather than described.
 *
 * Every row states its own verdict from `canReview`, the function the form is
 * gated by, so a row reading *Open until 19 Nov* is a row whose link opens a
 * form. Reviewable ones first (the buyer came here to write a review, and a
 * *Different job?* is looking for one), soonest-closing first; then the rest,
 * newest first. At most `OTHER_ENQUIRIES_SHOWN`, with the count of the rest
 * stated rather than dropped.
 */
async function otherEnquiries(
  buyerId: string,
  excludeId: string | null,
  now: Date,
): Promise<{ rows: OtherEnquiry[]; more: number }> {
  const where = { buyerId, ...(excludeId ? { id: { not: excludeId } } : {}) };
  const [total, rows] = await Promise.all([
    prisma.enquiry.count({ where }),
    prisma.enquiry.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // The panel is about recent work; forty covers any buyer's last several
    // months, and the count of the rest comes from `total`, not from this.
    take: 40,
    select: {
      ...ENQUIRY_FOR_REVIEW_SELECT,
      ref: true,
      requirement: true,
      createdAt: true,
      reviewDraft: { select: { businessId: true } },
      review: { select: { id: true, createdAt: true, business: { select: { displayName: true } } } },
    },
    }),
  ]);

  /*
     The verdicts first, then the names they need. Which supplier a row is about
     is the gate's answer rather than the row's shape: with the buyer's own
     business out of the running, one reply of two can be the whole of it.
  */
  const judged = rows.map((row) => {
    const gate = toEnquiryForReview(row);
    return { row, gate, verdict: canReview(buyerId, gate, undefined, now) };
  });
  const subjectIds = new Set<string>();
  for (const { row, gate, verdict } of judged) {
    if (row.review) continue;
    if ("businessId" in verdict) subjectIds.add(verdict.businessId);
    else if (verdict.reason === "not_yet_open" && gate.contactReleasedToBusinessId) {
      subjectIds.add(gate.contactReleasedToBusinessId);
    }
  }
  const names = new Map(
    (
      await prisma.business.findMany({
        where: { id: { in: [...subjectIds] } },
        select: { id: true, displayName: true },
      })
    ).map((business) => [business.id, business.displayName]),
  );

  const listed: (OtherEnquiry & { sortKey: [number, number] })[] = judged.map(({ row, gate, verdict }) => {
    const base = { id: row.id, ref: row.ref, headline: requirementHeadline(row.requirement) };
    if (row.review) {
      return {
        ...base,
        state: { kind: "reviewed", on: row.review.createdAt, supplierName: row.review.business.displayName },
        sortKey: [1, -row.createdAt.getTime()],
      };
    }
    if (verdict.ok) {
      const window = reviewWindowFor(gate, verdict.businessId);
      return {
        ...base,
        state: {
          kind: "open",
          closesOn: window?.closesOn ?? null,
          supplierName: names.get(verdict.businessId) ?? "",
          draft: row.reviewDraft?.businessId === verdict.businessId,
        },
        sortKey: [0, window?.closesOn.getTime() ?? Number.MAX_SAFE_INTEGER],
      };
    }
    switch (verdict.reason) {
      case "ambiguous_subject":
        return { ...base, state: { kind: "choose", count: reviewableReplies(gate).length }, sortKey: [0, Number.MAX_SAFE_INTEGER] };
      case "window_closed":
        return {
          ...base,
          state: { kind: "closed", closedOn: verdict.window.closesOn, supplierName: names.get(verdict.businessId) ?? "" },
          sortKey: [1, -row.createdAt.getTime()],
        };
      case "not_yet_open":
        return {
          ...base,
          state: {
            kind: "not_yet_open",
            opensOn: verdict.opensOn,
            supplierName: names.get(gate.contactReleasedToBusinessId ?? "") ?? "",
          },
          sortKey: [1, -row.createdAt.getTime()],
        };
      case "own_business":
        return {
          ...base,
          state: { kind: "own_business", supplierName: names.get(verdict.businessId) ?? "" },
          sortKey: [1, -row.createdAt.getTime()],
        };
      default:
        return { ...base, state: { kind: "no_reply" }, sortKey: [1, -row.createdAt.getTime()] };
    }
  });

  listed.sort((a, b) => a.sortKey[0] - b.sortKey[0] || a.sortKey[1] - b.sortKey[1] || a.ref.localeCompare(b.ref));
  return {
    rows: listed.slice(0, OTHER_ENQUIRIES_SHOWN).map((row) => ({ id: row.id, ref: row.ref, headline: row.headline, state: row.state })),
    more: Math.max(0, total - Math.min(listed.length, OTHER_ENQUIRIES_SHOWN)),
  };
}
