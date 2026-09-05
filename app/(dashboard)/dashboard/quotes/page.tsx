import { PipelineScreen } from "./_pipeline";

/**
 * Board 3k — quotes sent, the pipeline.
 *
 * What leaves board 3j. The composer sets a price and a validity window; this is
 * where the seller watches those windows run down and does the two things that
 * keep a quote alive — extend it, or spend the one follow-up.
 *
 * `force-dynamic` because every window is measured from now, and a pipeline
 * cached for sixty seconds is a pipeline whose "3 days left" is sixty seconds
 * wrong on the one screen that exists to count days.
 */
export const metadata = { title: "Quotes sent" };
export const dynamic = "force-dynamic";

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <PipelineScreen search={await searchParams} />;
}
