import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { mayCloseAccount } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/client";
import { closureBlockers } from "@/lib/closure/blockers";
import { COOLING_OFF_DAYS, addDays } from "@/lib/closure/policy";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../../_shell";
import { ConfirmClosureForm } from "./ConfirmClosureForm";

/**
 * Board `11i` — the confirmation step.
 *
 * A real route rather than a modal, for the reason board 11j gave for its own
 * second step: back-navigable, and nothing on it is lost to a stray click
 * outside a dialog.
 *
 * It restates the three consequences a seller cannot see from the table alone —
 * that it happens now, that it signs them out too, and exactly where the way
 * back will be sent — and asks them to say they understood. The blockers are
 * read again on arrival; a seller who opened this in a second tab after a buyer
 * answered a quote is sent back to see why.
 */
export const metadata = { title: t("closure.confirm.title") };
export const dynamic = "force-dynamic";

export default async function ConfirmClosurePage() {
  const seat = await requireSellerSeat();
  if (seat.viewingAs || !mayCloseAccount(seat.actor)) notFound();

  const now = new Date();
  const [blockers, badges, owner, seats] = await Promise.all([
    closureBlockers(seat.businessId, now),
    getNavBadges(seat.businessId),
    prisma.user.findUnique({ where: { id: seat.actor.id }, select: { email: true } }),
    prisma.user.count({ where: { businessId: seat.businessId } }),
  ]);
  if (!blockers.clear) redirect("/dashboard/account/close");

  const finalOn = formatDate(addDays(now, COOLING_OFF_DAYS));

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/settings"
      eyebrow={t("closure.eyebrow")}
      title={t("closure.confirm.heading", { business: seat.businessName })}
      breadcrumb={
        <Link
          href="/dashboard/account/close"
          className="rounded-tag text-caption font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("closure.confirm.back")}
        </Link>
      }
    >
      <ConfirmClosureForm
        businessName={seat.businessName}
        points={[
          t("closure.confirm.point_now"),
          t("closure.confirm.point_team", { count: seats, formatted: formatCount(seats) }),
          owner?.email
            ? t("closure.confirm.point_email", { date: finalOn, email: owner.email })
            : t("closure.confirm.point_no_email", { date: finalOn }),
        ]}
      />
    </SellerPage>
  );
}
