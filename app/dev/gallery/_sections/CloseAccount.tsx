import {
  ClosureActions,
  ClosureBlockersPanel,
  ClosureConsequences,
  ClosurePaths,
  ClosureRail,
} from "@/app/(dashboard)/dashboard/account/close/_panels";
import type { ClosureBlockers } from "@/lib/closure/blockers";
import { consequenceRows, notOursToDelete } from "@/lib/closure/consequences";
import { Section, States } from "../_kit";

/**
 * Board `11i` — close account, in every state the screen has.
 *
 * Synthetic facts rather than a query, so every state renders on an empty
 * database. The blockers are the ones worth seeing side by side: the heading
 * must count what is there, and a single blocker under "Two things to clear
 * first" is the defect this section exists to catch.
 */

const DAY = 86_400_000;
const NOW = new Date("2026-09-14T08:00:00Z");

const BOTH: ClosureBlockers = {
  subscription: { planName: "Pro", renewsAt: new Date("2026-10-13T00:00:00Z"), pastDue: false },
  enquiries: {
    openEnquiries: 3,
    awaitingQuotes: 1,
    firstQuote: {
      ref: "QT-8841-R2",
      buyer: { released: false, firstName: "Rashid" },
      expiresAt: new Date(NOW.getTime() + 8 * DAY),
    },
  },
  clear: false,
};

const QUOTES_ONLY: ClosureBlockers = {
  subscription: null,
  enquiries: { openEnquiries: 0, awaitingQuotes: 2, firstQuote: BOTH.enquiries!.firstQuote },
  clear: false,
};

const PAST_DUE: ClosureBlockers = {
  subscription: { planName: "Basic", renewsAt: NOW, pastDue: true },
  enquiries: null,
  clear: false,
};

const CLEAR: ClosureBlockers = { subscription: null, enquiries: null, clear: true };

export function CloseAccountGallery() {
  const rows = consequenceRows({ seats: 3, subdomain: "alwaha.businesslistings.me", slug: "al-waha-industrial-supplies" });
  const solo = consequenceRows({ seats: 1, subdomain: null, slug: "al-waha-industrial-supplies" });
  const { notOurs, kept } = notOursToDelete(rows);
  const finalAt = new Date(NOW.getTime() + 14 * DAY);

  return (
    <Section
      id="close-account"
      title="Close account"
      note="Board 11i. Cancelling is not closing; two blockers must clear, the table splits into what leaves and what is kept, and the primary action is disabled while anything stands."
    >
      <States label="Paths · paid" stack>
        <ClosurePaths plan={{ kind: "paid", planName: "Pro" }} />
      </States>
      <States label="Paths · cancelling" stack>
        <ClosurePaths plan={{ kind: "cancelling", planName: "Pro", endsOn: new Date("2026-10-13T00:00:00Z") }} />
      </States>
      <States label="Paths · Free" stack>
        <ClosurePaths plan={{ kind: "free" }} />
      </States>

      <States label="Blocked · both" stack>
        <ClosureBlockersPanel blockers={BOTH} />
      </States>
      <States label="Blocked · quotes" stack>
        <ClosureBlockersPanel blockers={QUOTES_ONLY} />
      </States>
      <States label="Blocked · past due" stack>
        <ClosureBlockersPanel blockers={PAST_DUE} />
      </States>
      {/* A clear page has no blocker panel at all, so this row is empty on purpose. */}
      <States label="Clear · no panel" stack>
        <ClosureBlockersPanel blockers={CLEAR} />
      </States>

      <States label="Table · team of 3" stack>
        <ClosureConsequences rows={rows} />
      </States>
      <States label="Table · owner alone" stack>
        <ClosureConsequences rows={solo} />
      </States>

      <States label="Rail · blocked" stack>
        <div className="flex w-[21.5rem] flex-col gap-3.5">
          <ClosureRail previewFinalAt={finalAt} notOurs={notOurs} kept={kept} />
          <ClosureActions blockers={BOTH} />
        </div>
      </States>
      <States label="Actions · clear" stack>
        <div className="w-[21.5rem]">
          <ClosureActions blockers={CLEAR} />
        </div>
      </States>
    </Section>
  );
}
