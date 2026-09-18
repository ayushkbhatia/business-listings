import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { buildComparison, visibleRows } from "@/lib/compare/table";
import { COMPARE_COOKIE, compareHref, idsFromParam, parseTray } from "@/lib/compare/tray";
import { loadComparison } from "@/lib/db/queries/compare";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import {
  CompareEmpty,
  CompareHeader,
  CompareNeedsMore,
  CompareNotices,
  CompareSummary,
  ComparisonTable,
  type CompareColumn,
} from "./_view";

/**
 * Board `10d` — the comparison tray, drawn at last.
 *
 * Referenced since `1e` and stood in for by a table of ten business attributes
 * until this board existed. It is the screen where `10c`'s claim — *matched on
 * spec fields, not only product names* — stops being a claim: four sellers who
 * named one valve four ways, lined up against one set of fields.
 *
 * ## What sets the columns
 *
 * `?p=` when the URL carries it (`B10`) — a comparison is shareable, and a link
 * somebody sent shows what they sent. Otherwise the buyer's own tray, from the
 * `bl_cmp` cookie, so the bar's *Compare 3 products* and a bare `/compare` in
 * the address bar land on the same table.
 *
 * ## Per-buyer, never cached, never indexed
 *
 * `force-dynamic` because the answer is one buyer's selection; `noindex,
 * nofollow` and disallowed in `robots.txt`, because a crawler walking every
 * combination of four products would be walking a space with no end.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("compare.page_title"),
  robots: { index: false, follow: false },
};

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ComparePage({ searchParams }: Props) {
  const params = await searchParams;
  const fromUrl = idsFromParam(params.p);
  const tray = parseTray((await cookies()).get(COMPARE_COOKIE)?.value);
  const ids = fromUrl.ids.length > 0 ? fromUrl.ids : tray.items.map((item) => item.id);
  const hideMatching = params.diff === "1";

  const loaded = await loadComparison(ids);
  const trade = loaded.trade?.name ?? "";
  const hasTemplate = loaded.fields.length > 0;

  const columns: CompareColumn[] = loaded.products.map((product) => ({
    id: product.id,
    slug: product.slug,
    name: product.name,
    businessSlug: product.businessSlug,
    seller: product.seller,
    verificationTier: product.verificationTier,
    verifiedAt: product.verifiedAt ? product.verifiedAt.toISOString() : null,
    imageUrl: product.imagePath ? publicUrl(MEDIA_BUCKET, product.imagePath) : null,
  }));

  const comparison = buildComparison(loaded.fields, loaded.products, {
    availability: t("compare.row_availability"),
    reply: t("compare.row_reply"),
    completeness: t("compare.row_completeness"),
  });
  /* A single column matches itself on every row; hiding them would hide the table. */
  const hiding = hideMatching && columns.length >= 2;
  const rows = visibleRows(comparison, hiding);

  const set = columns.map((column) => column.id);
  const base = compareHref(set);
  const toggleHref = hideMatching ? base : `${base}${set.length > 0 ? "&" : "?"}diff=1`;

  /*
     `Ask all 4 for a quote` — `Q5`. One enquiry, the fan-out's own record: each
     column's seller pinned, each column's product a matched line. Two columns
     from one seller pin that seller once and still carry both products.
  */
  const sellers = [...new Set(columns.map((column) => column.businessSlug))];
  const askAllHref = `/rfq/new?to=${sellers.map(encodeURIComponent).join(",")}&products=${set.join(",")}`;

  return (
    <PublicShell
      nav={
        <div className="print:hidden">
          <DirectoryNav />
        </div>
      }
      breadcrumb={
        <div className="print:hidden">
          <Breadcrumb
            label={t("gallery.breadcrumb_label")}
            items={[{ label: t("chrome.directory"), href: "/" }, { label: t("compare.page_title") }]}
          />
        </div>
      }
      footer={
        <div className="print:hidden">
          <DirectoryFooter />
        </div>
      }
    >
      {columns.length === 0 ? (
        <>
          <CompareNotices
            delisted={loaded.delisted}
            otherTrade={loaded.otherTrade}
            overflow={fromUrl.overflow}
            trade={trade}
          />
          <CompareEmpty />
        </>
      ) : (
        <>
          <CompareHeader
            columns={columns}
            trade={trade}
            hasTemplate={hasTemplate}
            hideMatching={hideMatching}
            toggleHref={toggleHref}
            askAllHref={askAllHref}
          />
          <CompareNotices
            delisted={loaded.delisted}
            otherTrade={loaded.otherTrade}
            overflow={fromUrl.overflow}
            trade={trade}
          />
          {columns.length === 1 && <CompareNeedsMore trade={trade} />}
          <ComparisonTable
            columns={columns}
            rows={rows}
            set={set}
            hideMatching={hideMatching}
            /*
               The caption names the region a screen reader lands in. With the
               matching rows hidden it says so — a table that silently holds
               six rows of eleven reads as a complete one.
            */
            caption={t(hiding ? "compare.caption_differs" : "compare.caption", {
              count: columns.length,
              formatted: formatCount(columns.length),
              trade,
            })}
          />
          <CompareSummary deciding={comparison.deciding} hasTemplate={hasTemplate} />
        </>
      )}
    </PublicShell>
  );
}
