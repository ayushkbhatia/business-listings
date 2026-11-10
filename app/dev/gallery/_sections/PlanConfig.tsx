"use client";

import { DunningTable, type DunningRowView } from "@/app/(admin)/admin/dunning/DunningTable";
import { PlanMatrix, type PlanColumn } from "@/app/(admin)/admin/plans/PlanMatrix";
import type { ActionResult, PreviewResult } from "@/app/(admin)/admin/plans/actions";
import { PLAN_FIELDS, type PlanEditableField } from "@/lib/plan/plan-fields";
import type { PlanFieldValue } from "@/lib/billing/plan-diff";
import { dunningRail, type RailDelivery } from "@/lib/billing/dunning-rail";
import type { DunningStage } from "@/lib/billing/dunning";
import { railLines } from "@/lib/billing/rail-copy";
import { Section, States } from "../_kit";

/*
   T9.4 — each specimen's sequence, through the real rail and the real copy.
   `notice` is the Last notice cell as the page builds it.
*/
const NOW = new Date("2026-09-16T08:00:00Z");
function sequence(
  stage: DunningStage,
  daysPastDue: number,
  deliveries: RailDelivery[],
  notice: DunningRowView["lastNotice"],
  urgent = false,
): Pick<DunningRowView, "lastNotice" | "steps" | "cancelled" | "urgent"> {
  const since = new Date(NOW.getTime() - daysPastDue * 86_400_000);
  const rail = dunningRail({ pastDueSince: since, stage, attempted: true, cancelledAt: null, deliveries });
  return { lastNotice: notice, steps: railLines(rail, { gatewayLive: true, cancelled: false, audience: "staff" }), cancelled: null, urgent };
}
const delivery = (event: RailDelivery["event"], channel: string, daysAgo: number, status: RailDelivery["status"], reason: string | null = null): RailDelivery => {
  const at = new Date(NOW.getTime() - daysAgo * 86_400_000);
  return { event, channel, status, reason, createdAt: at, sentAt: status === "sent" ? at : null, scheduledFor: null, recipientName: "Hassan Qureshi" };
};

/**
 * Board 12e, in the states it has.
 *
 * Synthetic plans rather than a query, so the gallery renders identically on an
 * empty database and the states are the point rather than the data.
 *
 * The three that matter, and each would regress silently because a wrong cell
 * still looks like a cell:
 *
 *   **Unlimited, as a control and not a word.** `B6`. The cap's box is disabled
 *   and reads the word; the checkbox beside it is what holds the null. This is
 *   the state where somebody would be tempted to let the string be typed.
 *   **Read-only.** A moderator on a support call has `revenue.read` and not
 *   `plan.entitlements.write`, and the table has to answer "what does Basic
 *   allow" without offering a single input.
 *   **A plan off sale.** Withdrawn is a badge on the column head, not a missing
 *   column: everybody already on it keeps it, so it has to keep rendering.
 */

function values(over: Partial<Record<PlanEditableField, PlanFieldValue>>) {
  const base = {} as Record<PlanEditableField, PlanFieldValue>;
  for (const spec of PLAN_FIELDS) base[spec.field] = spec.kind === "switch" ? false : 10;
  return { ...base, ...over };
}

const LADDER: PlanColumn[] = [
  {
    id: "free",
    name: "Free",
    values: values({
      monthlyPriceAed: 0,
      annualMonthsCharged: null,
      enquiriesPerMonth: 3,
      productLimit: 10,
      serviceLimit: 3,
      locationLimit: 1,
      photoLimit: 30,
      publicPhotoLimit: 3,
      storageMb: 50,
      categoryLimit: 1,
      teamSeats: 1,
    }),
    onSale: true,
    withdrawnOn: null,
    subscriptions: 0,
    grandfathered: 0,
    annualPrice: null,
  },
  {
    id: "basic",
    name: "Basic",
    values: values({
      monthlyPriceAed: 349,
      annualMonthsCharged: 10,
      enquiriesPerMonth: 40,
      productLimit: 150,
      serviceLimit: 15,
      locationLimit: 3,
      photoLimit: 40,
      publicPhotoLimit: null,
      storageMb: 300,
      categoryLimit: 3,
      teamSeats: 3,
      analytics: true,
      csvImport: true,
    }),
    onSale: true,
    withdrawnOn: null,
    subscriptions: 12,
    grandfathered: 4,
    annualPrice: "AED 3,490",
  },
  {
    id: "pro",
    name: "Pro",
    values: values({
      monthlyPriceAed: 899,
      annualMonthsCharged: 10,
      enquiriesPerMonth: null,
      productLimit: null,
      serviceLimit: null,
      locationLimit: 10,
      photoLimit: 200,
      publicPhotoLimit: null,
      storageMb: 500,
      categoryLimit: null,
      teamSeats: 10,
      customDomain: true,
      analytics: true,
      csvImport: true,
      sponsoredEligible: true,
    }),
    onSale: true,
    withdrawnOn: null,
    subscriptions: 30,
    grandfathered: 0,
    annualPrice: "AED 8,990",
  },
];

/** The same ladder with the middle tier off sale. */
const WITHDRAWN: PlanColumn[] = LADDER.map((plan) =>
  plan.id === "basic" ? { ...plan, onSale: false, withdrawnOn: "14 Sep 2026" } : plan,
);

const noPreview = async (): Promise<PreviewResult> => ({
  ok: false,
  error: "The gallery does not write.",
});
const noCommit = async (): Promise<ActionResult> => ({
  ok: false,
  error: "The gallery does not write.",
});

/*
   Two attempts at most in one episode: the renewal that failed and dunning's
   one silent retry on day zero. Every later step is a notice, not a charge — so
   a row reading "4 tried" is a state the sequence cannot reach.
*/
const DUNNING: DunningRowView[] = [
  {
    subscriptionId: "none",
    businessName: "Mussafah Cold Stores",
    planName: "Basic",
    stage: "none",
    daysPastDue: 0,
    next: "Retry the card",
    attempts: 0,
    amount: "AED 366.45",
    reason: null,
    drops: "on 1 Oct 2026",
    dropsTitle: "1 Oct 2026",
    ...sequence("none", 0, [], null),
  },
  {
    subscriptionId: "one",
    businessName: "Dana Printing & Signage",
    planName: "Pro",
    stage: "messaged",
    daysPastDue: 9,
    next: "Send the final notice",
    attempts: 2,
    amount: "AED 943.95",
    reason: "Card expired",
    drops: "in 6 days",
    dropsTitle: "22 Sep 2026",
    ...sequence(
      "messaged",
      9,
      [
        delivery("payment_failed", "email", 6, "sent"),
        delivery("payment_failed", "in_app", 6, "sent"),
        delivery("payment_failed", "email", 2, "sent"),
        delivery("payment_failed", "whatsapp", 2, "skipped", "recipient_has_no_address_for_this_channel"),
      ],
      { label: "Delivered", tone: "ok", meta: "Day 7 · Reminder · email and WhatsApp · 14 Sep", templateHref: null },
    ),
  },
  {
    subscriptionId: "two",
    businessName: "Meridian IT Solutions",
    planName: "Basic",
    stage: "retry",
    daysPastDue: 1,
    next: "Send the first notice",
    attempts: 1,
    amount: "AED 366.45",
    reason: "Insufficient funds",
    drops: "on 30 Sep 2026",
    dropsTitle: "30 Sep 2026",
    ...sequence("retry", 1, [], null),
  },
  {
    subscriptionId: "three",
    businessName: "Gulf Star Auto Spare Parts",
    planName: "Pro",
    stage: "dropped",
    daysPastDue: 21,
    next: "Nothing due",
    attempts: 2,
    amount: "AED 943.95",
    reason: "Bank declined",
    drops: null,
    dropsTitle: null,
    ...sequence(
      "dropped",
      21,
      [delivery("payment_final_notice", "email", 7, "skipped", "no_live_template")],
      {
        label: "No live template",
        tone: "bad",
        meta: "Day 14 · Final notice · email · 9 Sep",
        templateHref: "/admin/notifications?t=payment_final_notice.email#template",
      },
    ),
  },
  {
    // Dropped with no gateway: nothing was charged, so there is no amount.
    subscriptionId: "four",
    businessName: "Ras Al Khaimah Marine Supply",
    planName: "Free",
    stage: "dropped",
    daysPastDue: 16,
    next: "Nothing due",
    attempts: 0,
    amount: null,
    reason: null,
    drops: null,
    dropsTitle: null,
    ...sequence("dropped", 16, [], null),
  },
  {
    // P-07's urgent row: changes plan within 72 hours and nobody was told.
    subscriptionId: "five",
    businessName: "Jebel Ali Pallet Works",
    planName: "Basic",
    stage: "final",
    daysPastDue: 14,
    next: "Drop to Free",
    attempts: 2,
    amount: "AED 366.45",
    reason: "Card expired",
    drops: "tomorrow",
    dropsTitle: "17 Sep 2026",
    ...sequence(
      "final",
      14,
      [delivery("payment_final_notice", "email", 0, "skipped", "recipient_has_no_address_for_this_channel")],
      { label: "Skipped — Recipient has no address on this channel", tone: "neutral", meta: "Day 14 · Final notice · email · 16 Sep", templateHref: null },
      true,
    ),
  },
];

export function PlanConfigGallery() {
  return (
    <Section
      id="plan-config"
      title="Plan config"
      note="Board 12e — entitlements per plan, and the failed-payments list"
    >
      <States label="Editable" stack>
        <PlanMatrix plans={LADDER} canEdit preview={noPreview} commit={noCommit} />
      </States>

      <States label="Read only" stack>
        <PlanMatrix plans={LADDER} canEdit={false} preview={noPreview} commit={noCommit} />
      </States>

      <States label="One off sale" stack>
        <PlanMatrix plans={WITHDRAWN} canEdit preview={noPreview} commit={noCommit} />
      </States>

      <States label="Failed payments" stack>
        <DunningTable rows={DUNNING} />
      </States>

      <States label="Nobody past due" stack>
        <DunningTable rows={[]} />
      </States>
    </Section>
  );
}
