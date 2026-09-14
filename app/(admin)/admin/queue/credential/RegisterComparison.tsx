import { Alert, StatusBadge } from "@/components/display";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { Cell, ComparisonView, CertificateView } from "./view";

/**
 * Board `4c-s` — what they submitted, against the FTA public register.
 *
 * A real table, because it is one: four rows of two values and a verdict. The
 * board draws two side-by-side cards with the verdict inline, and a screen
 * reader walking two cards hears every submitted value, then every register
 * value, and has to hold the first list in their head to compare. Row headers
 * make "Registered name — Nexus Tax Consultancy LLC — Nexus Tax Consultancy
 * L.L.C. — Match" one sentence.
 *
 * The trade licence row is in its own `tbody`, headed as the cross-check it is.
 * It is the join, not one of the three, and the tally under the table counts
 * the three — the export's "three fields, four ticks" correction, kept in the
 * markup rather than only in the copy.
 *
 * Presentational and hook-free: the words arrive from `comparisonView`, so the
 * gallery draws the same states from the fixture register.
 */

function CellValue({ cell }: { cell: Cell }) {
  if (cell.words) {
    return (
      <span className="text-body-sm text-ink">
        {cell.words.map((word, index) => (
          <span key={`${word.text}-${index}`}>
            {index > 0 && " "}
            {word.differs ? (
              <mark className="rounded-chip bg-warn-wash px-0.5 text-warn-ink underline decoration-dotted underline-offset-2">
                {word.text}
                <span className="sr-only"> {t("admin.credential_review.differs")}</span>
              </mark>
            ) : (
              word.text
            )}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className={cn("text-body-sm", cell.mono && "font-mono tabular-nums", cell.muted ? "text-faint" : "text-ink")}>
      {cell.text}
    </span>
  );
}

const BADGE_TONE = { ok: "ok", warn: "warn", bad: "bad", neutral: "neutral" } as const;

export function RegisterComparison({
  view,
  certificate,
  refetch,
}: {
  view: ComparisonView;
  certificate: CertificateView | null;
  /** The refetch control, where the read is missing, failed or stale. */
  refetch?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {view.notice && (
        <Alert
          tone={view.notice.tone}
          {...(view.notice.fix ? { fix: view.notice.fix } : {})}
          {...(view.needsRefetch && refetch ? { action: refetch } : {})}
        >
          {view.notice.body}
        </Alert>
      )}

      {view.rows.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full min-w-[40rem] border-collapse text-start">
            <caption className="sr-only">{t("admin.credential_review.table_caption")}</caption>
            <thead className="bg-paper-sunk">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-start font-mono text-eyebrow font-normal uppercase text-faint">
                  {t("admin.credential_review.col.field")}
                </th>
                <th scope="col" className="px-4 py-2.5 text-start font-mono text-eyebrow font-normal uppercase text-faint">
                  {t("admin.credential_review.col.submitted")}
                </th>
                <th scope="col" className="px-4 py-2.5 text-start font-mono text-eyebrow font-normal uppercase text-faint">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>{t("admin.credential_review.col.register")}</span>
                    {view.fetched && <span className="tabular-nums">{view.fetched}</span>}
                  </span>
                </th>
                <th scope="col" className="px-4 py-2.5 text-start font-mono text-eyebrow font-normal uppercase text-faint">
                  {t("admin.credential_review.col.result")}
                </th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.key} className="border-t border-line align-top">
                  <th scope="row" className="px-4 py-3 text-start text-caption font-normal text-muted">
                    {row.field}
                  </th>
                  <td className="px-4 py-3">
                    <CellValue cell={row.submitted} />
                  </td>
                  <td className="px-4 py-3">
                    <CellValue cell={row.register} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={BADGE_TONE[row.result.tone]} size="sm" shape="chip">
                      {row.result.label}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
            {view.entity && (
              <tbody className="border-t-2 border-line-strong">
                <tr className="align-top">
                  <th scope="row" className="px-4 py-3 text-start font-normal">
                    <span className="block text-caption text-muted">{t("admin.credential_review.field.entity")}</span>
                    <span className="block text-eyebrow text-faint">{t("admin.credential_review.field.entity_note")}</span>
                  </th>
                  <td className="px-4 py-3">
                    <CellValue cell={view.entity.submitted} />
                  </td>
                  <td className="px-4 py-3">
                    <CellValue cell={view.entity.register} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={BADGE_TONE[view.entity.result.tone]} size="sm" shape="chip">
                      {view.entity.result.label}
                    </StatusBadge>
                  </td>
                </tr>
              </tbody>
            )}
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {view.tally && <p className="text-caption text-muted">{view.tally}</p>}
        <p className="text-caption text-muted">
          {t("admin.credential_review.document.label")}{" "}
          {certificate ? (
            <a
              href={certificate.href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-tag border border-line bg-fill px-2 py-0.5 text-body underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {certificate.label}
            </a>
          ) : (
            <span className="text-faint">{t("admin.credential_review.document.none")}</span>
          )}
        </p>
      </div>

      {!view.notice && view.needsRefetch && refetch}
    </div>
  );
}
