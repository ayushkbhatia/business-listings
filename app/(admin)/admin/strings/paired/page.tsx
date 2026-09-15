import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { t } from "@/lib/i18n";
import { templateBoard } from "@/lib/notify/templates";
import { pairedBoard } from "@/lib/strings/service";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { StringsTabs } from "../_tabs";
import { PairedStrings } from "./PairedStrings";
import { presentPaired, readPairedFilter } from "./present";

/**
 * Board `12g-s` — paired strings.
 *
 * The keys that carry a goods value and a services value, the boards that read
 * them, and the count of halves nobody has written — a query over the registry
 * and the rows, never a stored counter (`B3`). Each half can be written,
 * suppressed where the registry allows it, or restored to the code's words,
 * with a reason on the audit log.
 *
 * `strings.write`, ops lead only.
 */

export const dynamic = "force-dynamic";

export default async function PairedStringsPage({ searchParams }: { searchParams: Promise<{ show?: string | string[] }> }) {
  const seat = await requireStaff();
  if (!can(seat.actor, "strings.write")) notFound();

  const filter = readPairedFilter((await searchParams).show);
  const [board, templates, badges] = await Promise.all([pairedBoard(), templateBoard(), getAdminNavBadges(seat)]);
  const view = presentPaired(board, filter, templates.counts.owesTwin);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/strings"
      title={t("strings.title")}
      eyebrow={t("strings.eyebrow")}
      meta={<span className="font-mono text-eyebrow uppercase text-muted">{view.meta}</span>}
    >
      <StringsTabs active="paired" all={view.catalogueKeys} paired={view.pairedTotal} />
      <PairedStrings view={view} canWrite />
    </AdminPage>
  );
}
