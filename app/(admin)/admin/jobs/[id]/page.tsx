import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { formatDateTime } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { runState, runTally } from "@/lib/jobs/health";
import { runDetail } from "@/lib/jobs/report";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { RunFacts, StepTable, cronHref, cronInSentence, cronName } from "../JobsView";

/**
 * Standing item 9.5 — one run, and every step it set out to take.
 *
 * The step table draws the whole plan, not only the steps that left a row:
 * a run that stopped half way shows the step it was on and each one it never
 * reached, in grey, rather than a shorter table that looks like a smaller job.
 * A step that threw shows what it threw, masked, with the stack left in the
 * function log where it always was.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: t("admin.jobs.title") };

export default async function JobRunPage({ params }: { params: Promise<{ id: string }> }) {
  const seat = await requireStaff();
  if (!can(seat.actor, "jobs.read")) notFound();

  const { id } = await params;
  const now = new Date();
  const [detail, badges] = await Promise.all([runDetail(id, now), getAdminNavBadges(seat)]);
  if (!detail) notFound();

  const { run, steps } = detail;
  const back = (
    <Link
      href={`${cronHref(run.cron)}#runs`}
      className="rounded-tag text-caption text-body underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
    >
      {t("admin.jobs.run.back", { cron: cronInSentence(run.cron) })}
    </Link>
  );

  if (!run.authorised) {
    return (
      <AdminPage
        seat={seat}
        badges={badges}
        activeHref="/admin/jobs"
        title={t("admin.jobs.run.refused_title", { cron: cronName(run.cron), date: formatDateTime(run.startedAt) })}
        eyebrow={t("admin.jobs.run.eyebrow")}
        breadcrumb={back}
      >
        <p className="max-w-prose rounded-panel border border-line bg-card px-4 py-4 text-body-sm text-bad-ink">
          {t("admin.jobs.run.refused_body", {
            reason: t(`admin.jobs.refusal.${run.refusal === "no_secret" ? "no_secret" : "wrong_secret"}` as MessageKey),
          })}
        </p>
      </AdminPage>
    );
  }

  const state = runState(run, now);
  const tally = runTally(run);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/jobs"
      title={t("admin.jobs.run.title", { cron: cronName(run.cron), date: formatDateTime(run.startedAt) })}
      eyebrow={t("admin.jobs.run.eyebrow")}
      breadcrumb={back}
    >
      <section aria-labelledby="run-facts">
        <h2 id="run-facts" className="mb-3 text-h2 text-ink">
          {t("admin.jobs.run.facts_title")}
        </h2>
        <div className="rounded-panel border border-line bg-card px-4 py-2">
          <RunFacts run={run} state={state} tally={tally} />
        </div>
      </section>

      <section aria-labelledby="run-steps" className="mt-[var(--section-pad)]">
        <h2 id="run-steps" className="mb-3 text-h2 text-ink">
          {t("admin.jobs.steps.title")}
        </h2>
        <StepTable steps={steps} caption={t("admin.jobs.steps.caption")} />
        <p className="mt-2 max-w-prose text-caption text-body">{t("admin.jobs.run.error_note")}</p>
      </section>
    </AdminPage>
  );
}
