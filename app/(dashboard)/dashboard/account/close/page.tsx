import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClassName } from "@/components/primitives";
import { Card } from "@/components/structure";
import { getActor } from "@/lib/auth/session";
import { mayCloseAccount } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import { closureBlockers } from "@/lib/closure/blockers";
import { consequenceRows, notOursToDelete } from "@/lib/closure/consequences";
import { COOLING_OFF_DAYS, addDays, closureState } from "@/lib/closure/policy";
import { openClosureFor, openClosureOwnedBy } from "@/lib/closure/service";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, getSellerSeat, SellerPage } from "../../_shell";
import {
  ClosureActions,
  ClosureBlockersPanel,
  ClosureConsequences,
  ClosurePaths,
  ClosureRail,
  type PlanPath,
} from "./_panels";
import { ReopenButton } from "./ReopenButton";

/**
 * Board `11i` — `/dashboard/account/close`.
 *
 * **Account, not billing.** Closing is not a billing action; it is the only path
 * in the product that removes a business, and filing it under billing is what
 * confused it with cancellation in the first place. The sidebar shows Settings
 * active, because the console has no account-level item of its own.
 *
 * Four things this URL can be, decided in order:
 *
 *   1. **The reversal screen.** An owner whose closure is in its window signs
 *      in again with no seat — closure revoked it — and lands here.
 *   2. **Not reachable.** Anybody who is not the owner: a manager, a finance
 *      seat, staff looking through a seller's eyes (Q4).
 *   3. **A platform notice.** We are closing it because the licence lapsed. The
 *      seller sees the notice, not the flow: we initiate, they respond (`B8`).
 *   4. **The board.** Blocked or clear.
 */
export const metadata = { title: t("closure.title") };
export const dynamic = "force-dynamic";

export default async function CloseAccountPage() {
  const now = new Date();
  const seat = await getSellerSeat();

  if (!seat) {
    const actor = await getActor();
    const owned = actor ? await openClosureOwnedBy(actor.id) : null;
    if (!owned) notFound();
    return <ReversalScreen closure={owned} now={now} />;
  }

  if (seat.viewingAs || !mayCloseAccount(seat.actor)) notFound();

  const [business, subscription, seats, subdomain, open, badges] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: { displayName: true, slug: true, licenceNumber: true, licenceExpiry: true },
    }),
    prisma.subscription.findUnique({
      where: { businessId: seat.businessId },
      select: {
        cancelledAt: true,
        endsAt: true,
        renewsAt: true,
        plan: { select: { name: true, monthlyPriceAed: true } },
      },
    }),
    // The count the table prints. Every seat on the business, the owner included.
    prisma.user.count({ where: { businessId: seat.businessId } }),
    prisma.customDomain.findUnique({ where: { businessId: seat.businessId }, select: { hostname: true } }),
    openClosureFor(seat.businessId),
    getNavBadges(seat.businessId),
  ]);

  const shell = {
    seat,
    badges,
    activeHref: "/dashboard/settings",
    eyebrow: t("closure.eyebrow"),
    title: t("closure.title"),
    meta: (
      <span className="text-body-sm text-muted">
        {t("closure.meta", { business: business.displayName, licence: business.licenceNumber })}
      </span>
    ),
  } as const;

  // An owner closure revokes this seat, so an open closure seen *with* a seat
  // is a platform notice that has not taken effect yet.
  if (open && open.initiator === "platform" && !open.appliedAt) {
    return (
      <SellerPage {...shell}>
        <NoticeScreen
          businessName={business.displayName}
          effectiveAt={open.effectiveAt}
          licenceExpiredOn={business.licenceExpiry}
        />
      </SellerPage>
    );
  }

  const blockers = await closureBlockers(seat.businessId, now);
  const plan: PlanPath =
    subscription && subscription.plan.monthlyPriceAed > 0
      ? subscription.cancelledAt
        ? {
            kind: "cancelling",
            planName: subscription.plan.name,
            endsOn: subscription.endsAt ?? subscription.renewsAt,
          }
        : { kind: "paid", planName: subscription.plan.name }
      : { kind: "free" };

  const rows = consequenceRows({ seats, subdomain: subdomain?.hostname ?? null, slug: business.slug });
  const { notOurs, kept } = notOursToDelete(rows);

  return (
    <SellerPage
      {...shell}
      actions={
        <span className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">
          {t("closure.not_billing")}
        </span>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21.5rem]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <ClosurePaths plan={plan} />
          <ClosureBlockersPanel blockers={blockers} />
          <ClosureConsequences rows={rows} />
        </div>

        <aside aria-label={t("closure.rail.label")} className="flex flex-col gap-3.5">
          <ClosureRail previewFinalAt={addDays(now, COOLING_OFF_DAYS)} notOurs={notOurs} kept={kept} />
          <ClosureActions blockers={blockers} />
        </aside>
      </div>
    </SellerPage>
  );
}

/**
 * The owner came back inside the window. One question, one button.
 *
 * No dashboard chrome: the owner has no seat, so there is no sidebar to draw
 * and no business to name in it. The page states when the listing came down,
 * the last day it can come back, and that it comes back as it was.
 */
function ReversalScreen({
  closure,
  now,
}: {
  closure: NonNullable<Awaited<ReturnType<typeof openClosureOwnedBy>>>;
  now: Date;
}) {
  const state = closureState(closure, now);
  const name = closure.business.displayName;

  return (
    <main className="mx-auto w-full max-w-[40rem] px-5 py-16">
      <Card padded>
        <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">
          {t("closure.reopen.eyebrow")}
        </p>
        <h1 className="mt-2 text-h2 text-ink">{name}</h1>

        {closure.initiator === "platform" ? (
          /*
             Build note B8. A closure we made because a licence lapsed is not the
             owner's to undo with a button — the listing would go back up with
             the same lapsed licence behind it. Terms §11: supplying a current
             document restores it, and that goes through a person.
          */
          <p className="mt-2 max-w-prose text-body-sm text-body-ink">
            {t("closure.reopen.platform", { business: name, date: formatDate(closure.finalAt) })}
          </p>
        ) : state === "requested" ? (
          <>
            <p className="mt-2 max-w-prose text-body-sm text-body-ink">
              {t("closure.reopen.body", {
                business: name,
                closed: formatDate(closure.appliedAt ?? closure.requestedAt),
                date: formatDate(closure.finalAt),
              })}
            </p>
            <p className="mt-2 max-w-prose text-caption text-muted">{t("closure.reopen.seats_note")}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <ReopenButton label={t("closure.reopen.cta", { business: name })} />
              <Link href="/" className={buttonClassName({ variant: "secondary" })}>
                {t("closure.reopen.leave")}
              </Link>
            </div>
          </>
        ) : (
          <p className="mt-2 max-w-prose text-body-sm text-body-ink">
            {t("closure.reopen.window_ended", { business: name, date: formatDate(closure.finalAt) })}
          </p>
        )}
      </Card>
    </main>
  );
}

/**
 * Build note `B8` — we initiate, they respond.
 *
 * The seller still has their seat for the notice period, and the only thing on
 * this page is what stops it: a renewed licence on the verification screen.
 */
function NoticeScreen({
  businessName,
  effectiveAt,
  licenceExpiredOn,
}: {
  businessName: string;
  effectiveAt: Date;
  licenceExpiredOn: Date;
}) {
  return (
    <Card padded>
      <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-warn-ink">
        {t("closure.notice.eyebrow")}
      </p>
      <h2 className="mt-2 text-h3 text-ink">
        {t("closure.notice.title", { business: businessName, date: formatDate(effectiveAt) })}
      </h2>
      <p className="mt-2 max-w-prose text-body-sm text-body-ink">
        {t("closure.notice.body", { expired: formatDate(licenceExpiredOn) })}
      </p>
      <div className="mt-5">
        <Link href="/dashboard/verification" className={buttonClassName()}>
          {t("closure.notice.cta")}
        </Link>
      </div>
    </Card>
  );
}
