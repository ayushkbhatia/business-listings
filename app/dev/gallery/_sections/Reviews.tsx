"use client";

import { RequestPanel } from "@/app/(dashboard)/dashboard/reviews/RequestPanel";
import { ReviewCard, type SellerReviewView } from "@/app/(dashboard)/dashboard/reviews/ReviewCard";
import { t } from "@/lib/i18n";
import { Section, States } from "../_kit";

/**
 * Board 11c — the seller's side of a review, in the six states a row can be in.
 *
 * The board drew three: awaiting a reply, replied, and an unverified one that
 * cannot exist. `removed` and `held` were both reachable before this board and
 * neither was drawn; `window_closed` is `Q6` arriving and `under_dispute` is
 * `B5`'s. Three states nobody had looked at is exactly what a gallery is for.
 *
 * ## Why the actions are stubs
 *
 * Every control here is wired to a promise that resolves to a refusal. The
 * components take their actions as props for this reason — a card that reached
 * for its own server action could only be rendered on the page that owns it,
 * and the states that most need looking at are the ones hardest to produce
 * there. Clicking Post reply in the gallery is meant to do nothing.
 */

const REFUSED = async () => ({ ok: false as const, error: t("dev.no_seat_title") });
const NO_REQUESTS = async () => ({ ok: false as const, error: t("dev.no_seat_title") });

const DIMENSIONS = [
  { label: t("reviews.dimension.quotedAccurate"), score: 5 },
  { label: t("reviews.dimension.onTime"), score: 3 },
  { label: t("reviews.dimension.asDescribed"), score: 4 },
  { label: t("reviews.dimension.responsiveness"), score: 4 },
];

const BASE: SellerReviewView = {
  id: "rev_gallery",
  state: "awaiting_reply",
  provenanceLabel: t("reviewpage.provenance.accepted_quote"),
  provenanceTone: "ok",
  overall: 4,
  body: "Good stock depth and the trade counter is quick. One line was substituted with an equivalent brand without asking us first — flagged it and they credited the difference, but worth confirming brands on the PO.",
  buyerLabel: "Emrill Contracting",
  at: "28 Aug 2026",
  replyBy: "25 Sep 2026",
  replyOpen: true,
  dimensions: DIMENSIONS,
  sellerReply: null,
  repliedAt: null,
  replyRemoved: false,
  removalGround: null,
  removalNote: null,
  dispute: null,
};

function card(id: string, over: Partial<SellerReviewView>): SellerReviewView {
  return { ...BASE, id, ...over };
}

export function Reviews() {
  return (
    <Section
      id="seller-review-card"
      title="Seller review card"
      note="board 11c · six states, and the request panel whose button counts the selection"
    >
      {/*
         The two rungs a review can actually sit on, in the same words the buyer
         reads on the storefront. Criterion 3 asks for one vocabulary across
         both surfaces — the board's "No enquiry on record" third state names
         something the schema cannot produce, because `Review.enquiryId` is not
         nullable.
      */}
      <States label="awaiting a reply · accepted quote and confirmed enquiry" stack>
        <ReviewCard
          review={card("a", {})}
          mayReply
          mayDispute
          postReply={REFUSED}
          raiseDispute={REFUSED}
        />
        <ReviewCard
          review={card("b", {
            provenanceLabel: t("reviewpage.provenance.verified_enquiry"),
            provenanceTone: "neutral",
            overall: 3,
            buyerLabel: "S. Kuriakose",
            body: "Counter staff were helpful but the DN80 I was told was in stock was not, and I lost half a day.",
          })}
          mayReply
          mayDispute
          postReply={REFUSED}
          raiseDispute={REFUSED}
        />
      </States>

      <States label="replied · one reply, and it cannot be edited" stack>
        <ReviewCard
          review={card("c", {
            state: "replied",
            replyOpen: false,
            sellerReply:
              "Fair point on the substitution — we have changed the picking process so any brand swap is confirmed before dispatch.",
            repliedAt: "29 Aug 2026",
          })}
          mayReply
          mayDispute
          postReply={REFUSED}
          raiseDispute={REFUSED}
        />
      </States>

      {/*
         `Q6`, and the board's own expired countdown. Closing is a state and not
         a deletion: the review stays exactly where it was and the page says so.
      */}
      <States label="reply window closed" stack>
        <ReviewCard
          review={card("d", { state: "window_closed", replyOpen: false, replyBy: "5 Sep 2026" })}
          mayReply
          mayDispute
          postReply={REFUSED}
          raiseDispute={REFUSED}
        />
      </States>

      {/*
         `Q3`: the buyer sees this unchanged while we decide. Hiding it during a
         dispute would make disputing a way to take a review down for two days
         at a time.
      */}
      <States label="under dispute · buyers still see it" stack>
        <ReviewCard
          review={card("e", {
            state: "under_dispute",
            dispute: {
              groundLabel: t("reviews.dispute.ground.no_traceable_enquiry"),
              outcomeLabel: null,
              reason: null,
              decidedAt: null,
            },
          })}
          mayReply
          mayDispute
          postReply={REFUSED}
          raiseDispute={REFUSED}
        />
      </States>

      {/*
         And the decision, which the board never drew. §States says a refused
         dispute leaves "the reason logged and emailed" — a seller who raised
         one, waited the two working days and came back to an unchanged page has
         been told nothing.
      */}
      <States label="dispute refused · the review stands, with the reason" stack>
        <ReviewCard
          review={card("i", {
            state: "awaiting_reply",
            dispute: {
              groundLabel: t("reviews.dispute.ground.no_traceable_enquiry"),
              outcomeLabel: t("reviews.dispute.outcome.refused"),
              reason:
                "The enquiry thread shows a quote from this supplier accepted on 17 Aug and contact released the same day. The reviewer is the buyer on that enquiry.",
              decidedAt: "2 Sep 2026",
            },
          })}
          mayReply
          mayDispute
          postReply={REFUSED}
          raiseDispute={REFUSED}
        />
      </States>

      {/*
         `B4`. The text stays as the record of what was said, every reader hides
         it, and there is no second reply — a seller who abused the one they had
         does not get another box.
      */}
      <States label="the supplier's reply was removed" stack>
        <ReviewCard
          review={card("f", {
            state: "replied",
            replyOpen: false,
            sellerReply: "A reply that broke the rules.",
            repliedAt: "29 Aug 2026",
            replyRemoved: true,
          })}
          mayReply
          mayDispute
          postReply={REFUSED}
          raiseDispute={REFUSED}
        />
      </States>

      <States label="off your page · removed, and held" stack>
        <ReviewCard
          review={card("g", {
            state: "removed",
            replyOpen: false,
            removalGround: t("moderation.ground.provably_false"),
            removalNote:
              "names a delivery date the enquiry thread shows was never quoted, and the reviewer withdrew the claim on being asked.",
          })}
          mayReply
          mayDispute
          postReply={REFUSED}
          raiseDispute={REFUSED}
        />
        <ReviewCard
          review={card("h", { state: "held", replyOpen: false })}
          mayReply
          mayDispute
          postReply={REFUSED}
          raiseDispute={REFUSED}
        />
      </States>

      {/*
         Criterion 1: the button's count is the selection and there is no other
         number. Nothing starts ticked — eight buyers pre-selected is eight
         messages one click away, under a rule that says one request per buyer
         ever.
      */}
      <States label="the request panel · nothing pre-selected" stack>
        <RequestPanel
          reachable={2}
          sendRequests={NO_REQUESTS}
          buyers={[
            {
              enquiryId: "e1",
              ref: "ENQ-7801",
              buyerName: "Nadia",
              acceptedAt: "29 Aug 2026",
              channel: "whatsapp",
            },
            {
              enquiryId: "e2",
              ref: "ENQ-7802",
              buyerName: "Tarek",
              acceptedAt: "17 Aug 2026",
              channel: "email",
            },
            {
              enquiryId: "e3",
              ref: "ENQ-7803",
              buyerName: "Leila",
              acceptedAt: "5 Aug 2026",
              channel: null,
            },
          ]}
        />
      </States>
    </Section>
  );
}
