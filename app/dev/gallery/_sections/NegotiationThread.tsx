import { buildNegotiationView } from "@/app/(public)/enquiry/[id]/thread/[seller]/_build";
import { NegotiationLayout } from "@/app/(public)/enquiry/[id]/thread/[seller]/_view";
import { BuyerNegotiation } from "@/app/(public)/enquiry/[id]/thread/[seller]/NegotiationClient";
import type { Negotiation } from "@/lib/messaging/negotiation-server";
import { Section, States } from "../_kit";
import {
  NEGOTIATION_NOW,
  acceptedElsewhereNegotiation,
  acceptedHereNegotiation,
  boardNegotiation,
  closedNegotiation,
  expiredNegotiation,
  noReplyNegotiation,
  notPermittedNegotiation,
  partialNegotiation,
  thirdRevisionNegotiation,
} from "./negotiation-fixture";

/**
 * Board `10h` — the negotiation thread, in the eight states its spec documents,
 * and the account build plan 9.4 refuses an accept to.
 *
 * Every specimen is rows run through `buildNegotiationView`, the page's own path,
 * with one fixed clock: r2 is twelve minutes old on every visit. Nothing here
 * writes — the composer and the accept are drawn with `live` off, so a press in
 * the gallery sends nothing and accepts nothing.
 */
function Specimen({
  negotiation,
  name,
  acceptError = null,
  mayAccept = true,
}: {
  negotiation: Negotiation;
  name: string;
  acceptError?: string | null;
  mayAccept?: boolean;
}) {
  const view = buildNegotiationView(negotiation, { now: NEGOTIATION_NOW, token: null, acceptError, mayAccept });
  return (
    <div className="w-full">
      <NegotiationLayout {...view.layout} headingAs="h3" frame="specimen">
        <BuyerNegotiation {...view.thread} live={false} specimen={name} />
      </NegotiationLayout>
    </div>
  );
}

export function NegotiationThreadGallery() {
  return (
    <Section id="negotiation-thread" title="Negotiation thread" note="board 10h · /enquiry/:id/thread/:seller">
      <States label="as drawn · r2 twelve minutes old, accept at 14,600" stack>
        <Specimen negotiation={boardNegotiation()} name="as drawn" />
      </States>
      <States label="no reply from a seller" stack>
        <Specimen negotiation={noReplyNegotiation()} name="no reply" />
      </States>
      <States label="seller declines a line" stack>
        <Specimen negotiation={partialNegotiation()} name="partial" />
      </States>
      <States label="multiple revisions · r3 with files" stack>
        <Specimen negotiation={thirdRevisionNegotiation()} name="r3" />
      </States>
      <States label="quote expired mid-thread" stack>
        <Specimen negotiation={expiredNegotiation()} name="expired" />
      </States>
      <States label="enquiry accepted elsewhere" stack>
        <Specimen negotiation={acceptedElsewhereNegotiation()} name="accepted elsewhere" />
      </States>
      <States label="enquiry expired unactioned" stack>
        <Specimen negotiation={closedNegotiation()} name="closed" />
      </States>
      <States label="accepted here" stack>
        <Specimen negotiation={acceptedHereNegotiation()} name="accepted here" />
      </States>
      <States label="account cannot accept quotes · staff role, no buyer role (build plan 9.4)" stack>
        <Specimen negotiation={notPermittedNegotiation()} name="not permitted" mayAccept={false} />
      </States>
    </Section>
  );
}
