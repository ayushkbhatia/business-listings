import { Inbox } from "../_inbox";

/**
 * Board 3j — one lead selected, and the quote composer on it.
 *
 * The same screen as `/dashboard/leads` with a selection, rendered by the same
 * component so the rail cannot differ between them.
 *
 * A real route rather than a query parameter on the list: the seller sends this
 * URL to the colleague they are asking about a price, and a master-detail pane
 * whose selection lives in component state gives them nothing to send.
 */
export const metadata = { title: "Leads & RFQ" };
export const dynamic = "force-dynamic";

export default async function LeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  return <Inbox selectedId={id} search={search} />;
}
