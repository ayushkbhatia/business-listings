import "server-only";
import { prisma } from "@/lib/db/client";
import { firstNameOf } from "@/lib/db/queries/seller-visibility";
import { mayReplyToReviews, mayRequestReviews, mayDisputeReviews } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import {
  cardStateOf,
  isRemovalGround,
  provenanceOf,
  replyWindowEnds,
  replyWindowOpen,
  REQUEST_WINDOW_DAYS,
  DIMENSIONS,
  type Dimension,
  type DisputeGround,
  type Provenance,
  type RemovalGround,
  type ReviewCardState,
} from "./eligibility";
import { liveRequestChannels } from "./service";
import { requestChannelFor, type RequestChannel } from "./channel";
import { themesIn, type ThemeFinding } from "./themes";
import type { $Enums } from "@/lib/db/generated/client";

type DisputeOutcome = $Enums.ReviewDisputeOutcome;

/**
 * Board `11c` — everything behind /dashboard/reviews, in one read.
 *
 * The page renders this and computes nothing, for the reason criterion 5 gives:
 * *"every count in the header reconciles with the list beneath it."* The board
 * failed that twice — `Send 8 requests` over two ticked buyers, and 126 reviews
 * of which 94 were accounted for — and both failures are the same shape, a
 * number produced somewhere other than the list it describes.
 *
 * ## The unverified state does not exist, and that is `Q1`'s answer
 *
 * The blocking question was whether a review can exist without an enquiry. The
 * schema answered it before the board asked: `Review.enquiryId` is `NOT NULL`
 * and `UNIQUE` with a foreign key, and `canReview` admits a buyer only on an
 * accepted quote or an enquiry this seller actually replied to. There is no
 * path — no import, no admin form, no API — that produces a review without one.
 * So the board's *"32 unverified"* is a number with no possible source, and the
 * state it implies is not permanent, not transitional, and not reachable.
 *
 * What is real is the two-rung ladder board `1m` already ships and which this
 * page had never shown: `accepted_quote` and `verified_enquiry`. Criterion 3
 * asks that verified and unverified be distinct *in the same words on both
 * surfaces*, and the honest version of that is this ladder, rendered from the
 * same `reviewpage.provenance.*` strings the buyer reads on the storefront.
 *
 * The `no_traceable_enquiry` dispute ground survives all of this and is not
 * redundant: an enquiry existing does not make its sender a customer. A
 * competitor can send a real enquiry, draw a real reply, and review. The
 * enquiry is traceable; the trade is not, and that is what the seller disputes.
 */

export interface AskableBuyer {
  enquiryId: string;
  ref: string;
  buyerName: string;
  acceptedAt: Date;
  /** How the request would go out. Null when we hold no address at all. */
  channel: RequestChannel | null;
}

export interface BoardReview {
  id: string;
  state: ReviewCardState;
  provenance: Provenance;
  overall: number;
  body: string;
  buyerLabel: string;
  createdAt: Date;
  /** The day the reply box closes. Derived from the review, never stored. */
  replyBy: Date;
  /**
   * Whether the reply box is open on this card.
   *
   * One predicate, read by the card, by the `Needs a reply` count and by the
   * service that accepts the reply — because the three disagreeing is exactly
   * how a chip comes to say two while three cards show a box. A review under
   * dispute still needs answering: `Q3` keeps it on the buyer's page unchanged,
   * so a seller who says nothing has said nothing in public for the two working
   * days the decision takes.
   */
  replyOpen: boolean;
  dimensions: { key: Dimension; score: number }[];
  sellerReply: string | null;
  repliedAt: Date | null;
  replyRemoved: boolean;
  /**
   * The removal, split back into the ground and what the moderator wrote.
   *
   * `Review.removalReason` is stored as `"<ground>: <prose>"` — one column,
   * because a list on its own is not an explanation and prose on its own is not
   * reviewable — and rendering it whole under a label reading *Reason:* gave
   * the seller "Reason: abuse: the body carries…". The ground is a term with a
   * name in the catalogue, so it is rendered as one.
   */
  removal: { ground: RemovalGround | null; note: string } | null;
  /**
   * The latest dispute on this review, open or decided.
   *
   * Decided ones stay on the card because §States says a refused dispute leaves
   * "the reason logged and emailed" — and a seller who raised one, waited two
   * working days and came back to a page that looked exactly as it did before
   * has been told nothing. An upheld one is on a review that is now removed, so
   * the removal line carries it instead.
   */
  dispute: {
    ground: DisputeGround;
    outcome: DisputeOutcome | null;
    reason: string | null;
    decidedAt: Date | null;
  } | null;
}

/**
 * `"abuse: the body carries a slur"` back into its two halves.
 *
 * Falls back to the whole string as the note when the prefix is not one of the
 * grounds, which is what every row written before this format existed looks
 * like — and what a hand-edited one would look like too.
 */
function splitRemoval(reason: string | null): BoardReview["removal"] {
  if (reason === null) return null;
  const at = reason.indexOf(": ");
  if (at === -1) return { ground: null, note: reason };
  const head = reason.slice(0, at);
  if (!isRemovalGround(head)) return { ground: null, note: reason };
  return { ground: head, note: reason.slice(at + 2) };
}

export interface DimensionAverage {
  key: Dimension;
  average: number;
  /** True on exactly one row, and only when the scores are not all equal. */
  weakest: boolean;
  themes: ThemeFinding[];
}

/**
 * The chips over the list. Every one carries the count it filters to.
 *
 * Five, and the fifth is what makes criterion 5 true. A removed or held review
 * stays on this page — a supplier who cannot see that one was taken down learns
 * nothing from it — but it is out of the average, out of the header's split and
 * off the public listing, so it cannot be inside a chip called *On your page*
 * without the numbers contradicting each other the way the board's did.
 *
 * So the two partitions are both stated and both add up: on-page splits into
 * accepted quote and confirmed enquiry, and on-page plus off-page is every row
 * the list can show. Nothing is counted twice and nothing goes unaccounted for.
 */
export const REVIEW_TABS = [
  "on_page",
  "accepted_quote",
  "verified_enquiry",
  "needs_reply",
  "off_page",
] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];

export function parseTab(value: string | string[] | undefined): ReviewTab {
  const one = Array.isArray(value) ? value[0] : value;
  return REVIEW_TABS.includes(one as ReviewTab) ? (one as ReviewTab) : "on_page";
}

export interface ReviewsBoard {
  /**
   * The overall score buyers gave, averaged. `Q2`: **answered, not derived.**
   *
   * `Review.overall` is its own column and board 10f's form asks for it as its
   * own question — the board implied the header was the mean of the dimensions
   * and printed 4.8 over three that average 4.67. It is neither the mean nor
   * close to it, and the page says which it is.
   */
  average: number | null;
  total: number;
  /** The header's own reconciliation. These two sum to `total`. */
  fromAcceptedQuote: number;
  fromConfirmedEnquiry: number;
  needingReply: number;
  reviews: BoardReview[];
  tab: ReviewTab;
  counts: Record<ReviewTab, number>;
  dimensions: DimensionAverage[];
  askable: AskableBuyer[];
  /** Eligible buyers we can actually reach. The button counts a subset of this. */
  reachable: number;
  /**
   * Whether this business has ever had a quote accepted.
   *
   * The difference between the two empty states §States separates: a seller
   * with accepted quotes and nobody left to ask is told the list is exhausted;
   * a seller with none is told why the panel is empty and sent to `3k`, rather
   * than shown a dead button.
   */
  hasAcceptedQuotes: boolean;
  may: { reply: boolean; request: boolean; dispute: boolean };
}

export async function reviewsBoard(
  actor: Actor,
  businessId: string,
  tab: ReviewTab = "on_page",
  now = new Date(),
): Promise<ReviewsBoard> {
  const windowStart = new Date(now.getTime() - REQUEST_WINDOW_DAYS * 86_400_000);

  const [rows, eligible, asked, acceptedEver, channels, openDisputes] = await Promise.all([
    prisma.review.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        overall: true,
        quotedAccurate: true,
        onTime: true,
        asDescribed: true,
        responsiveness: true,
        body: true,
        showCompanyName: true,
        sellerReply: true,
        sellerRepliedAt: true,
        replyRemovedAt: true,
        removedAt: true,
        removalReason: true,
        heldAt: true,
        createdAt: true,
        businessId: true,
        enquiry: { select: { contactReleasedToBusinessId: true } },
        buyer: { select: { fullName: true, buyerCompany: { select: { name: true } } } },
      },
    }),
    // Accepted inside the window, and nobody has written one yet.
    prisma.enquiry.findMany({
      where: {
        contactReleasedToBusinessId: businessId,
        contactReleasedAt: { gte: windowStart },
        review: null,
      },
      orderBy: { contactReleasedAt: "desc" },
      select: {
        id: true,
        ref: true,
        buyerId: true,
        contactReleasedAt: true,
        buyer: { select: { fullName: true, phone: true, email: true } },
      },
    }),
    prisma.reviewRequest.findMany({ where: { businessId }, select: { buyerId: true } }),
    /*
       Has a quote from this seller ever been accepted, at any date?

       Separate from the windowed read above and not derivable from it: a seller
       whose only accepted quote was four months ago has an empty eligible list
       and is not the seller who has never sold anything, and §States sends the
       two to different places.
    */
    prisma.enquiry.findFirst({
      where: { contactReleasedToBusinessId: businessId },
      select: { id: true },
    }),
    liveRequestChannels(),
    /*
       Every dispute this business has raised, newest first per review.

       Not only the open ones: a refused dispute is a decision the seller is
       owed on the card as well as in the email, and reading them all here costs
       one query rather than two.
    */
    prisma.reviewDispute.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      select: {
        reviewId: true,
        ground: true,
        outcome: true,
        outcomeReason: true,
        resolvedAt: true,
      },
    }),
  ]);

  const disputeByReview = new Map<string, BoardReview["dispute"]>();
  for (const row of openDisputes) {
    // Newest first, so the first one seen per review is the one that counts.
    if (disputeByReview.has(row.reviewId)) continue;
    disputeByReview.set(row.reviewId, {
      ground: row.ground,
      outcome: row.outcome,
      reason: row.outcomeReason,
      decidedAt: row.resolvedAt,
    });
  }

  /*
     Removed and held are out of every figure on this page.

     The same `PUBLISHED` condition board 1m applies to the storefront, and it
     has to be the same one: a dashboard average that counted a held review
     would show the seller a number their own public page disagrees with, which
     is the shared-record failure with one surface moved.
  */
  const visible = rows.filter((row) => row.removedAt === null && row.heldAt === null);

  const average =
    visible.length === 0
      ? null
      : Math.round((visible.reduce((sum, row) => sum + row.overall, 0) / visible.length) * 10) / 10;

  const reviews: BoardReview[] = rows.map((row) => ({
    id: row.id,
    state: cardStateOf(
      { ...row, hasOpenDispute: disputeByReview.get(row.id)?.outcome === null },
      now,
    ),
    provenance: provenanceOf(row),
    overall: row.overall,
    body: row.body,
    // The buyer's own choice about their name. Off means the person rather than
    // the company — never their phone, never their email. The provenance badge
    // is a separate thing and is not the buyer's to switch off.
    buyerLabel: row.showCompanyName
      ? (row.buyer.buyerCompany?.name ?? firstNameOf(row.buyer.fullName))
      : firstNameOf(row.buyer.fullName),
    createdAt: row.createdAt,
    replyBy: replyWindowEnds(row.createdAt),
    replyOpen: replyWindowOpen(row, now),
    dimensions: DIMENSIONS.map((key) => ({ key, score: row[key] })),
    sellerReply: row.sellerReply,
    repliedAt: row.sellerRepliedAt,
    replyRemoved: row.replyRemovedAt !== null,
    removal: splitRemoval(row.removalReason),
    dispute: disputeByReview.get(row.id) ?? null,
  }));

  const onPage = (review: BoardReview) =>
    review.state !== "removed" && review.state !== "held";

  const counts: Record<ReviewTab, number> = {
    on_page: reviews.filter(onPage).length,
    accepted_quote: reviews.filter((r) => onPage(r) && r.provenance === "accepted_quote").length,
    verified_enquiry: reviews.filter((r) => onPage(r) && r.provenance === "verified_enquiry").length,
    needs_reply: reviews.filter((review) => review.replyOpen).length,
    off_page: reviews.filter((review) => !onPage(review)).length,
  };

  const shown = reviews.filter((review) => {
    if (tab === "off_page") return !onPage(review);
    if (!onPage(review)) return false;
    if (tab === "on_page") return true;
    if (tab === "needs_reply") return review.replyOpen;
    return review.provenance === tab;
  });

  /*
     The dimension averages, over the same visible set as the headline.

     Recomputed, never stored — the data-requirements table says so, and a
     stored average is a number that drifts from the rows it claims to describe
     the first time one is held.
  */
  const dimensionAverages = DIMENSIONS.map((key) => ({
    key,
    average:
      visible.length === 0
        ? 0
        : Math.round((visible.reduce((sum, row) => sum + row[key], 0) / visible.length) * 10) / 10,
  }));

  /*
     Read off the **rounded** figures, so the word always agrees with the number
     printed beside it. Comparing the raw means would let 4.06 wear the label
     while 4.14 sits next to it reading the same 4.1.
  */
  const lowest = Math.min(...dimensionAverages.map((row) => row.average));
  const highest = Math.max(...dimensionAverages.map((row) => row.average));
  const themes = themesIn(visible.map((row) => ({ id: row.id, body: row.body })));

  const dimensions: DimensionAverage[] = dimensionAverages.map((row) => ({
    ...row,
    /*
       Criterion 4: no state carried by colour alone.

       The board flagged "As described" as weakest with an amber bar and an
       amber figure and no words. This is the word, and it is withheld when
       every dimension scores the same — a "weakest" on four equal numbers is a
       label picked by sort order rather than by the data.
    */
    weakest: visible.length > 0 && lowest < highest && row.average === lowest,
    themes: themes.filter((theme) => theme.dimension === row.key),
  }));

  const askedIds = new Set(asked.map((row) => row.buyerId));
  const askable: AskableBuyer[] = eligible.flatMap((enquiry) => {
    if (askedIds.has(enquiry.buyerId)) return [];
    // Non-null by the `gte` in the query above; narrowed rather than asserted,
    // so a future change to that filter fails here instead of at render.
    const acceptedAt = enquiry.contactReleasedAt;
    if (acceptedAt === null) return [];
    return [
      {
        enquiryId: enquiry.id,
        ref: enquiry.ref,
        buyerName: firstNameOf(enquiry.buyer.fullName),
        acceptedAt,
        channel: requestChannelFor(enquiry.buyer, channels),
      },
    ];
  });

  return {
    average,
    total: visible.length,
    fromAcceptedQuote: visible.filter((row) => provenanceOf(row) === "accepted_quote").length,
    fromConfirmedEnquiry: visible.filter((row) => provenanceOf(row) === "verified_enquiry").length,
    needingReply: counts.needs_reply,
    reviews: shown,
    tab,
    counts,
    dimensions,
    askable,
    reachable: askable.filter((buyer) => buyer.channel !== null).length,
    hasAcceptedQuotes: acceptedEver !== null,
    may: {
      reply: mayReplyToReviews(actor),
      request: mayRequestReviews(actor),
      dispute: mayDisputeReviews(actor),
    },
  };
}
