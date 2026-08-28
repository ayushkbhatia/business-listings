import Link from "next/link";
import { Tag } from "@/components/display";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { EmirateCount } from "@/lib/seo/facts";
import type { FaqItem } from "@/lib/seo/faq";

/**
 * The blocks a landing page is made of — boards 10a and, in step 3, 6a.
 *
 * Every one of them takes numbers and renders them. None of them queries, and
 * none of them has copy about a specific trade in it: criterion 2 says a new
 * subcategory must need no code change, and a component that named one would
 * be the code change.
 */

/**
 * Suppliers by emirate, as links into the filtered view.
 *
 * Links rather than a chart. A buyer reading "Sharjah (34)" wants the 34, and
 * the fastest route to them is the facet the results page already understands.
 */
export function EmirateBreakdown({
  rows,
  basePath,
}: {
  rows: readonly EmirateCount[];
  basePath: string;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="font-mono text-eyebrow uppercase text-faint">
        {t("landing.emirates_title")}
      </h2>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {rows.map((row) => (
          <li key={row.emirate}>
            <Tag href={`${basePath}?emirate=${row.emirate}`}>
              {t(`emirate.${row.emirate}` as never)} ({formatCount(row.listings)})
            </Tag>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-caption text-muted">{t("landing.emirates_hint")}</p>
    </section>
  );
}

export interface SpecChip {
  /** The field's id, which is the facet key the results page reads. */
  key: string;
  label: string;
  options: readonly { value: string; label: string; count: number }[];
}

/**
 * Filter chips from the trade's own specification template.
 *
 * The fields come from `SpecTemplate`, so a staff member adding a filterable
 * field to a template adds chips to 418 pages without a deploy — which is the
 * whole of criterion 2 for this template.
 */
export function SpecChips({ groups, basePath }: { groups: readonly SpecChip[]; basePath: string }) {
  const shown = groups.filter((group) => group.options.length > 0);
  if (shown.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="font-mono text-eyebrow uppercase text-faint">{t("landing.specs_title")}</h2>
      <div className="mt-2 flex flex-col gap-2.5">
        {shown.map((group) => (
          <div key={group.key}>
            <p className="text-caption text-muted">{group.label}</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {group.options.map((option) => (
                <li key={option.value}>
                  <Tag
                    /*
                       A spec facet is a bare query key named for the field id —
                       `parseSearchQuery` treats anything unreserved that way, so
                       that adding a filterable field needs no code change there
                       either. The chip has to speak the same URL.
                    */
                    href={`${basePath}?${encodeURIComponent(group.key)}=${encodeURIComponent(option.value)}`}
                  >
                    {option.label} ({formatCount(option.count)})
                  </Tag>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-2 text-caption text-muted">{t("landing.specs_hint")}</p>
    </section>
  );
}

/**
 * The FAQ block.
 *
 * A description list, not a set of disclosures. The answers are three sentences
 * each and there is nothing to save by hiding them: open text is read by a
 * crawler without qualification, needs no JavaScript, and cannot get into a
 * state where a keyboard user has to open four things to read the page.
 */
export function Faq({ items }: { items: readonly FaqItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="mt-8 border-t border-line pt-5">
      <h2 className="text-h2 text-ink">{t("faq.title")}</h2>
      <dl className="mt-3 flex max-w-[var(--measure-prose)] flex-col gap-4">
        {items.map((item) => (
          <div key={item.id}>
            <dt className="text-body-sm font-medium text-ink">{item.question}</dt>
            <dd className="mt-1 text-body-sm text-prose">{item.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export interface RelatedTrade {
  slug: string;
  name: string;
  listings: number;
}

/** The other subcategories under the same parent. Cross-links, not a menu. */
export function RelatedTrades({
  parentName,
  parentSlug,
  trades,
}: {
  parentName: string;
  parentSlug: string;
  trades: readonly RelatedTrade[];
}) {
  if (trades.length === 0) return null;

  return (
    <section className="mt-8 border-t border-line pt-5">
      <h2 className="font-mono text-eyebrow uppercase text-faint">
        {t("landing.related_title", { parent: parentName })}
      </h2>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {trades.map((trade) => (
          <li key={trade.slug}>
            <Tag href={`/c/${parentSlug}/${trade.slug}`}>
              {trade.name} ({formatCount(trade.listings)})
            </Tag>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A link out to the parent trade, for a page a buyer arrived at cold. */
export function ParentLink({ name, slug }: { name: string; slug: string }) {
  return (
    <Link
      href={`/c/${slug}`}
      className="rounded-tag text-body-sm text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
    >
      {name}
    </Link>
  );
}
