import Link from "next/link";
import { notFound } from "next/navigation";
import { Tabs } from "@/components/structure";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { crmBoard, tabFrom, CRM_TABS } from "@/lib/crm/board";
import { cn } from "@/lib/cn";
import { t, type MessageKey } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { CallBoard } from "./CallBoard";
import { BuildCallList, RefreshSignals } from "./CrmControls";
import { presentCrm, type Tone } from "./present";

/**
 * Board 12d — recruitment and accounts: the call list, the upgrade pipeline and
 * the renewal-risk calls, over one table of tasks.
 *
 * Every row came from a demand signal, derived by `lib/crm/sync.ts` nightly or
 * on *Refresh signals*; there is no control on this page that adds one. The
 * banner is the held page with the most searches behind it, stated so each of
 * its numbers derives from the others, and it says what recruiting cannot do.
 *
 * Ops lead and moderator only (B11). A finance seat gets the console's 404.
 *
 * Three tabs where the render drew four. The fourth, *Users*, is a label three
 * screens already claim and nothing on the board says what it would list — the
 * handoff's Q2. It is left out rather than guessed at.
 */

export const dynamic = "force-dynamic";

const TONE: Record<Tone, string> = { bad: "text-bad-ink", warn: "text-warn-ink", ok: "text-ok-ink", neutral: "text-ink" };

export default async function CrmPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const seat = await requireStaff();
  if (!can(seat.actor, "crm.work")) notFound();

  const now = new Date();
  const { tab: requested } = await searchParams;
  const tab = tabFrom(requested);
  const [board, badges] = await Promise.all([crmBoard(seat.actor, tab, now), getAdminNavBadges(seat)]);
  const view = presentCrm(board, now);

  const listHeader = (
    <>
      <div className="flex items-center gap-2">
        <h2 className="text-h2 text-ink">{view.listTitle}</h2>
        <span className="rounded-pill bg-fill px-2 py-0.5 text-caption tabular-nums text-body">{view.listCount}</span>
      </div>
      <p className="text-caption text-muted">{t("admin.crm.sorted")}</p>
    </>
  );

  const rail = (
    <>
      <div className="rounded-panel border border-line bg-card p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-mono text-eyebrow font-normal uppercase text-faint">{t("admin.crm.week.title")}</h2>
          <span className="text-caption text-muted">{view.week.since}</span>
        </div>
        <dl className="mt-3 flex flex-col gap-2.5">
          {view.week.lines.map((line) => (
            <div key={line.key} className="flex items-baseline justify-between gap-3">
              <dt className="text-body-sm text-body">{line.label}</dt>
              <dd className={cn("m-0 text-body-sm tabular-nums", TONE[line.tone])}>{line.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="rounded-panel border border-line bg-fill p-4">
        <h2 className="text-body-sm font-medium text-ink">{t("admin.crm.builds_itself.title")}</h2>
        <p className="mt-2 text-body-sm text-body">{t("admin.crm.builds_itself.body")}</p>
        <p className="mt-2 text-caption text-muted">{view.refreshed}</p>
      </div>
    </>
  );

  const empty = (
    <div className="text-center">
      <p className="text-body-sm text-body">{view.empty.title}</p>
      <p className="mx-auto mt-1 max-w-prose text-caption text-muted">{view.empty.body}</p>
      {view.empty.neverRun ? (
        <div className="mt-3 flex justify-center">
          <RefreshSignals primary />
        </div>
      ) : null}
    </div>
  );

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/crm"
      title={t("admin.crm.title")}
      eyebrow={t("admin.crm.eyebrow")}
      meta={<span className="text-caption text-muted">{view.headerCounts}</span>}
      actions={<RefreshSignals />}
    >
      <div className="mb-[var(--gutter)]">
        <Tabs
          as="a"
          label={t("admin.crm.tabs")}
          active={tab}
          items={CRM_TABS.map((key) => ({
            key,
            label: t(`admin.crm.tab.${key}` as MessageKey),
            href: key === "calls" ? "/admin/crm" : `/admin/crm?tab=${key}`,
            badge: board.tabCounts[key],
          }))}
        />
      </div>

      {view.banner ? (
        <div className="mb-[var(--gutter)] rounded-panel border border-warn-line bg-warn-surface p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 max-w-prose">
              <p className="font-mono text-eyebrow uppercase text-warn-ink">{t("admin.crm.banner.label")}</p>
              <h2 className="mt-1 text-h2 text-warn-ink">{view.banner.title}</h2>
              <p className="mt-1 text-body-sm text-warn-ink">{view.banner.body}</p>
              <p className="mt-1 text-body-sm text-warn-ink">{view.banner.other}</p>
              <p className="mt-2 text-caption text-warn-ink">
                {view.banner.mineNote ? `${view.banner.mineNote} ` : ""}
                {view.moreHeldScopes ? `${view.moreHeldScopes} ` : ""}
                <Link href={view.banner.matrixHref} className="underline underline-offset-2">
                  {t("admin.crm.banner.matrix")}
                </Link>
              </p>
            </div>
            {view.banner.canBuild ? <BuildCallList signalRef={view.banner.signalRef} label={view.banner.buildLabel} /> : null}
          </div>
        </div>
      ) : null}

      {view.tabNote ? <p className="mb-[var(--gutter)] max-w-prose text-body-sm text-body">{view.tabNote}</p> : null}

      <CallBoard rows={view.rows} caption={t("admin.crm.caption")} rail={rail} listHeader={listHeader} empty={empty} />

      {view.heldByOthers ? <p className="mt-2 text-caption text-muted">{view.heldByOthers}</p> : null}
    </AdminPage>
  );
}
