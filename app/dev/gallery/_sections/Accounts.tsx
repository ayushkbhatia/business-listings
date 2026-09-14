import { AccountsTable } from "@/app/(admin)/admin/businesses/AccountsTable";
import { toTableRow } from "@/app/(admin)/admin/businesses/present";
import type { AccountRow } from "@/lib/accounts/list";
import { Section, States } from "../_kit";

/**
 * Board `4f` — the accounts table, in every health state the board names.
 *
 * Synthetic rows run through the same `toTableRow` the page uses, so a label, a
 * dash or a percentage that reads wrong here reads wrong on the console too.
 * No titled panel wraps anything: a titled panel is a landmark, and the gallery
 * would render each one twice.
 */

const AT = new Date("2026-09-09T10:00:00Z");

function row(over: Partial<AccountRow> & Pick<AccountRow, "id" | "displayName" | "state">): AccountRow {
  return {
    slug: over.id,
    licenceNumber: "DED-618402",
    areaName: "Jebel Ali Free Zone",
    emirate: "dubai",
    claimedSince: new Date("2026-02-10T00:00:00Z"),
    planId: "pro",
    paying: true,
    tier: 2,
    sellsKind: "goods",
    liveProducts: 1204,
    liveServices: 0,
    replyRate: 0.96,
    replySample: 48,
    medianMs: 54 * 60_000,
    quoted: { goodsAed: "214380", quotes: 31, proposals: 0 },
    upgradeSignal: null,
    ...over,
  };
}

const ROWS: AccountRow[] = [
  row({ id: "g-healthy", displayName: "Al Waha Industrial Supplies LLC", state: "healthy" }),
  row({
    id: "g-slow",
    displayName: "Dana Printing & Signage",
    state: "slow_replies",
    licenceNumber: "ADDED-551740",
    areaName: "Mussafah M-14",
    replyRate: 0.62,
    medianMs: 200 * 60_000,
    liveProducts: 96,
    quoted: { goodsAed: "12400", quotes: 4, proposals: 0 },
  }),
  row({
    id: "g-risk",
    displayName: "Technopump Trading LLC",
    state: "churn_risk",
    licenceNumber: "DED-330218",
    areaName: "DIP 2",
    planId: "basic",
    replyRate: 0.34,
    medianMs: 580 * 60_000,
    liveProducts: 204,
    quoted: { goodsAed: "0", quotes: 0, proposals: 0 },
  }),
  row({
    id: "g-upgrade",
    displayName: "Sharjah Steel Fabricators",
    state: "upgrade_candidate",
    licenceNumber: "SHJ-118420",
    areaName: "Industrial Area 15",
    planId: "basic",
    replyRate: 0.71,
    medianMs: 360 * 60_000,
    liveProducts: 92,
    quoted: { goodsAed: "28900", quotes: 6, proposals: 0 },
    upgradeSignal: { kind: "product_cap", at: AT },
  }),
  row({
    id: "g-services",
    displayName: "Meridian Chartered Accountants",
    state: "unmeasured",
    sellsKind: "services",
    liveProducts: 0,
    liveServices: 6,
    replyRate: null,
    replySample: null,
    medianMs: null,
    quoted: { goodsAed: "0", quotes: 0, proposals: 2 },
  }),
  row({ id: "g-closing", displayName: "Gulf Line Trading", state: "closing", replyRate: 0.8 }),
  row({ id: "g-suspended", displayName: "Jebel Rock Trading", state: "suspended", replyRate: null, medianMs: null }),
  row({
    id: "g-unclaimed",
    displayName: "Deira Bearing House",
    state: "unclaimed",
    licenceNumber: "DED-118904",
    areaName: "Deira",
    claimedSince: null,
    planId: null,
    paying: false,
    tier: null,
    liveProducts: 0,
    replyRate: null,
    replySample: null,
    medianMs: null,
    quoted: { goodsAed: "0", quotes: 0, proposals: 0 },
  }),
];

export function AccountsGallery() {
  return (
    <Section
      id="accounts"
      title="Businesses & accounts"
      note="Board 4f. Health derived from measured reply rate; an unclaimed listing has no plan and no tier; services read as services."
    >
      <States label="Table · every state" stack>
        <AccountsTable rows={ROWS.map(toTableRow)} caption="Accounts, gallery specimen" filtered={false} />
      </States>
      <States label="Table · filtered to zero" stack>
        <AccountsTable rows={[]} caption="Accounts filtered to zero, gallery specimen" filtered />
      </States>
      <States label="Table · empty directory" stack>
        <AccountsTable rows={[]} caption="Empty directory, gallery specimen" filtered={false} />
      </States>
    </Section>
  );
}
