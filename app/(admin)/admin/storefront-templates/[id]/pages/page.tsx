import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClassName } from "@/components/primitives";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { pagesFor } from "@/lib/storefront/pages";
import { storeCount, templateWithSections } from "@/lib/storefront/service";
import { prisma } from "@/lib/db/client";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../../_shell";
import { addPage, goLive, movePage, savePage } from "./actions";
import { PageEditor, type PageRow } from "./PageEditor";

/**
 * Board 5d — the page template editor.
 *
 * A page authored here appears on every storefront in the trade, which is what
 * makes the content check worth having and criterion 9 worth enforcing.
 */

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export default async function PagesPage({ params }: Params) {
  const seat = await requireStaff();
  if (!can(seat.actor, "storefront.template.write")) notFound();

  const { id } = await params;
  const template = await templateWithSections(id);
  if (!template) notFound();

  const [pages, stores, areas, badges] = await Promise.all([
    pagesFor(template.id),
    storeCount(template.sectorId),
    /*
     * The places the copy could reasonably mention, for the local check.
     * Emirates and the area names of listings in this trade — a page about
     * valves in Al Quoz should say Al Quoz, and a check that only knew the
     * seven emirates would mark that page as missing a place.
     */
    prisma.location.findMany({
      where: { published: true, business: { sectorId: template.sectorId } },
      select: { emirate: true, area: { select: { name: true } } },
      distinct: ["areaId"],
      take: 60,
    }),
    getAdminNavBadges(seat),
  ]);

  const places = [
    ...new Set([
      ...areas.map((location) => location.area?.name).filter((name): name is string => Boolean(name)),
      ...areas.map((location) => t(`emirate.${location.emirate}` as never)),
    ]),
  ];

  const rows: PageRow[] = pages.map((page) => ({
    id: page.id,
    slug: page.slug,
    title: page.title,
    metaDescription: page.metaDescription,
    blocks: page.blocks,
    showInNav: page.showInNav,
    allowIndexing: page.allowIndexing,
    status: page.status,
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/storefront-templates"
      title={`${template.name} — ${t("pages.title")}`}
      eyebrow={t("pages.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("pages.meta", {
            count: formatCount(rows.length),
            stores: formatCount(stores),
          })}
        </span>
      }
      actions={
        <Link
          className={buttonClassName({ variant: "secondary" })}
          href={`/admin/storefront-templates/${template.id}`}
        >
          {t("pages.back")}
        </Link>
      }
    >
      <PageEditor
        templateId={template.id}
        storeCount={formatCount(stores)}
        sectorName={template.sector.name}
        places={places}
        pages={rows}
        actions={{ addPage, savePage, goLive, movePage }}
      />
    </AdminPage>
  );
}
