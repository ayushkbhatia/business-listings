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
