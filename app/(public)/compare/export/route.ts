import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { productComparisonCsv } from "@/lib/compare/export";
import { buildComparison } from "@/lib/compare/table";
import { COMPARE_COOKIE, idsFromParam, parseTray } from "@/lib/compare/tray";
import { loadComparison } from "@/lib/db/queries/compare";
import { t } from "@/lib/i18n";

/**
 * Board `10d` — the comparison as a CSV, on the one exporter board `1n` defined
 * for both comparisons.
 *
 * The same set the page shows: the products the address names, or the tray's
 * when it names none. Public data only — specs, availability, measured reply
 * times — and no price, because a product has none. Not cached anywhere: the
 * answer depends on the visitor's own tray cookie.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const named = params.getAll("p");
  const fromUrl = idsFromParam(named.length > 1 ? named : named[0]);
  const tray = parseTray((await cookies()).get(COMPARE_COOKIE)?.value);
  const ids = fromUrl.ids.length > 0 ? fromUrl.ids : tray.items.map((item) => item.id);

  const loaded = await loadComparison(ids);
  if (loaded.products.length === 0) {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }

  const comparison = buildComparison(loaded.fields, loaded.products, {
    availability: t("compare.row_availability"),
    reply: t("compare.row_reply"),
    completeness: t("compare.row_completeness"),
  });
  const { filename, csv } = productComparisonCsv({
    trade: loaded.trade?.name ?? "",
    columns: loaded.products.map((product) => ({ name: product.name, seller: product.seller })),
    comparison,
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
