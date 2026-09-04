import { Card } from "@/components/structure";
/*
   `Eyebrow`, not a hand-rolled `text-faint` heading.

   `--text-faint` measures 2.56:1 on paper against a 4.5:1 floor and is one of
   the ten pairings docs/contrast.md has pinned rather than shipped. The
   component resolves to `--text-muted` for exactly that reason, and a new
   surface does not get to add nodes to that list.
*/
import { Eyebrow, RatingMarks } from "@/components/display";
import { formatCount, formatRating } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ReviewSummary } from "@/lib/db/queries";

/**
 * Board 1m section 3 — the 308px summary column.
 *
 * Three cards, and the order is the argument. The rating first because it is
 * what a buyer came for; the four dimensions second because "strong on
 * responsiveness, weak on lead times" is more use than one aggregate; the
 * provenance card third and above the fold, because it is the reason to believe
 * the first two.
 */

/** Below this the distribution is suppressed. Three reviews are not a shape. */
export const DISTRIBUTION_MIN = 5;

export function RatingCard({ summary }: { summary: ReviewSummary }) {
  const average = summary.average ?? 0;
  const thin = summary.count < DISTRIBUTION_MIN;

  return (
    <Card>
      <Eyebrow as="h2">{t("reviewpage.overall_heading")}</Eyebrow>

      <p className="mt-1 font-serif text-display tabular-nums text-brand-ink">
        {formatRating(average)}
      </p>

      <div className="mt-1.5">
        <RatingMarks value={average} label={t("reviewpage.rating_label", { rating: formatRating(average) })} />
      </div>

      {/*
         Under five reviews the count is stated in mono and the bars are gone.
         Board 1m: three reviews do not make a distribution, and drawing one
         implies more data than exists. The mono treatment is the same one the
         rest of the system uses for a machine-authored figure, which is what
         this is.
      */}
      {thin ? (
        <p className="mt-2 font-mono text-eyebrow uppercase tabular-nums text-muted">
          {t("reviewpage.from_count", {
            count: summary.count,
            formatted: formatCount(summary.count),
          })}
        </p>
      ) : (
        <p className="mt-2 text-caption text-muted">
          {t("reviewpage.count", { count: summary.count, formatted: formatCount(summary.count) })}
        </p>
      )}

      {!thin && <Distribution summary={summary} />}
    </Card>
  );
}

/**
 * 5 → 1, with mono counts and moss bars.
 *
 * Below 768 it collapses behind a disclosure — a `<details>` rather than a
 * scripted toggle, because it has to work on the first paint and because the
 * open/closed state is exactly what the element is for.
 */
function Distribution({ summary }: { summary: ReviewSummary }) {
  const rows = (
    <ul className="mt-3 flex flex-col gap-1.5">
      {summary.distribution.map((row) => {
        const share = summary.count === 0 ? 0 : row.count / summary.count;
        return (
          <li key={row.rating} className="flex items-center gap-2">
            <span className="w-3 shrink-0 font-mono text-eyebrow tabular-nums text-muted">
              {row.rating}
            </span>
            <span
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-pill bg-fill"
              aria-hidden="true"
            >
              <span
                className="block h-full rounded-pill bg-moss"
                style={{ inlineSize: `${(share * 100).toFixed(1)}%` }}
              />
            </span>
            <span className="w-8 shrink-0 text-end font-mono text-eyebrow tabular-nums text-muted">
              {formatCount(row.count)}
            </span>
            <span className="sr-only">
              {t("reviewpage.distribution_count", {
                formatted: formatCount(row.count),
                total: formatCount(summary.count),
                rating: row.rating,
              })}
            </span>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <div className="hidden md:block">
        <h3 className="sr-only">{t("reviewpage.distribution_heading")}</h3>
        {rows}
      </div>
      <details className="group mt-3 md:hidden">
        <summary className="cursor-pointer list-none rounded-tag text-body-sm font-medium text-moss focus-visible:shadow-focus focus-visible:outline-none">
          {t("reviewpage.see_breakdown")}
        </summary>
        {rows}
      </details>
    </>
  );
}

/**
 * The four dimensions with their own averages.
 *
 * These are the four things a UAE trade buyer gets burned on, and separating
 * them is more useful than one aggregate: a seller strong on responsiveness and
 * weak on lead times should read as exactly that rather than as 3.9.
 */
const DIMENSION_LABEL = {
  quotedAccurate: "storefront.rating_quoted",
  onTime: "storefront.rating_on_time",
  asDescribed: "storefront.rating_described",
  responsiveness: "storefront.rating_responsive",
} as const;

export function RatedOnCard({ summary }: { summary: ReviewSummary }) {
  return (
    <Card>
      <Eyebrow as="h2">{t("reviewpage.rated_on")}</Eyebrow>
      <dl className="mt-3 flex flex-col gap-2.5">
        {summary.dimensions.map((dimension) => {
          const value = dimension.average ?? 0;
          return (
            <div key={dimension.key} className="flex items-center justify-between gap-3">
              <dt className="min-w-0 text-body-sm text-body">
                {t(DIMENSION_LABEL[dimension.key])}
              </dt>
              <dd className="flex shrink-0 items-center gap-2">
                <RatingMarks
                  value={value}
                  size="sm"
                  label={t("reviewpage.rating_label", { rating: formatRating(value) })}
                />
                <span className="w-5 text-end font-mono text-eyebrow tabular-nums text-muted">
                  {formatRating(value)}
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

/**
 * The page's argument, in the column rather than in a footer.
 *
 * A buyer deciding whether to believe a 4.6 needs to know what it took to put a
 * number on this page at all. Putting that below the fold, or in small print
 * under the list, is putting the answer after the question.
 */
export function ProvenanceCard() {
  return (
    <section className="rounded-card border border-line bg-paper-sunk p-4">
      <Eyebrow as="h2">{t("reviewpage.provenance_title")}</Eyebrow>
      <p className="mt-2 text-body-sm text-body">{t("reviewpage.provenance_body")}</p>
      <p className="mt-2 text-caption text-muted">{t("reviewpage.provenance_removal")}</p>
    </section>
  );
}
