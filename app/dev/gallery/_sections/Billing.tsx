import { Alert, StatusBadge } from "@/components/display";
import { Card } from "@/components/structure";
import { planGrid, type GridRow, type Usage } from "@/lib/billing/plan-grid";
import type { PlanCaps } from "@/lib/plan/entitlements";
import { t } from "@/lib/i18n";
import { Section, States } from "../_kit";

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
    teamSeats: 2,
    storageMb: 1024,
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
const OVER_CAP: Usage = { products: 1204, locations: 4, seats: 3, storageMb: 2150 };
/** Comfortably inside every plan. Every metered cell reads `All n`. */
const WITHIN: Usage = { products: 7, locations: 1, seats: 2, storageMb: 400 };
/** Nothing yet. The cold-start state, and it must read honest rather than broken. */
const EMPTY: Usage = { products: 0, locations: 0, seats: 1, storageMb: 0 };

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

      <States label={t("gallery.billing.plan_status")}>
        <StatusBadge tone="ok">{t("billing.status.active")}</StatusBadge>
        <StatusBadge tone="warn">{t("billing.status.ending_badge")}</StatusBadge>
        <StatusBadge tone="ok">{t("change.current")}</StatusBadge>
        <StatusBadge tone="ok" shape="chip">
          {t("change.selected")}
        </StatusBadge>
      </States>

      <States label={t("gallery.billing.failed")} stack>
        <Alert
          tone="bad"
          title={t("billing.failed.title", { amount: "AED 943.95", when: "4 Sep 2026" })}
          // A `bad` notice owes the reader a way out — design-system §05.1, and
          // `Alert` warns in development when neither is given. The real banner
          // on `3m` passes `action`, which is the `Update payment method`
          // button; the gallery has no route to send it to, so it states the fix.
          fix={t("billing.failed.update")}
        >
          <p>{t("billing.failed.reason", { reason: "Card expired" })}</p>
          <p className="mt-1">{t("billing.failed.retry", { when: "11 Sep 2026" })}</p>
          <p className="mt-1">{t("billing.failed.grace", { deadline: "19 Sep 2026" })}</p>
        </Alert>
      </States>
    </Section>
  );
}
