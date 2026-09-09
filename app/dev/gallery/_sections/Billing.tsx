import { Alert, StatusBadge } from "@/components/display";
import { Card } from "@/components/structure";
import { planGrid, type GridRow, type Usage } from "@/lib/billing/plan-grid";
import { consequenceTable, type CancelFacts } from "@/lib/billing/cancel-table";
import { formatDate } from "@/lib/format";
import type { TaxInvoiceDocument } from "@/lib/billing/tax-invoice";
import type { PlanCaps } from "@/lib/plan/entitlements";
import { t } from "@/lib/i18n";
import { InvoiceSheet } from "@/app/(dashboard)/dashboard/billing/invoice/[id]/InvoiceSheet";
import { ConsequenceTable } from "@/app/(dashboard)/dashboard/billing/cancel/ConsequenceTable";
import { CancelCard } from "@/app/(dashboard)/dashboard/billing/CancelCard";
import { Button } from "@/components/primitives";
import { Frame, Section, States } from "../_kit";

/**
 * Board 11f's comparison grid, in every state it has.
 *
 * The grid is where criterion 4 either holds or does not — *"every cell states
 * what that plan keeps out of what the seller has now; one denominator per
 * row"* — and it is the thing that would regress silently, because a wrong cell
 * still looks like a cell. Three usages against one ladder covers it: a seller
 * over the cap, a seller under it, and one with nothing yet.
 *
 * Synthetic plans rather than a query, so the gallery renders identically on an
 * empty database and the states are the point rather than the data.
 */

function plan(over: Partial<PlanCaps>): PlanCaps {
  return {
    id: "basic",
    name: "Basic",
    monthlyPriceAed: 349,
    enquiriesPerMonth: 40,
    productLimit: 150,
    locationLimit: 3,
    photoLimit: 40,
    publicPhotoLimit: null,
    categoryLimit: 3,
    storageMb: 5 * 1024,
    teamSeats: 3,
    rankingMultiplier: 1.15,
    customDomain: false,
    analytics: true,
    csvImport: true,
    sponsoredEligible: false,
    sortOrder: 1,
    ...over,
  };
}

const LADDER: PlanCaps[] = [
  plan({
    id: "free",
    name: "Free",
    monthlyPriceAed: 0,
    enquiriesPerMonth: 3,
    productLimit: 10,
    locationLimit: 1,
    teamSeats: 1,
    storageMb: 50,
    analytics: false,
    csvImport: false,
    sortOrder: 0,
  }),
  plan({}),
  plan({
    id: "pro",
    name: "Pro",
    monthlyPriceAed: 899,
    enquiriesPerMonth: null,
    productLimit: null,
    locationLimit: 10,
    teamSeats: 10,
    storageMb: 10 * 1024,
    customDomain: true,
    sponsoredEligible: true,
    sortOrder: 2,
  }),
];

/** The board's seller: over Free on every meter. */
const OVER_CAP: Usage = { products: 1204, locations: 4, photos: 0, categories: 0, seats: 3, storageMb: 2150 };
/**
 * Comfortably inside every plan. Every metered cell reads `All n`.
 *
 * Moved down with the Free caps: at two seats and 400 MB this state stopped
 * being inside Free the moment Free became one seat and 50 MB, and a fixture
 * captioned "inside every plan" that renders two reduced rows is a state
 * demonstrating the opposite of its own label.
 */
const WITHIN: Usage = { products: 7, locations: 1, photos: 0, categories: 0, seats: 1, storageMb: 20 };
/** Nothing yet. The cold-start state, and it must read honest rather than broken. */
const EMPTY: Usage = { products: 0, locations: 0, photos: 0, categories: 0, seats: 1, storageMb: 0 };

/**
 * Board 11h's consequence table, in the three states it actually has.
 *
 * The one that would regress silently is `WITHIN`: a seller Free already holds
 * everything of is told **nothing changes**, and the version of this table that
 * reads its marks off a list rather than off the arithmetic would tell them ten
 * of their seven products stay live. The board's figures are one seller's; the
 * screen has to hold for every seller.
 */
function Consequences({ usage, ...over }: { usage: Usage } & Partial<CancelFacts>) {
  const facts: CancelFacts = {
    plan: LADDER[2]!,
    free: LADDER[0]!,
    usage,
    freeStartsOn: new Date("2026-09-14T00:00:00.000Z"),
    enquiriesLastMonth: 86,
    verified: true,
    reviewCount: 42,
    domain: "shop.alwaha.ae",
    storefrontUrl: "businesslistings.ae/b/al-waha",
    csvImportLastUsedAt: new Date("2026-09-02T00:00:00.000Z"),
    placement: {
      label: t("cancel.now.sponsored", { what: "Valves & actuators, Dubai" }),
      endsOn: new Date("2026-09-30T00:00:00.000Z"),
    },
    ...over,
  };

  return (
    <ConsequenceTable
      rows={consequenceTable(facts)}
      planName={facts.plan.name}
      freeStartsOn={formatDate(facts.freeStartsOn)}
    />
  );
}

function Grid({ usage }: { usage: Usage }) {
  const rows: GridRow[] = planGrid(LADDER, usage);

  return (
    <Card surface="card" padded={false}>
      <table className="w-full border-collapse text-left text-caption">
        <caption className="sr-only">{t("change.grid_caption")}</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="w-40 border-b border-line px-3 py-2.5 font-normal text-muted"
            >
              {t("change.col.feature")}
            </th>
            {LADDER.map((entry) => (
              <th key={entry.id} scope="col" className="border-b border-line px-3 py-2.5">
                <span className="font-mono text-eyebrow uppercase tracking-[0.12em] text-moss">
                  {entry.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-line-soft last:border-0">
              <th scope="row" className="px-3 py-2 text-left font-normal text-muted">
                {row.header}
              </th>
              {row.cells.map((cell) => (
                <td key={cell.planId} className="px-3 py-2">
                  {cell.state === "included" ? (
                    <span className="font-medium text-ok-ink">
                      <span aria-hidden="true">✓</span>{" "}
                      <span className="sr-only">{cell.label}</span>
                    </span>
                  ) : cell.state === "absent" ? (
                    <span className="text-muted">
                      <span aria-hidden="true">—</span>{" "}
                      <span className="sr-only">{cell.label}</span>
                    </span>
                  ) : cell.state === "shortfall" ? (
                    <span className="font-medium text-warn-ink">{cell.label}</span>
                  ) : (
                    <span className="text-body-ink">{cell.label}</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/** The board's own invoice. Two lines, so per-line VAT is visible. */
const INVOICE: TaxInvoiceDocument = {
  id: "inv_gallery",
  ref: "BL-INV-20418",
  docType: "tax_invoice",
  status: "paid",
  supplier: {
    name: "Bearing Deployment Company, Inc",
    addressLines: ["2261 Market Street STE 83655", "San Francisco CA 94114"],
    trn: null,
    incorporation: "Incorporated in Delaware, USA",
  },
  recipient: {
    name: "Al Waha Industrial Supplies LLC",
    addressLines: ["Warehouse 14, JAFZA South, Dubai"],
    trn: "100 3882 1140 0003",
    incorporation: null,
  },
  issuedOn: "14 Aug 2026",
  suppliedOn: "14 Aug 2026",
  supplyPeriod: "14 Aug 2026 – 13 Sep 2026",
  placeOfSupply: "Dubai, UAE",
  lines: [
    {
      id: "l1",
      description: "Pro subscription",
      detail: "14 Aug 2026 – 13 Sep 2026 · standard rate",
      bookingRef: null,
      qty: "1",
      unitAed: "299.00",
      rate: "5%",
      vatAed: "14.95",
      amountAed: "299.00",
    },
    {
      id: "l2",
      description: "Sponsored placement · Valves & actuators, Dubai",
      detail: "14 Aug 2026 – 13 Sep 2026 · standard rate",
      bookingRef: "PB-3391",
      qty: "1",
      unitAed: "1,400.00",
      rate: "5%",
      vatAed: "70.00",
      amountAed: "1,400.00",
    },
  ],
  totals: {
    subtotalAed: "1,699.00",
    vatAed: "84.95",
    totalAed: "1,783.95",
    stored: true,
    currency: "AED",
  },
  payment: { paidOn: "14 Aug 2026", brand: "Visa", last4: "2318", bank: "Emirates NBD" },
  references: { pspRef: "PSP-8841-20418", subscriptionRef: "SUB-4471-PRO" },
  correctsRef: null,
  pdf: { path: "x", bytes: 5482 },
  delivery: [],
  billingEmail: "accounts@alwaha.ae",
};

/** The same document, issued before the columns that hold half of it existed. */
const LEGACY: TaxInvoiceDocument = {
  ...INVOICE,
  id: "inv_gallery_legacy",
  ref: "BL-INV-19341",
  suppliedOn: null,
  supplyPeriod: null,
  placeOfSupply: null,
  lines: [
    {
      id: "l1",
      description: "Pro plan, one month",
      detail: "standard rate",
      bookingRef: null,
      qty: "1",
      unitAed: null,
      rate: null,
      vatAed: null,
      amountAed: "299.00",
    },
  ],
  totals: { ...INVOICE.totals, stored: false, subtotalAed: "299.00", vatAed: "14.95", totalAed: "313.95" },
  payment: null,
  references: { pspRef: null, subscriptionRef: null },
  pdf: null,
};

export function Billing() {
  return (
    <Section
      id="billing"
      title={t("gallery.billing")}
      note={t("gallery.billing_note")}
    >
      <States label={t("gallery.billing.over")} stack>
        <Grid usage={OVER_CAP} />
      </States>

      <States label={t("gallery.billing.within")} stack>
        <Grid usage={WITHIN} />
      </States>

      <States label={t("gallery.billing.empty")} stack>
        <Grid usage={EMPTY} />
      </States>

      <States label={t("gallery.cancel.over")} stack>
        <Consequences usage={OVER_CAP} />
      </States>

      <States label={t("gallery.cancel.within")} stack>
        {/*
           Free holds everything this seller has, so every row reads
           `Unchanged` — including the two the board drew as consequences,
           because a domain that is not in use cannot stop resolving and a
           placement that was never booked cannot end.
        */}
        <Consequences usage={WITHIN} domain={null} placement={null} csvImportLastUsedAt={null} />
      </States>

      <States label={t("gallery.cancel.empty")} stack>
        {/* The cold-start state: nothing stored, no reviews, nothing booked. */}
        <Consequences
          usage={EMPTY}
          enquiriesLastMonth={0}
          verified={false}
          reviewCount={0}
          domain={null}
          placement={null}
          csvImportLastUsedAt={null}
        />
      </States>

      <States label={t("gallery.billing.plan_status")}>
        <StatusBadge tone="ok">{t("billing.status.active")}</StatusBadge>
        <StatusBadge tone="warn">{t("billing.status.ending_badge")}</StatusBadge>
        <StatusBadge tone="ok">{t("change.current")}</StatusBadge>
        <StatusBadge tone="ok" shape="chip">
          {t("change.selected")}
        </StatusBadge>
      </States>

      <States label={t("gallery.billing.invoice")} stack>
        <InvoiceSheet document={INVOICE} />
      </States>

      <States label={t("gallery.billing.invoice_partial")} stack>
        {/*
           An invoice issued before board 11g. It has no per-line VAT and no unit
           price, and the sheet says `Not stored` rather than deriving figures
           that would be indistinguishable from ones actually charged — which is
           the whole of criterion 2.
        */}
        <InvoiceSheet document={LEGACY} />
      </States>

      {/*
         Board 3m's cancel entry, and the banner it becomes. Neither had a story.

         The banner is the harder of the two to reach: `account.spec.ts` records
         that no acceptance test confirms a cancellation, because doing so drops
         the shared fixture seller to Free and takes the plan grid, the invoice
         list and the tax-invoice block with it. So its markup — the keep-picker
         rows, the dated `choose by` line, the resume island — was rendered by
         no test and no story at all.
      */}
      <States label={t("gallery.billing.cancel_entry")} stack>
        <Frame width="34rem">
          <CancelCard
            keeps="10"
            used="1,204"
            enquiries="3"
            withinFreeCap={false}
            endsAt={null}
            chooseBy={null}
            keepLinks={[]}
            resume={null}
          />
        </Frame>
      </States>

      <States label={t("gallery.billing.cancel_scheduled")} stack>
        <Frame width="34rem">
          <CancelCard
            keeps="10"
            used="1,204"
            enquiries="3"
            withinFreeCap={false}
            endsAt="14 Sep 2026"
            chooseBy="13 Sep 2026"
            keepLinks={[
              {
                kind: "products",
                label: "10 of 1,204 products stay live",
                href: "/dashboard/billing/change/keep/products",
                chosenLabel: "Not chosen — the newest 10 stay",
              },
              {
                kind: "locations",
                label: "1 of 4 branches stays published",
                href: "/dashboard/billing/change/keep/locations",
                chosenLabel: "1 chosen",
              },
            ]}
            resume={
              <Button variant="secondary" size="sm">
                {t("billing.cancelling.resume", { plan: "Pro" })}
              </Button>
            }
          />
        </Frame>
      </States>

      <States label={t("gallery.billing.failed")} stack>
        <Alert
          tone="bad"
          title={t("billing.failed.title", { amount: "AED 943.95", when: "4 Sep 2026" })}
          /*
             A `bad` notice owes the reader a way out — design-system §05.1, and
             `Alert` warns in development when neither is given.

             The real banner on `3m` passes the same `fix` now. It used to pass
             an `Update payment method` button pointing at `#payment-method`, a
             panel whose own footer says card capture is not built: honest where
             it landed and a dead end where it was pressed.
          */
          fix={t("billing.failed.fix")}
        >
          <p>{t("billing.failed.reason", { reason: "Card expired" })}</p>
          <p className="mt-1">{t("billing.failed.retry", { when: "11 Sep 2026" })}</p>
          <p className="mt-1">{t("billing.failed.grace", { deadline: "19 Sep 2026" })}</p>
        </Alert>
      </States>
    </Section>
  );
}
