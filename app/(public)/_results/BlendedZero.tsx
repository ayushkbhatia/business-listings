import { buttonClassName } from "@/components/primitives";
import { Card, Panel } from "@/components/structure";
import { formatCount, formatList } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { BlendedDropSuggestion } from "@/lib/search/blended";
import type { BlendedSearchResult } from "@/lib/search/blended-views";
import { pathWithQuery, withoutFacet, type BlendedTab, type SearchQuery } from "@/lib/search/query";
import { crawlRel } from "@/lib/seo/crawl-policy";

/**
 * Boards `10c` + `10c-s`, `B9` — **a blended set has three zero states, not
 * one, and only the first was drawn.**
 *
 * | State | What it means | What is here |
 * |---|---|---|
 * | nothing at all | 0 in Everything | `ZeroNothing` — the ladder, the escape, the log |
 * | nothing in this kind | 0 products, 164 services | `ZeroInKind` — **no ladder** |
 * | nothing under this facet | an option's count is 0 | not here: the option is drawn disabled |
 *
 * The middle case is the one that makes blending worth building, and the drawn
 * ladder would be actively wrong there: a buyer told *nobody has listed it*
 * while 164 services match is being told something false. The two states are
 * separate components rather than one with a flag, because the difference
 * between them is not a detail — it is the whole point of the ladder having a
 * precondition.
 */

const BASE = "/search";

/* ── State one — nothing at all ──────────────────────────────────────────── */

/**
 * `10c`'s zero-result state: what is missing, what dropping each filter buys,
 * and the honest way out when nobody has listed it.
 *
 * The board calls this the most valuable thing on either screen, and it is:
 * every rung is priced, the escape is real, and the miss is recorded where it
 * becomes a recruitment target rather than a dead end (`B11`).
 */
export function ZeroNothing({
  query,
  result,
  clearAllHref,
  alert,
}: {
  query: SearchQuery;
  result: BlendedSearchResult;
  clearAllHref: string;
  /**
   * The saved-search alert, or nothing when there are no words to watch for.
   *
   * Passed in rather than rendered here: this is a server component and the
   * form is a client one with a server action.
   */
  alert?: React.ReactNode;
}) {
  const filtered = result.appliedGroups > 0;

  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
      <div className="min-w-0">
        <h2 className="text-h1 text-ink">
          {filtered
            ? t("search_blended.zero_filters_title", { count: result.appliedGroups })
            : query.q
              ? t("search_blended.zero_words_title", { query: query.q })
              : t("zero.title")}
        </h2>
        <p className="mt-2 max-w-[var(--measure-prose)] text-prose text-prose">
          {filtered
            ? t("search_blended.zero_filters_body")
            : t("search_blended.zero_words_body", { query: query.q })}
        </p>

        {/* ── The ladder, and only here ─────────────────────────────────── */}
        {result.ladder.length > 0 ? (
          <ul className="mt-4 flex list-none flex-col gap-2 p-0">
            {result.ladder.map((rung) => (
              <li key={rung.key}>
                <LadderRung query={query} rung={rung} />
              </li>
            ))}
          </ul>
        ) : filtered ? (
          <div className="mt-4">
            <p className="max-w-[var(--measure-prose)] text-prose text-prose">{t("zero.nothing_helps")}</p>
            <a href={clearAllHref} rel={crawlRel(clearAllHref)} className={`${buttonClassName({ variant: "secondary" })} mt-3`}>
              {t("search_blended.zero_clear_all")}
            </a>
          </div>
        ) : null}

        {/* ── The escape, counting the query it is actually counting ────── */}
        {result.escape && (
          <div className="mt-4">
            <Panel title={t("search_blended.escape_title")}>
              <p className="text-body-sm text-body">
                {result.escape.suppliers > 0
                  ? t("search_blended.escape_body", {
                      count: result.escape.suppliers,
                      formatted: formatCount(result.escape.suppliers),
                    })
                  : t("zero.rfq_body")}
              </p>
              {/*
                 `B10`. The suppliers named here match the trade and what they
                 do, not the filters that returned nothing — two different
                 queries, and the page says which. With no number stated there
                 are not two sets to confuse, so there is nothing to disclaim.
              */}
              {result.escape.suppliers > 0 && (
                <p className="mt-1 text-caption text-muted">{t("search_blended.escape_caveat")}</p>
              )}
              <div className="mt-3">
                <a href={result.escape.href} className={buttonClassName()}>
                  {t("zero.rfq_cta")}
                </a>
              </div>
            </Panel>
          </div>
        )}
      </div>

      {/* ── `B11` — the miss, and what it is for ───────────────────────── */}
      <div className="min-w-0">
        <Panel title={t("search_blended.logged_title")}>
          <p className="text-body-sm text-body">{t("search_blended.logged_body")}</p>
          {alert}
        </Panel>
      </div>
    </div>
  );
}

function LadderRung({ query, rung }: { query: SearchQuery; rung: BlendedDropSuggestion }) {
  const href = pathWithQuery(BASE, withoutFacet(query, rung.key));
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body text-ink">{t("zero.drop", { facet: rung.label })}</p>
          <p className="mt-0.5 font-mono text-eyebrow tabular-nums text-muted">
            {t("zero.drop_yields", { count: rung.yields })}
          </p>
        </div>
        <a href={href} rel={crawlRel(href)} className={buttonClassName({ variant: "secondary" })}>
          {t("search_blended.ladder_show", { count: rung.yields, formatted: formatCount(rung.yields) })}
        </a>
      </div>
    </Card>
  );
}

/* ── State two — nothing in this kind ────────────────────────────────────── */

/**
 * `B9`'s middle row: this tab holds nothing and another one holds plenty.
 *
 * **No ladder, and no *nobody has listed it*.** The filters are fine and the
 * words found results; they are simply of another kind. So the state names the
 * kinds that did match, with their counts, and offers the switch — which is the
 * behaviour that makes the tab row a filter rather than a partition.
 */
export function ZeroInKind({
  query,
  result,
}: {
  query: SearchQuery;
  result: BlendedSearchResult;
}) {
  const tabName = (tab: BlendedTab) => t(`search_blended.tab.${tab}` as "search_blended.tab.all");

  return (
    <div className="mt-6 rounded-card border border-line bg-card px-4 py-6 sm:px-6">
      <h2 className="text-h2 text-ink">
        {t("search_blended.zero_kind_title", { tab: tabName(result.active) })}
      </h2>
      <p className="mt-2 max-w-[var(--measure-prose)] text-prose text-prose">
        {t("search_blended.zero_kind_body", {
          kinds: formatList(
            result.elsewhere.map((tab) =>
              t("search_blended.zero_kind_count", {
                count: result.counts[tab],
                formatted: formatCount(result.counts[tab]),
                tab: tabName(tab).toLowerCase(),
              }),
            ),
          ),
        })}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {result.elsewhere.map((tab, index) => {
          const href = pathWithQuery(BASE, query, { kind: tab === "all" ? undefined : tab, page: 1 });
          return (
            <a
              key={tab}
              href={href}
              rel={crawlRel(href)}
              className={buttonClassName({ variant: index === 0 ? "primary" : "secondary" })}
            >
              {t("search_blended.zero_kind_switch", {
                tab: tabName(tab),
                count: result.counts[tab],
                formatted: formatCount(result.counts[tab]),
              })}
            </a>
          );
        })}
      </div>
    </div>
  );
}
