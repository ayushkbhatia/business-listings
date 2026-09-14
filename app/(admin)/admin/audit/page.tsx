import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/display";
import { Button, Input, Select, buttonClassName } from "@/components/primitives";
import { requireStaff } from "@/lib/auth/staff";
import { actionLabel } from "@/lib/audit/describe";
import { auditActors, normaliseAuditFilter, readAuditPage, type AuditFilter } from "@/lib/audit/log";
import { auditActions } from "@/lib/reports/service";
import { formatCount, formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { AuditTable, type AuditRowData } from "./AuditTable";

/**
 * Board 4i — `/admin/audit`. The whole log, filtered and paged.
 *
 * §07: ops lead reads all of it, every other staff role reads **their own
 * actions**. `auditScopeFor` decides that inside `readAuditPage`, and the actor
 * filter is not offered to a viewer it could not apply to.
 *
 * The page shows fifty rows at a time and says which fifty of how many — the
 * "most recent 200" it replaced was a cap written into a header, and a log that
 * silently stopped at 200 is a log that silently loses the row somebody came
 * looking for. The export carries the filter on the page (states table, "Log
 * filtered"), and is the whole matching set rather than the page.
 *
 * No control on this page edits or deletes a row, and nothing could: the table
 * refuses UPDATE and DELETE by trigger (`B6`).
 */

export const dynamic = "force-dynamic";

type Params = Promise<Record<string, string | string[] | undefined>>;

function one(params: Record<string, string | string[] | undefined>, key: string): string | null {
  const value = params[key];
  return typeof value === "string" ? value : null;
}

function query(filter: AuditFilter, extra: Record<string, string> = {}): string {
  const search = new URLSearchParams();
  if (filter.actorId) search.set("actor", filter.actorId);
  if (filter.action) search.set("action", filter.action);
  if (filter.subject) search.set("subject", filter.subject);
  for (const [key, value] of Object.entries(extra)) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
}

export default async function AuditPage({ searchParams }: { searchParams: Params }) {
  const seat = await requireStaff();
  const params = await searchParams;

  const filter = normaliseAuditFilter({
    actor: one(params, "actor"),
    action: one(params, "action"),
    subject: one(params, "subject"),
  });
  // A non-ops viewer's scope is already themselves; an actor filter would be a
  // control that changes nothing, so it is neither offered nor kept in links.
  if (!seat.isOpsLead) delete filter.actorId;

  const [page, badges, actions, actors] = await Promise.all([
    readAuditPage(seat.actor, filter, { after: one(params, "after"), before: one(params, "before") }),
    getAdminNavBadges(seat),
    auditActions(seat.actor),
    seat.isOpsLead ? auditActors(seat.actor) : Promise.resolve([]),
  ]);
  if (!page) notFound();

  const filtered = Boolean(filter.actorId || filter.action || filter.subject);

  const rows: AuditRowData[] = page.entries.map((entry) => ({
    id: entry.id,
    when: formatDateTime(entry.at),
    headline: entry.headline,
    subject: entry.subject,
    subjectName: entry.subjectName,
    blast: entry.blast,
    reason: entry.reason,
    change: entry.change,
  }));

  const to = page.from === 0 ? 0 : page.from + rows.length - 1;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/audit"
      title={t("admin.audit.title")}
      eyebrow={t("admin.audit.eyebrow")}
      meta={
        <span className="text-caption text-body">
          {page.scope === "all"
            ? t("admin.audit.meta_all", { count: page.total, n: formatCount(page.total) })
            : t("admin.audit.meta_own", { count: page.total, n: formatCount(page.total) })}
        </span>
      }
      actions={
        <a
          href={`/admin/audit/export${query(filter)}`}
          download
          className={buttonClassName({ variant: "secondary" })}
        >
          {filtered ? t("admin.audit.export_filtered") : t("admin.audit.export")}
        </a>
      }
    >
      {page.scope === "own" ? (
        <div className="mb-[var(--gutter)]">
          <Alert tone="info">{t("admin.audit.scope_own")}</Alert>
        </div>
      ) : null}

      <form
        method="get"
        action="/admin/audit"
        role="search"
        aria-label={t("admin.audit.filter_label")}
        className="mb-[var(--gutter)] flex flex-wrap items-end gap-3 rounded-card border border-line bg-card p-3"
      >
        {seat.isOpsLead ? (
          <label className="flex min-w-48 flex-col gap-1">
            <span className="text-caption font-medium text-body">{t("admin.audit.filter.actor")}</span>
            <Select
              name="actor"
              defaultValue={filter.actorId ?? ""}
              options={[
                { value: "", label: t("admin.audit.filter.anyone") },
                ...actors.map((person) => ({ value: person.id, label: person.name })),
              ]}
            />
          </label>
        ) : null}
        <label className="flex min-w-56 flex-col gap-1">
          <span className="text-caption font-medium text-body">{t("admin.audit.filter.action")}</span>
          <Select
            name="action"
            defaultValue={filter.action ?? ""}
            options={[
              { value: "", label: t("admin.audit.filter.any_action") },
              ...actions.map((row) => ({
                value: row.action,
                label: t("admin.audit.filter.action_option", {
                  label: actionLabel(row.action),
                  count: formatCount(row.count),
                }),
              })),
            ]}
          />
        </label>
        <label className="flex min-w-56 flex-1 flex-col gap-1">
          <span className="text-caption font-medium text-body">{t("admin.audit.filter.subject")}</span>
          <Input
            name="subject"
            defaultValue={filter.subject ?? ""}
            placeholder={t("admin.audit.filter.subject_example")}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="secondary">
            {t("admin.audit.filter.apply")}
          </Button>
          {filtered ? (
            <Link href="/admin/audit" className={buttonClassName({ variant: "ghost" })}>
              {t("admin.audit.filter.clear")}
            </Link>
          ) : null}
        </div>
      </form>

      <AuditTable rows={rows} filtered={filtered} scope={page.scope} />

      <nav
        aria-label={t("admin.audit.pages_label")}
        className="mt-3 flex flex-wrap items-center justify-between gap-3"
      >
        <p className="text-caption text-body" aria-live="polite">
          {page.total === 0
            ? t("admin.audit.range_none")
            : t("admin.audit.range", {
                from: formatCount(page.from),
                to: formatCount(to),
                total: formatCount(page.total),
              })}
        </p>
        <span className="flex items-center gap-2">
          {page.newer ? (
            <Link
              href={`/admin/audit${query(filter, { before: page.newer })}`}
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              {t("admin.audit.newer")}
            </Link>
          ) : null}
          {page.older ? (
            <Link
              href={`/admin/audit${query(filter, { after: page.older })}`}
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              {t("admin.audit.older")}
            </Link>
          ) : null}
        </span>
      </nav>
    </AdminPage>
  );
}
