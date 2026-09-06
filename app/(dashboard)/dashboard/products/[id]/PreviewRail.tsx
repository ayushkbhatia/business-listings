"use client";

import { SpecTable } from "@/components/domain";
import { Eyebrow } from "@/components/display";
import { previewRows } from "@/lib/products/preview-rows";
import type { TemplateField } from "@/lib/spec";
import { isMultiselect, selectedMulti } from "@/lib/products/spec-values";
import { t } from "@/lib/i18n";

/**
 * The spec table a buyer reads, beside the boxes that fill it.
 *
 * Composed by `previewRows` — the same function board 1g's page calls, through
 * `buyerPreviewFor`. Not a second implementation of it: `DN100 · 4 inch` and
 * the rest are unit conversions, and a copy of them here would drift from the
 * page this claims to preview, invisibly, until a seller and a buyer compared
 * screens.
 *
 * It recomputes in the browser as the seller types, which is the whole value of
 * the rail. Safe because `lib/spec.ts`, `lib/format` and `SpecTable` are all
 * client-safe; the queries that resolve the template are in `buyer-preview.ts`,
 * which is `server-only`, and the fields arrive here already resolved.
 *
 * ## Empty rows stay, and say "Not provided"
 *
 * Board 3g §5 asks for them to be omitted. CLAUDE.md's interface-honesty rule
 * says the opposite in so many words — "unfilled spec rows render grey reading
 * 'Not provided', never hidden … the seller sees the same grey rows in their
 * editor" — board 1g's own criterion agrees, and the e2e test that pins 1g's
 * row count would fail either way, because a preview showing four rows cannot
 * match a page showing seven. The project rule wins.
 *
 * What the handoff was actually objecting to survives: that row was rendered in
 * the lowest-contrast tone on the board. Fixed where it lives, in `SpecTable`.
 *
 * ## What is not here
 *
 * A field the seller invented. `getSellerOverlay` carries labels and order for
 * platform fields only, so an own field is in the grid and not on the buyer's
 * page. Stated as a count under the table rather than quietly reconciled — the
 * two numbers on this screen answer different questions and both say which.
 */
export interface PreviewRailProps {
  /** Resolved and overlaid on the server. The rail only re-renders values. */
  fields: readonly TemplateField[];
  /** Every value on screen, keyed the way `specValues` keys them. */
  values: Record<string, string>;
  /** Editor fields absent from the buyer's page — the seller's own. */
  ownFieldCount: number;
  /** A draft has no published page yet. The preview still renders. */
  isDraft: boolean;
}

export function PreviewRail({ fields, values, ownFieldCount, isDraft }: PreviewRailProps) {
  /*
     The live values, in the shape the formatter expects.

     A multiselect crosses to the browser `|`-joined and is stored as an array,
     so it is split back before rendering — otherwise the preview would show
     "WRAS|UL listed" where the buyer's page shows "WRAS, UL listed", and the
     rail would be wrong about the one thing it exists to be right about.
  */
  const specValues: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.id] ?? "";
    specValues[field.id] = isMultiselect(field.type) ? selectedMulti(raw) : raw;
  }

  const { rows, filled, total } = previewRows(fields, null, specValues);

  return (
    <section aria-labelledby="preview-rail" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow as="h2" id="preview-rail">
          {t("product.preview_eyebrow")}
        </Eyebrow>
        {/*
          Derived from the array just rendered, so the figure and the markup
          cannot disagree. "Filled", not "rows" — every field is a row, and a
          header reading "4 of 7 rows" above a table of seven is the exact
          defect the pre-flight list calls out.
        */}
        <span className="font-mono text-eyebrow uppercase tabular-nums text-muted">
          {t("product.preview_rows", { filled: String(filled), total: String(total) })}
        </span>
      </div>

      <SpecTable
        rows={rows}
        caption={t("product.preview_caption")}
        notProvidedLabel={t("table.not_provided")}
        // The same marker 1g renders. A preview missing it is a preview of a
        // different table.
        filterableLabel={t("product.spec_filterable")}
      />

      {ownFieldCount > 0 && (
        <p className="text-caption text-muted">
          {t("product.preview_own_note", { count: ownFieldCount })}
        </p>
      )}
      {isDraft && <p className="text-caption text-muted">{t("product.preview_draft_note")}</p>}
    </section>
  );
}
