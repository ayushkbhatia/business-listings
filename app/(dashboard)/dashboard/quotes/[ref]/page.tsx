import { PipelineScreen } from "../_pipeline";
import { t } from "@/lib/i18n";

/**
 * Board 3k §1 — `/dashboard/quotes/:ref` highlights that row.
 *
 * A real route rather than a fragment, so the link a seller sends a colleague
 * survives being pasted, and so the row is selected on the server rather than by
 * a script that runs after the page has already been read.
 *
 * `:ref` is the quote reference — `QT-8841-ALMR2` — because that is the string
 * both sides say on the phone. A cuid here would be a link nobody can check.
 */
export const metadata = { title: t("quotes.title") };
export const dynamic = "force-dynamic";

export default async function QuoteRowPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ ref }, search] = await Promise.all([params, searchParams]);
  return <PipelineScreen search={search} highlightRef={decodeURIComponent(ref)} />;
}
