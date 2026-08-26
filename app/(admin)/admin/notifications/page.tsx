import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { templateLibrary } from "@/lib/notify/templates";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { promote, saveDraft } from "./actions";
import { TemplateEditor, type TemplateRowView } from "./TemplateEditor";

/**
 * Board 12g — notification templates.
 *
 * An editor over a mechanism that already sends. `taxonomy.write` gates it,
 * the same capability that governs the other thing staff author which changes
 * what every seller sees.
 */

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const [library, badges] = await Promise.all([templateLibrary(), getAdminNavBadges(seat)]);

  const rows: TemplateRowView[] = library.map((entry) => ({
    id: entry.id,
    event: entry.event,
    channel: entry.channel,
    version: entry.version,
    status: entry.status,
    subject: entry.subject,
    body: entry.body,
    actionLabel: entry.actionLabel,
    actionPath: entry.actionPath,
    metaTemplateName: entry.metaTemplateName,
    unknown: entry.unknown,
    available: [...entry.available],
    emitted: entry.emitted,
  }));

  const live = rows.filter((row) => row.status === "live").length;
  const events = new Set(rows.map((row) => row.event));
  const dormant = new Set(rows.filter((row) => !row.emitted).map((row) => row.event));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/notifications"
      title={t("notifications.title")}
      eyebrow={t("notifications.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("notifications.meta", {
            live: formatCount(live),
            events: formatCount(events.size),
            dormant: formatCount(dormant.size),
          })}
        </span>
      }
    >
      <TemplateEditor rows={rows} save={saveDraft} promote={promote} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("notifications.note")}
      </p>
    </AdminPage>
  );
}
