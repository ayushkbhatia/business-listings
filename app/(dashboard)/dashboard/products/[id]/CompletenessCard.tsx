"use client";

import { CompletenessMeter } from "@/components/domain";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * How much of the template this product fills, and whether it can be saved.
 *
 * ## The number is derived, never stored
 *
 * Filled over template fields, counted at render. A template gaining a field
 * changes every affected product's figure on the next read, with no write to
 * any product row and no migration — which is the whole reason it is not a
 * column. (`Business.specCompleteness` is a different, business-level number
 * written by the nightly job and read as twelve of a hundred ranking points.
 * This does not touch it.)
 *
 * ## What it does not say
 *
 * The board this came from read "products at 100% appear in 3× more filtered
 * searches". That is a causal claim about our own data that the data cannot
 * support, and the correlation almost certainly runs the other way: sellers who
 * fill every field are the organised sellers who would rank anyway. Worse, it is
 * the kind of number that gets quoted back at us.
 *
 * What replaces it is mechanically true and needs no statistic: a filter on a
 * field returns products that have a value for it, so a product with the field
 * empty is not in that result set. Not ranked lower — absent.
 */
export interface CompletenessCardProps {
  filled: number;
  total: number;
  /** Gaps that are platform facets. The ones with a consequence beyond the page. */
  filterableGaps: number;
  /** Fields still required and still empty, in the seller's own words. */
  missing: readonly string[];
  /** Sets the Gaps chip. It does not reorder the grid — see `SpecGrid`. */
  onGoToGaps: () => void;
  /** Board 3h, where the seller's own required set lives. */
  templateHref: string;
}

export function CompletenessCard(props: CompletenessCardProps) {
  const blocked = props.missing.length > 0;

  return (
    <Panel title={t("product.completeness_title")}>
      <div className="flex flex-col gap-3">
        <CompletenessMeter
          filled={props.filled}
          total={props.total}
          label={t("product.completeness")}
          valueLabel={t("product.completeness_value", {
            filled: String(props.filled),
            total: String(props.total),
          })}
          emphasis
        />

        <p className="text-body-sm text-body">
          {props.filterableGaps > 0
            ? t("product.completeness_filterable", { count: String(props.filterableGaps) })
            : t("product.completeness_filterable_none")}
        </p>

        {/*
          Said in both states, rather than left as an absence.

          Board 3h's model is that a missing required field blocks the next save
          and never delists anything — so the product below is still live while
          this card says it cannot be saved. That combination is surprising
          enough that the screen has to state it, which is why the blocked copy
          carries "it stays live in the meantime".
        */}
        {blocked ? (
          <div className="flex flex-col gap-2">
            <p className="text-body-sm text-bad-ink">
              {t("product.save_blocked_count", { count: props.missing.length })}
            </p>
            <p className="text-caption text-muted">
              {t("product.save_blocked_where")}{" "}
              {/*
                 Underlined always, not on hover.

                 This link sits inside a sentence, and a link inside a text
                 block distinguished only by its colour is exactly what axe's
                 `link-in-text-block` refuses — colour alone is not a signal.
                 The links elsewhere on this screen sit on their own and are
                 free to underline on hover.
              */}
              <a
                href={props.templateHref}
                className="rounded-tag text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("product.add_field_link")}
              </a>
            </p>
          </div>
        ) : (
          <p className="text-body-sm text-muted">{t("product.save_ok")}</p>
        )}

        {props.filterableGaps > 0 || blocked ? (
          <button
            type="button"
            onClick={props.onGoToGaps}
            className="self-start rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("product.go_to_gaps")}
          </button>
        ) : null}
      </div>
    </Panel>
  );
}
