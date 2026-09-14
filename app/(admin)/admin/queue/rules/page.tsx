import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { prisma } from "@/lib/db/client";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { readRules } from "@/lib/moderation/queue";
import { RULES_SETTING_KEY } from "@/lib/moderation/rules";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { apply, preview } from "./actions";
import { RulesForm } from "./RulesForm";

/**
 * Board 4b — `/admin/queue/rules`, the lever that moves the pass rate.
 *
 * Ops lead alone (`queue.rules`). Q4 stays open on this screen by design: the
 * preview says what a change does to the pass rate and the bulk set, and the
 * reason field is where the person moving it says why that trade is right.
 */

export const dynamic = "force-dynamic";

export default async function QueueRulesPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "queue.rules")) notFound();

  const [rules, setting, badges] = await Promise.all([
    readRules(),
    prisma.platformSetting.findUnique({
      where: { key: RULES_SETTING_KEY },
      select: { updatedAt: true, updatedBy: { select: { fullName: true } } },
    }),
    getAdminNavBadges(seat),
  ]);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/queue"
      title={t("admin.queue_rules.title")}
      eyebrow={t("admin.queue.eyebrow")}
      breadcrumb={
        <Link
          href="/admin/queue"
          className="rounded-tag text-caption text-muted underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("admin.review.back")}
        </Link>
      }
      meta={
        <span className="text-caption text-muted">
          {setting
            ? t("admin.queue_rules.last_changed", {
                date: formatDate(setting.updatedAt),
                name: setting.updatedBy?.fullName ?? t("admin.run.someone"),
              })
            : t("admin.queue_rules.defaults")}
        </span>
      }
    >
      <p className="mb-[var(--gutter)] max-w-prose text-body-sm text-body">{t("admin.queue_rules.intro")}</p>
      <RulesForm rules={rules} preview={preview} apply={apply} />
    </AdminPage>
  );
}
