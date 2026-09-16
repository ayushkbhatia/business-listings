import { notFound } from "next/navigation";
import { Alert } from "@/components/display";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { dunningQueue } from "@/lib/billing/dunning-queue";
import { FILS_PER_AED } from "@/lib/billing/proration";
import {
  formatAED,
  formatCloses,
  formatCount,
  formatDateShort,
  isWithinRelativeWindow,
} from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { CommerceTabs } from "../CommerceTabs";
import { DunningTable, type DunningRowView } from "./DunningTable";

/**
 * Board 12e — failed payments, and criterion 10's screen.
 *
 * There is no "suspend" control on this page, no "unpublish", and no way to
 * remove a badge from it. That is not an oversight and it is not enforced by
 * hiding buttons: the sequence's whole vocabulary of account effects is one
 * plan change, enumerated in `lib/billing/dunning.ts` and asserted by a test
 * that reads the list.
 *
 * There is no *send* control either, and that is the board's answer to its own
 * Q1. `12i` audits the notices the sequence sent and `12j` sanctions a send;
 * neither is exported. Until they are, this is the list and the sequence runs
 * itself — which is `B4`: *"the dunning sequence is config and code, not a
 * screen. Stage timings and channel per stage live there; this board does not
 * edit them."*
 */

export const dynamic = "force-dynamic";

/** `in 4 days`, or `19 Sep 2026` once it is further out than a week. */
function dropsLabel(when: Date | null, now: Date): string | null {
  if (when === null) return null;
  return isWithinRelativeWindow(when, { now })
    ? t("admin.dunning.drops_in", { when: formatCloses(when, { now }) })
    : t("admin.dunning.drops_on", { when: formatDateShort(when) });
}

function nextLabel(next: { kind: string; channel?: string }): string {
  if (next.kind === "send") {
    return t("admin.dunning.next.send", { channel: next.channel ?? "" });
  }
  return t(`admin.dunning.next.${next.kind}` as never);
}

export default async function DunningPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "revenue.read")) notFound();

  const now = new Date();
  const [queue, badges] = await Promise.all([dunningQueue(now), getAdminNavBadges(seat)]);

  const rows: DunningRowView[] = queue.rows.map((row) => ({
    subscriptionId: row.subscriptionId,
    businessName: row.businessName,
    planName: row.planName,
    stage: row.stage,
    daysPastDue: row.daysPastDue,
    next: nextLabel(row.next),
    attempts: row.attempts,
    amount: formatAED(row.amountFils / FILS_PER_AED, { style: "exact" }),
    reason: row.lastAttemptFailed,
    /*
       Relative inside the week, a date beyond it, and the full date as the
       title either way.

       "In 4 days" is what an ops lead scanning the queue reads; the date is
       what they quote to the seller on the phone, and `12i` prints it in full.
       The threshold is `formatCloses`'s own, so this column and board 10e's
       CLOSES column can never disagree about when a countdown becomes a date.
    */
    drops: dropsLabel(row.dropsToFreeAt, now),
    dropsTitle: row.dropsToFreeAt ? formatDateShort(row.dropsToFreeAt) : null,
  }));

  /*
     Only what is still recoverable. A row that has dropped is on Free with its
     listing live: the sequence is finished with it, and adding its failed
     payment to "at risk" would make the header a running total of everything
     that ever failed.
  */
  const stillDue = queue.rows.filter((row) => row.stage !== "dropped");
  const live = stillDue.length;
  const atRisk = stillDue.reduce((total, row) => total + row.amountFils, 0);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/dunning"
      title={t("admin.dunning.title")}
      eyebrow={t("admin.dunning.eyebrow")}
      meta={
        /*
           Three readings, because "2 in the sequence · AED 0.00 at risk" is two
           true figures that read as a contradiction. An account that has already
           dropped is on Free with its listing live: it is not past due, nothing
           on it is recoverable, and the header should say that rather than
           count it and then value it at nothing.
        */
        <span className="text-caption text-muted">
          {rows.length === 0
            ? t("admin.dunning.meta_none")
            : live === 0
              ? t("admin.dunning.meta_all_dropped", { count: formatCount(rows.length) })
              : t("admin.dunning.meta", {
                  count: formatCount(live),
                  amount: formatAED(atRisk / FILS_PER_AED, { style: "exact" }),
                })}
        </span>
      }
    >
      <CommerceTabs actor={seat.actor} active="/admin/dunning" />

      {!queue.gatewayLive && (
        <Alert tone="info" live="off">
          {t("admin.dunning.no_gateway")}
        </Alert>
      )}

      <p className="mb-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.dunning.sequence")}
      </p>

      <DunningTable rows={rows} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.dunning.never")}
      </p>
    </AdminPage>
  );
}
