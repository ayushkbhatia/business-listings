import { PipelineScreen } from "../../_pipeline";

/**
 * Board 3k §1 — the pipeline with one row's extend dialog already open.
 *
 * This is the target of board 3a's `Extend` queue action. That button is drawn
 * in 3a's export and is not in the shipped overview yet, so nothing points here
 * today — the route ships anyway, because the alternative is 3a landing a link
 * on a 404 the day somebody adds it, and because a seller can reach it from the
 * expiring card in the meantime.
 */
export const metadata = { title: "Quotes sent" };
export const dynamic = "force-dynamic";

export default async function ExtendQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ ref }, search] = await Promise.all([params, searchParams]);
  return <PipelineScreen search={search} highlightRef={decodeURIComponent(ref)} openExtend />;
}
