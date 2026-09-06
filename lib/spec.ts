import { formatSize } from "@/lib/format";
import type { SpecRow } from "@/components/domain";

/**
 * Resolve a product's stored spec values against its category's template.
 *
 * `Product.specValues` is keyed by SpecField id, so the template is what turns
 * it into rows — and the template is also why an unfilled field still appears.
 * A row missing from the table reads as a field that does not exist; a row
 * marked "Not provided" reads as one the seller has not filled, which is the
 * truth and is what makes the completeness count mean anything.
 */
export interface TemplateField {
  id: string;
  key: string;
  label: string;
  unit: string | null;
  type: string;
  isFilterable: boolean;
}

const SIZE_KEYS = new Set(["nominal_diameter", "size", "bore"]);

/** `DN100` becomes `DN100 · 4 inch`. The trade reads both. */
function renderValue(field: TemplateField, raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;

  if (Array.isArray(raw)) {
    const items = raw.filter((v) => v !== null && v !== undefined && v !== "");
    return items.length > 0 ? items.map(String).join(", ") : null;
  }

  const text = String(raw);

  if (SIZE_KEYS.has(field.key)) {
    const dn = /^DN(\d+)$/i.exec(text.trim());
    if (dn) return formatSize({ dn: Number(dn[1]) });
  }

  return text;
}

export function toSpecRows(
  fields: readonly TemplateField[],
  specValues: unknown,
): SpecRow[] {
  const values = (specValues ?? {}) as Record<string, unknown>;

  return fields.map((field) => {
    const value = renderValue(field, values[field.id]);
    return {
      key: field.id,
      label: field.label,
      value,
      // The unit rides in the value for a size pairing; elsewhere it follows.
      unit: SIZE_KEYS.has(field.key) ? null : field.unit,
      filterable: field.isFilterable,
      mono: field.type === "number" || SIZE_KEYS.has(field.key),
    };
  });
}

export function countFilled(fields: readonly TemplateField[], specValues: unknown): number {
  const values = (specValues ?? {}) as Record<string, unknown>;
  return fields.filter((f) => renderValue(f, values[f.id]) !== null).length;
}

/** The one size token a product carries, for a card. */
export function primarySize(
  fields: readonly TemplateField[],
  specValues: unknown,
): string | undefined {
  const values = (specValues ?? {}) as Record<string, unknown>;
  const field = fields.find((f) => SIZE_KEYS.has(f.key));
  if (!field) return undefined;
  return renderValue(field, values[field.id]) ?? undefined;
}

/**
 * The seller's own labels and order, over the platform's fields.
 *
 * Board 3h §"The ownership split": what a field is called and the order buyers
 * read it in are the seller's. Until now `SellerTemplate.fieldMappings`
 * supported both and reached no public surface at all — a seller renamed a
 * field on a screen whose own copy said "these are the fields buyers see on your
 * products", and no buyer ever saw it.
 *
 * ## What does not move
 *
 * The **key** is untouched, so `specValues` still resolves, comparison still
 * matches across sellers, and the facet rail is unaffected — those read the
 * platform field, and that is the whole reason a rename is safe.
 *
 * Board 3h's open question 5, answered as recommended: the seller's order on
 * their own product page, the platform's in any multi-seller comparison.
 * Otherwise a side-by-side has its rows in a different sequence per column.
 */
export function applyOverlay(
  fields: readonly TemplateField[],
  overlay: Record<string, { label?: string; sortOrder?: number }> | null | undefined,
): TemplateField[] {
  if (!overlay) return [...fields];

  const withOrder = fields.map((field, index) => {
    const override = overlay[field.id] ?? {};
    return {
      field: { ...field, label: override.label ?? field.label },
      // The platform's order is the fallback, and the array arrives in it.
      order: override.sortOrder ?? index,
    };
  });

  withOrder.sort((a, b) => a.order - b.order);
  return withOrder.map((entry) => entry.field);
}
