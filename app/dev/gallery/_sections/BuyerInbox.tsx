import {
  EnquiryTable,
  FirstEnquiry,
  HistoryCard,
  NeedsYouCard,
  SavedPanel,
} from "@/app/(public)/account/enquiries/_inbox";
import { inboxRow, needsYou, type InboxFacts, type InboxRow } from "@/lib/enquiry/inbox-status";
import type { SavedSearchView } from "@/lib/saved-search/service";
import { Section, States } from "../_kit";

/**
 * Board `10e` — the buyer's inbox, every verb the gap between SENT TO and
 * QUOTED can produce, the rail's two cards and their absence, and the saved
 * searches panel in its three row states.
 *
 * One fixed clock, so a specimen reads the same on every visit. The rows go
 * through `inboxRow` and the cards through `needsYou` — the functions the page
 * uses — so a specimen cannot show a verb the derivation would not pick.
 */

const NOW = new Date("2026-09-14T08:00:00.000Z");
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms);

function row(
  id: string,
  requirement: string,
  facts: Partial<InboxFacts> & Pick<InboxFacts, "closesAt" | "sentTo">,
  meta: { lineCount?: number; place?: string | null; isBrief?: boolean } = {},
): InboxRow {
  return inboxRow(
    {
      id,
      ref: `ENQ-${id}`,
      requirement,
      lineCount: meta.lineCount ?? 1,
      place: meta.place === undefined ? "Al Quoz Industrial 3" : meta.place,
      isBrief: meta.isBrief ?? false,
    },
    {
      createdAt: at(-2 * DAY),
      quoted: 0,
      anyQuoteRead: false,
      accepted: false,
      nudgeable: 0,
      unanswered: facts.sentTo - (facts.quoted ?? 0),
      allDeclined: false,
      resentAsRef: null,
      ...facts,
    },
    NOW,
  );
}

const ROWS: InboxRow[] = [
  row("9411", "Butterfly valves DN200, flanged PN16, for a pump room upgrade", { closesAt: at(2 * DAY), sentTo: 3, quoted: 2 }),
  row("9410", "Monthly AMC for 14 split units across three retail units", { closesAt: at(12 * DAY), sentTo: 8, quoted: 4 }, { lineCount: 0, isBrief: true }),
  row("9409", "Isolation valves for a chilled water riser", { closesAt: at(3 * HOUR), sentTo: 5, nudgeable: 5 }, { lineCount: 3 }),
  row("9408", "Cold room repair at a retail unit in Al Furjan", { closesAt: at(5 * DAY), sentTo: 1 }, { place: "Al Furjan" }),
  row("9407", "AMC for four chillers in Business Bay", { closesAt: at(4 * DAY), sentTo: 1, quoted: 1 }, { place: "Business Bay" }),
  row("9406", "Resilient seated gate valves for a chilled water line", { closesAt: at(-DAY), sentTo: 3, quoted: 2, accepted: true, anyQuoteRead: true }),
  row("9405", "Cable tray and accessories for a fit-out in Deira", { closesAt: at(6 * DAY), sentTo: 2, allDeclined: true }, { place: "Deira" }),
  row("9404", "4-core 95mm² XLPE armoured cable, 400 m, plus glands and lugs", { closesAt: at(-3 * DAY), sentTo: 7, quoted: 3 }),
  row("9403", "Ducting for a fit-out in Deira", { closesAt: at(-5 * DAY), sentTo: 4, resentAsRef: "ENQ-9412" }),
];

const SEARCHES: SavedSearchView[] = [
  {
    id: "gallery-saved-new",
    name: "Gate valves in Al Quoz",
    href: "/c/valves-and-fittings",
    cadence: "weekly",
    zeroResult: false,
    stillEmpty: false,
    newCount: 4,
    countingFrom: at(-6 * DAY),
    createdAt: at(-40 * DAY),
  },
  {
    id: "gallery-saved-quiet",
    name: "Butterfly valve",
    href: "/search?q=butterfly+valve",
    cadence: "daily",
    zeroResult: false,
    stillEmpty: false,
    newCount: 0,
    countingFrom: at(-DAY),
    createdAt: at(-12 * DAY),
  },
  {
    id: "gallery-saved-zero",
    name: "Hydrogen electrolyser",
    href: "/search?q=hydrogen+electrolyser",
    cadence: "when_listed",
    zeroResult: true,
    stillEmpty: true,
    newCount: 0,
    countingFrom: at(-3 * DAY),
    createdAt: at(-3 * DAY),
  },
];

export function BuyerInboxGallery() {
  const quiet = ROWS.filter((r) => r.bucket === "accepted" || r.bucket === "expired");
  return (
    <Section
      id="buyer-inbox"
      title="Buyer inbox"
      note="Board 10e. The verb is the gap between SENT TO and QUOTED; NEEDS YOU picks at most two and is absent when nothing costs; closes reads in days, never 5 d 22 h."
    >
      <States label="Table · every verb" stack>
        <div className="w-full">
          <EnquiryTable rows={ROWS} now={NOW} bucket={null} />
        </div>
      </States>
      <States label="Table · filtered to zero" stack>
        <div className="w-full">
          <EnquiryTable rows={[]} now={NOW} bucket="accepted" />
        </div>
      </States>
      <States label="First visit · nothing sent" stack>
        <div className="w-full max-w-2xl">
          <FirstEnquiry />
        </div>
      </States>

      <States label="Needs you · compare + nudge" stack>
        <div className="w-80">
          <NeedsYouCard cards={needsYou(ROWS, NOW)} now={NOW} />
        </div>
      </States>
      <States label="Needs you · nothing costs" stack>
        {/* Renders nothing, by design: the history card moves up. */}
        <div className="w-80">
          <NeedsYouCard cards={needsYou(quiet, NOW)} now={NOW} />
          <HistoryCard
            history={{ sent: 15, medianFirstQuoteMs: 40 * 60_000, answered: 9, accepted: 2, repeatSuppliers: 1 }}
            since={new Date("2026-01-01T00:00:00+04:00")}
          />
        </div>
      </States>
      <States label="History · none answered" stack>
        <div className="w-80">
          <HistoryCard
            history={{ sent: 2, medianFirstQuoteMs: null, answered: 0, accepted: 0, repeatSuppliers: 0 }}
            since={new Date("2026-01-01T00:00:00+04:00")}
          />
        </div>
      </States>

      <States label="Saved · new, quiet, zero-result; view all" stack>
        <div className="w-full max-w-3xl">
          <SavedPanel saved={SEARCHES} total={4} />
        </div>
      </States>
      <States label="Saved · none yet" stack>
        <div className="w-full max-w-3xl">
          <SavedPanel saved={[]} total={0} />
        </div>
      </States>
    </Section>
  );
}
