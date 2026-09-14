import { PublicShell } from "@/components/structure";
import type { BriefValue } from "@/components/domain/ServiceBriefComposer";
import { prisma } from "@/lib/db/client";
import { formatDuration } from "@/lib/format";
import { EMPTY_BRIEF, isEmirate, type BriefSite } from "@/lib/enquiry/service-brief";
import {
  briefFirstReplyMedianMs,
  pinnedSelection,
  previewBrief,
  type PinnedFirm,
} from "@/lib/enquiry/service-brief-server";
import { ViewerNav } from "@/app/(public)/_account-menu";
import type { ResendSource } from "@/lib/enquiry/resend";
import { t } from "@/lib/i18n";
import { BriefForm } from "../BriefForm";

/**
 * Board `1h-s` — `/rfq/new` when the trade is sold by the job.
 *
 * A second composer on the same route, selected by the subcategory's
 * `tradeKind`; the goods `1h` beside it is untouched. Three arrivals:
 *
 *  - **cold**, from search or a category page — all five questions empty;
 *  - **seeded from `1f-s`** — `?emirate=` answers question 01, the rail matches
 *    at once, and the cursor starts in question 02;
 *  - **a named firm** — `?to=` from a storefront or a search row, with
 *    `?service=` where the buyer came from one. Same page, one recipient.
 *
 * No footer: a composer is a task surface, and the site footer would offer
 * twelve ways to abandon it.
 */
export async function ServiceBriefPage({
  category,
  firm,
  service,
  params,
  kind,
  signedIn,
  resend = null,
}: {
  category: { id: string; name: string; slug: string };
  firm: PinnedFirm | null;
  service: { slug: string; engagementType: string | null } | null;
  params: { emirate: string | null; area: string | null };
  kind: string | null;
  signedIn: boolean;
  /** Board 10e: an expired brief being re-sent, whose answers seed this one. */
  resend?: ResendSource | null;
}) {
  const [trade, areas, firstReplyMs] = await Promise.all([
    prisma.category.findUnique({
      where: { id: category.id },
      select: { scopeFamilyId: true, parent: { select: { scopeFamilyId: true } } },
    }),
    prisma.area.findMany({
      select: { id: true, name: true, emirate: true, isFreeZone: true, slug: true },
      orderBy: { name: "asc" },
    }),
    briefFirstReplyMedianMs(),
  ]);

  /*
     The seeded site. An area slug the taxonomy holds, else an emirate, else
     nothing — never a guess from free text; the resolver for typed places is
     the goods composer's, and here the buyer picks.
  */
  const seededArea = resend?.brief?.areaId
    ? areas.find((area) => area.id === resend.brief!.areaId)
    : params.area
      ? areas.find((area) => area.slug === params.area)
      : undefined;
  const seededEmirate = resend?.emirate ?? params.emirate;
  const site: BriefSite | null = seededArea
    ? { emirate: seededArea.emirate, areaId: seededArea.id }
    : seededEmirate && isEmirate(seededEmirate)
      ? { emirate: seededEmirate, areaId: null }
      : null;

  const initial: BriefValue = {
    ...EMPTY_BRIEF,
    site: site ? (site.areaId ? `area:${site.areaId}` : `emirate:${site.emirate}`) : "",
    // From a service page, the engagement that service is sold on — a default
    // the buyer can change, since it is their brief and not the firm's sheet.
    engagement: service?.engagementType ?? "",
    /*
       A re-send carries the old brief's answers across, except the start date:
       the one it asked for has passed, so the buyer picks again.
    */
    ...(resend?.brief
      ? {
          description: resend.requirement,
          engagement: resend.brief.engagementType,
          cadence: resend.brief.cadence ?? "",
          startMode: resend.brief.startMode === "from_date" ? "" : resend.brief.startMode,
          building: resend.brief.building ?? "",
          scale: resend.scale ?? "",
        }
      : {}),
  };

  const [initialPreview, pinnedDeliverable] = await Promise.all([
    !firm && site
      ? previewBrief({ categoryId: category.id, site, scope: "area", engagement: null })
      : Promise.resolve(null),
    firm ? pinnedSelection(firm.id).then((s) => s.recipients.length === 1) : Promise.resolve(false),
  ]);

  return (
    <PublicShell nav={<ViewerNav />}>
      {resend ? (
        <div className="mx-auto w-full max-w-7xl px-5 pt-6">
          <p className="rounded-ctl border border-info-line bg-info-wash px-3.5 py-2.5 text-body-sm text-info-ink">
            {t("rfq.resend_notice", { ref: resend.ref })}
          </p>
        </div>
      ) : null}
      <BriefForm
        resentFrom={resend?.ref ?? null}
        categoryId={category.id}
        kind={kind}
        subcategoryName={category.name}
        family={trade?.scopeFamilyId ?? trade?.parent?.scopeFamilyId ?? "general"}
        areas={areas.map(({ id, name, emirate, isFreeZone }) => ({ id, name, emirate, isFreeZone }))}
        initial={initial}
        pinned={firm ? { slug: firm.slug, name: firm.displayName } : null}
        service={service?.slug ?? null}
        pinnedDeliverable={pinnedDeliverable}
        initialPreview={initialPreview}
        firstReply={firstReplyMs === null ? null : formatDuration(firstReplyMs)}
        askForContact={!signedIn}
        unpinHref={
          firm ? `/rfq/new?${new URLSearchParams({ category: category.slug, kind: "services" })}` : null
        }
      />
    </PublicShell>
  );
}
