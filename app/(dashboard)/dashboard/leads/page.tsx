import { Inbox } from "./_inbox";
import { t } from "@/lib/i18n";

/**
 * Board 3j — the leads and RFQ inbox.
 *
 * The rail with nothing selected. Every row is masked: a seller sees the
 * requirement and a first name, and the phone number, email and company name are
 * not in the payload at all until the buyer accepts. That decision is made in
 * lib/db/queries/seller-visibility.ts and this screen has no way to undo it.
 *
 * `force-dynamic` because the waiting bands are measured from now, and a lead
 * cached for sixty seconds is a lead whose overdue badge is sixty seconds wrong.
 */
export const metadata = { title: t("leads.title") };
export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Inbox selectedId={null} search={await searchParams} />;
}
