import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { CompletenessMeter } from "@/components/domain";
import { Card, Panel } from "@/components/structure";
import { setupStateFor, type Task } from "@/lib/onboarding/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";

/**
 * Board 8a — the setup hub.
 *
 * Criterion 4: four tasks, independent, resumable, each returning here with the
 * strength updated. Completion is derived from the rows each task creates, so
 * a seller who adds photographs from the media library gets the same credit and
 * nothing can be marked done except by the work being there.
 *
 * Every card says what the task is worth in percentage points and how long it
 * takes. "Complete your profile" tells nobody anything, and the estimates are
 * from the work rather than from optimism — twenty-five minutes for ten
 * products is what ten products actually take.
 */
export const metadata = { title: "Finish setting up" };
export const dynamic = "force-dynamic";

const HREF: Record<Task, string> = {
  photos: "/dashboard/media",
  products: "/dashboard/products",
  team: "/dashboard/team",
  visit: "/dashboard/setup/visit",
};

export default async function SetupPage() {
  const seat = await requireSellerSeat();
  const [state, badges] = await Promise.all([
    setupStateFor(seat.businessId),
    getNavBadges(seat.businessId),
  ]);

  const remaining = state.tasks.filter((task) => !task.done);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/setup"
      eyebrow={t("setup.eyebrow")}
      title={t("setup.title")}
    >
      <div className="flex flex-col gap-5">
        <p className="max-w-prose text-body-sm text-muted">{t("setup.intro")}</p>

        <Card padded>
          <CompletenessMeter
            filled={state.strength}
            total={100}
            valueLabel={`${state.strength}%`}
            label={t("setup.strength")}
          />
          <p className="mt-1.5 text-caption text-muted">{t("setup.threshold_note")}</p>
        </Card>

        {remaining.length === 0 ? (
          <Panel title={t("setup.all_done")}>
            <p className="max-w-prose text-body-sm text-muted">{t("setup.all_done_body")}</p>
            <Link href="/dashboard" className={`${buttonClassName({ size: "sm" })} mt-3`}>
              {t("setup.to_dashboard")}
            </Link>
          </Panel>
        ) : (
          <ul className="flex flex-col gap-3">
            {state.tasks.map((task) => (
              <li
                key={task.task}
                className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-line bg-card p-4"
              >
                <div className="min-w-0">
                  <span className="block text-body-sm text-ink">
                    {t(`setup.task.${task.task}` as never)}
                  </span>
                  <span className="mt-0.5 block max-w-prose text-caption text-muted">
                    {t(`setup.task.${task.task}_body` as never)}
                  </span>
                  <span className="mt-1.5 block font-mono text-eyebrow uppercase text-faint">
                    {task.points > 0
                      ? t("setup.worth", { points: String(task.points) })
                      : t("setup.worth_none")}
                    {" · "}
                    {t("setup.minutes", { n: String(task.minutes) })}
                    {" · "}
                    {t("setup.progress", {
                      got: formatCount(task.progress.got),
                      target: formatCount(task.progress.target),
                    })}
                  </span>
                </div>

                <Link
                  href={HREF[task.task]}
                  className={buttonClassName({
                    variant: task.done ? "ghost" : "secondary",
                    size: "sm",
                  })}
                >
                  {task.done
                    ? t("setup.done")
                    : task.progress.got > 0
                      ? t("setup.resume")
                      : t("setup.start")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SellerPage>
  );
}
