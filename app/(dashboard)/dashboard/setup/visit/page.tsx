import Link from "next/link";
import { prisma } from "@/lib/db/client";
import { Panel } from "@/components/structure";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../_shell";
import { cancelVisit, requestVisit } from "../actions";
import { VisitForm } from "./VisitForm";

export const metadata = { title: "Book a verification visit" };
export const dynamic = "force-dynamic";

export default async function VisitPage() {
  const seat = await requireSellerSeat();

  const [open, badges] = await Promise.all([
    prisma.siteVisitRequest.findFirst({
      where: { businessId: seat.businessId, cancelledAt: null, completedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    }),
    getNavBadges(seat.businessId),
  ]);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/setup"
      eyebrow={t("setup.eyebrow")}
      title={t("visit.title")}
      breadcrumb={
        <Link
          href="/dashboard/setup"
          className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("setup.title")}
        </Link>
      }
    >
      <Panel title={t("visit.title")} description={t("visit.intro")}>
        <VisitForm
          pending={open ? { id: open.id, requestedAt: formatDate(open.createdAt) } : null}
          requestAction={requestVisit}
          cancelAction={cancelVisit}
        />
      </Panel>
    </SellerPage>
  );
}
