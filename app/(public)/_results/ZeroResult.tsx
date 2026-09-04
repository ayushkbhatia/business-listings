import { buttonClassName } from "@/components/primitives";
import { Card, Panel } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { toSearchParams, withoutFacet, type SearchQuery } from "@/lib/search/query";
import type { DropSuggestion } from "@/lib/db/queries";
import { crawlRel } from "@/lib/seo/crawl-policy";

/**
 * Board 10c. Zero results is a designed state, not a fallback.
 *
 * It does three things a bare "no results" cannot: it names the one filter
 * worth dropping and what dropping it yields, it offers the RFQ path — the
 * honest answer when nobody has listed the thing — and it says out loud that
 * the miss was recorded, because that is what turns an empty page into a
 * recruitment signal rather than a dead end.
 */
export function ZeroResult({
  query,
  basePath,
  suggestion,
  facetLabel,
  categoryName,
  categoryHref,
  rfqHref = "/rfq/new",
  // Named `alert` and not destructured, this silently resolved to the DOM
  // global and typechecked as a function. Worth the note: the only sign was a
  // React child that was never a node.
  alert,
}: {
  query: SearchQuery;
  basePath: string;
  suggestion: DropSuggestion | null;
  /** Localised name for the facet key in the suggestion. */
  facetLabel: (key: string) => string;
  categoryName?: string;
  categoryHref?: string;
  /** Where the RFQ affordance goes, carrying the category the search was in. */
  rfqHref?: string;
  /**
   * Criterion 8's alert form, or nothing when there is no query to watch for.
   *
   * Passed in rather than rendered here: this is a server component and the
   * form is a client one with a server action, and the composition belongs to
   * whoever knows the category.
   */
  alert?: React.ReactNode;
}) {
  return (
    <div className="max-w-[var(--measure-prose)]">
      <h2 className="text-h1 text-ink">
        {query.q ? t("zero.query_title", { query: query.q }) : t("zero.title")}
      </h2>

      {suggestion ? (
        <div className="mt-4">
          <Card>
            <p className="text-body text-body">
              {t("zero.drop", { facet: facetLabel(suggestion.key) })}
            </p>
            <p className="mt-0.5 font-mono text-eyebrow tabular-nums text-muted">
              {t("zero.drop_yields", { count: suggestion.yields })}
            </p>
            <div className="mt-3">
              {/*
                A real link, not a suggestion the buyer has to act out. The
                whole point of naming the filter is that removing it is one
                click away.
              */}
              <a
                href={`${basePath}?${toSearchParams(withoutFacet(query, suggestion.key))}`}
                // Reached only from a zero-result page, which is where a
                // crawler walking facet combinations spends most of its time.
                rel={crawlRel(`${basePath}?${toSearchParams(withoutFacet(query, suggestion.key))}`)}
                className="inline-flex items-center rounded-ctl border border-line-strong bg-card px-3 py-1.5 text-body-sm text-ink transition-colors duration-120 ease-out hover:bg-fill focus-visible:outline-none focus-visible:shadow-focus"
              >
                {t("zero.drop", { facet: facetLabel(suggestion.key) })} —{" "}
                {formatCount(suggestion.yields)}
              </a>
            </div>
          </Card>
        </div>
      ) : (
        <p className="mt-3 text-prose text-prose">{t("zero.nothing_helps")}</p>
      )}

      <div className="mt-4">
        <Panel title={t("zero.rfq_title")}>
          <p className="text-body-sm text-body">{t("zero.rfq_body")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {/*
              Live from handoff 2 step 3, and this is the surface it matters on
              most: nobody in the directory lists it, so asking the trade is the
              only thing left to offer.
            */}
            <a href={rfqHref} className={buttonClassName()}>
              {t("zero.rfq_cta")}
            </a>
            {categoryName && categoryHref && (
              <a
                href={categoryHref}
                className="inline-flex items-center rounded-ctl px-3 py-1.5 text-body-sm text-moss underline-offset-4 transition-colors duration-120 ease-out hover:underline focus-visible:outline-none focus-visible:shadow-focus"
              >
                {t("zero.browse", { category: categoryName })}
              </a>
            )}
          </div>
        </Panel>
      </div>

      <p className="mt-4 text-caption text-muted">{t("zero.recorded")}</p>
      {alert}
    </div>
  );
}
