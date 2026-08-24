import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../_shell";
import { confirmCancellation } from "../actions";
import { CancelForm } from "./CancelForm";

export const metadata = { title: "Cancel subscription" };
export const dynamic = "force-dynamic";

export default async function CancelPage() {
  const seat = await requireSellerSeat();

  const [business, badges] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: {
        plan: { select: { name: true } },
        subscription: { select: { renewsAt: true, cancelledAt: true } },
      },
    }),
    getNavBadges(seat.businessId),
  ]);

  // Nothing to cancel is a 404 rather than a page saying so. A seller on Free
  // reaching this URL has followed a stale link.
  if (!business.subscription || business.subscription.cancelledAt) notFound();

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/billing"
      eyebrow={t("billing.eyebrow")}
      title={t("cancel.title")}
      breadcrumb={
        <Link
          href="/dashboard/billing"
          className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("change.back")}
        </Link>
      }
    >
      <CancelForm
        planName={business.plan?.name ?? t("plan.free")}
        endsOn={formatDate(business.subscription.renewsAt)}
        action={confirmCancellation}
      />
    </SellerPage>
  );
}
