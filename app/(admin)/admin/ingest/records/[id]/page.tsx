import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/display";
import { Panel } from "@/components/structure";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { REJECTION_ACTION } from "@/lib/ingest/classify";
import { categoryOptions, queuedRecordCount } from "@/lib/ingest/queue";
import { recordDetail } from "@/lib/ingest/read";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { EMIRATES } from "@/lib/uae";
import { AdminPage, getAdminNavBadges } from "../../../../_shell";
import { categorise } from "../../actions";
import { IngestTabs } from "../../IngestTabs";
import { RecordCategorise } from "./RecordCategorise";

/**
 * Board 12a — one staged record.
 *
 * The build plan's "a screen that renders a staged row". Three questions, in
 * the order somebody arrives with them: what did the registry send (the raw
 * row, verbatim — B5), what did the importer make of it, and what happens to
 * it now. A record in an open run can be given a category, or a different one,
 * from here; a record whose phrase is wrong for it is the case the queue's
 * grouping cannot serve.
 */

export const dynamic = "force-dynamic";

const EMIRATE_LABEL = new Map<string, string>(EMIRATES.map((e) => [e.value, e.label]));

const OUTCOME_TONE: Record<string, "ok" | "warn" | "bad" | "neutral" | "info"> = {
  ready: "info",
  needs_category: "warn",
  published: "ok",
  duplicate: "neutral",
  rejected: "bad",
};

export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const seat = await requireStaff();
  if (!can(seat.actor, "queue.decide")) notFound();

  const { id } = await params;
  const [record, queued, badges] = await Promise.all([
    recordDetail(id),
    queuedRecordCount(),
    getAdminNavBadges(seat),
  ]);
  if (!record) notFound();

  const options = record.open ? await categoryOptions() : [];
  const missing = <span className="text-body">{t("admin.records.not_provided")}</span>;

  const read: { key: string; label: string; value: React.ReactNode; mono?: boolean }[] = [
    { key: "name", label: t("admin.record.field.name"), value: record.licenceName ?? missing },
    { key: "licence", label: t("admin.record.field.licence"), value: record.licenceNumber ?? missing, mono: true },
    {
      key: "authority",
      label: t("admin.record.field.authority"),
      value: record.licenceAuthority ?? record.run.source,
      mono: true,
    },
    {
      key: "expiry",
      label: t("admin.record.field.expiry"),
      value: record.licenceExpiry ? formatDate(record.licenceExpiry) : missing,
    },
    {
      key: "emirate",
      label: t("admin.record.field.emirate"),
      value: record.emirate ? (EMIRATE_LABEL.get(record.emirate) ?? record.emirate) : missing,
    },
    { key: "area", label: t("admin.record.field.area"), value: record.areaName ?? missing },
    { key: "activity", label: t("admin.record.field.activity"), value: record.activity ?? missing },
    { key: "phone", label: t("admin.record.field.phone"), value: record.phone ?? missing, mono: true },
  ];

  const link =
    "rounded-tag text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none";

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/ingest"
      title={t("admin.record.title", { row: record.rowNumber, number: record.run.number })}
      eyebrow={t("admin.record.eyebrow")}
      breadcrumb={
        <Link
          href={`/admin/ingest/${record.run.id}`}
          className="rounded-tag text-caption text-body underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("admin.record.back", { number: record.run.number })}
        </Link>
      }
      meta={
        <StatusBadge tone={OUTCOME_TONE[record.disposition] ?? "neutral"}>
          {t(`admin.records.outcome.${record.disposition as "ready"}`)}
        </StatusBadge>
      }
    >
      <IngestTabs active="runs" queued={queued} showDedupe={can(seat.actor, "business.merge")} />

      <div className="mt-[var(--gutter)] grid gap-[var(--gutter)] lg:grid-cols-2">
        <Panel title={t("admin.record.outcome_title")}>
          <div className="flex flex-col gap-3 text-body-sm text-body">
            {record.rejectionGround && (
              <p>
                {t("admin.record.rejected_because", {
                  ground: t(`admin.run.ground.${record.rejectionGround}`),
                  action: t(`admin.run.action.${REJECTION_ACTION[record.rejectionGround]}`),
                })}
              </p>
            )}

            {record.disposition === "duplicate" && (
              <div className="flex flex-col gap-1">
                {record.duplicateOf && (
                  <p>
                    {t("admin.record.duplicate_of")}{" "}
                    {record.duplicateOf.publishedAt ? (
                      <Link href={`/b/${record.duplicateOf.slug}`} className={link}>
                        {record.duplicateOf.displayName}
                      </Link>
                    ) : (
                      <span className="text-ink">{record.duplicateOf.displayName}</span>
                    )}
                  </p>
                )}
                {record.duplicateRow && (
                  <p>
                    <Link href={`/admin/ingest/records/${record.duplicateRow.id}`} className={link}>
                      {t("admin.record.duplicate_row", { row: record.duplicateOfRow ?? "" })}
                    </Link>
                  </p>
                )}
                <p className="text-caption">{t("admin.record.duplicate_note")}</p>
              </div>
            )}

            {record.business && (
              <p>
                {t("admin.record.published_as")}{" "}
                {record.business.publishedAt ? (
                  <Link href={`/b/${record.business.slug}`} className={link}>
                    {record.business.displayName}
                  </Link>
                ) : (
                  <>
                    <span className="text-ink">{record.business.displayName}</span>{" "}
                    <span className="text-caption">({t("admin.record.not_live")})</span>
                  </>
                )}
              </p>
            )}

            {record.open && record.held.length > 0 && (
              <div>
                <p>{t("admin.record.held_title")}</p>
                <ul className="mt-1 list-disc ps-5">
                  {record.held.map((reason) => (
                    <li key={reason}>{t(`admin.records.held.${reason}`)}</li>
                  ))}
                </ul>
              </div>
            )}
            {record.open && record.held.length === 0 && <p>{t("admin.record.ready")}</p>}

            {!record.open && record.run.status !== "staged" && record.run.status !== "approved" && (
              <p className="text-caption">
                {t("admin.record.closed", {
                  number: record.run.number,
                  status: t(`admin.ingest.status.${record.run.status as "staged"}`).toLowerCase(),
                })}
              </p>
            )}
          </div>
        </Panel>

        <Panel title={t("admin.record.category_title")}>
          <div className="flex flex-col gap-3 text-body-sm text-body">
            {record.category ? (
              <div className="flex flex-col gap-1">
                <p className="text-ink">{record.category.name}</p>
                {record.tradeKind && (
                  <p className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={record.tradeKind.kind === "services" ? "info" : "neutral"}>
                      {t(`admin.categorise.kind.${record.tradeKind.kind}`)}
                    </StatusBadge>
                    {record.tradeKind.from === "inherited" && record.tradeKind.inheritedFrom && (
                      <span className="text-caption">
                        {t("admin.categorise.kind_inherited", {
                          category: record.category.name,
                          kind: t(`admin.categorise.kind_word.${record.tradeKind.kind}`),
                          ancestor: record.tradeKind.inheritedFrom,
                        })}
                      </span>
                    )}
                  </p>
                )}
                {record.categorySource && (
                  <p className="text-caption">
                    {record.categorySource === "staff"
                      ? t("admin.record.source.staff", {
                          name: record.categorisedBy?.fullName ?? t("admin.run.someone"),
                          date: record.categorisedAt ? formatDate(record.categorisedAt) : "",
                        })
                      : t(`admin.record.source.${record.categorySource}`)}
                  </p>
                )}
              </div>
            ) : (
              <p>{t("admin.record.category_none")}</p>
            )}

            {record.mapping && (
              <p className="text-caption">
                {t("admin.record.remembered", { category: record.mapping.categoryName })}
              </p>
            )}

            {record.open && (
              <RecordCategorise
                recordId={record.id}
                label={record.activity ?? t("admin.categorise.no_activity")}
                hasCategory={record.category !== null}
                categoryId={record.category?.id ?? null}
                options={options}
                categorise={categorise}
              />
            )}
          </div>
        </Panel>
      </div>

      <div className="mt-[var(--gutter)] grid gap-[var(--gutter)] lg:grid-cols-2">
        <Panel title={t("admin.record.read_title")}>
          <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-body-sm">
            {read.map((item) => (
              <div key={item.key} className="contents">
                <dt className="text-body">{item.label}</dt>
                <dd className={item.mono ? "font-mono text-ink" : "text-ink"}>{item.value}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel title={t("admin.record.raw_title")}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body-sm">
              <caption className="sr-only">{t("admin.record.raw_caption")}</caption>
              <thead className="bg-paper-sunk">
                <tr>
                  <th scope="col" className="px-2 py-1.5 text-start font-mono text-eyebrow uppercase text-body">
                    {t("admin.record.raw_col.column")}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-start font-mono text-eyebrow uppercase text-body">
                    {t("admin.record.raw_col.value")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {record.raw.map(([header, value]) => (
                  <tr key={header} className="border-t border-line">
                    <th scope="row" className="px-2 py-1.5 text-start align-top font-normal text-body">
                      {header}
                    </th>
                    <td className="break-words px-2 py-1.5 font-mono text-ink">
                      {value === "" ? <span className="font-sans text-body">{t("admin.record.raw_empty")}</span> : value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </AdminPage>
  );
}
