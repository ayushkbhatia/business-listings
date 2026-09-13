import { statesAPrice } from "./no-price";
import { sectionType } from "./section-types";
import type { SectionContent } from "./render-data";

/**
 * What one seller's filled values may put on a page. Pure.
 *
 * `StorefrontContent.values` carries a promise on the model: *"Only keys in the
 * section's `sellerEditableFields`, only field types the section type declares.
 * Validated on write; a blob nobody checks is a blob that eventually renders
 * somebody's price."* Nothing validated it, because nothing writes it yet —
 * which is exactly when a guarantee belongs at the read, where every future
 * writer, a seed and a hand edit all pass through it.
 *
 * So a value renders only if the template opened its key, the type declares it,
 * it is the declared shape, it fits the declared length, and — board `5c-s` B4 —
 * a line or a paragraph does not state a price, a fee or a rate. Anything else
 * is dropped, and the section falls back to what it renders with nothing
 * filled. Dropped rather than truncated: a headline cut at 90 characters is a
 * sentence nobody wrote.
 */
export function sanitiseContent(
  section: { type: string; sellerEditableFields: readonly string[] },
  values: unknown,
): SectionContent {
  const definition = sectionType(section.type);
  if (!definition || !values || typeof values !== "object" || Array.isArray(values)) return {};

  const raw = values as Record<string, unknown>;
  const open = new Set(section.sellerEditableFields);
  const out: SectionContent = {};

  for (const field of definition.sellerFields) {
    if (!open.has(field.key) || !(field.key in raw)) continue;
    const value = raw[field.key];

    switch (field.type) {
      case "line":
      case "text": {
        if (typeof value !== "string") break;
        const text = value.trim();
        if (text === "") break;
        if (field.maxLength !== undefined && text.length > field.maxLength) break;
        if (statesAPrice(text)) break;
        out[field.key] = text;
        break;
      }
      case "date": {
        if (typeof value !== "string" || Number.isNaN(Date.parse(value))) break;
        out[field.key] = value;
        break;
      }
      case "image": {
        if (typeof value === "string" && value.trim() !== "") out[field.key] = value.trim();
        break;
      }
      case "picks": {
        if (!Array.isArray(value)) break;
        const ids = [...new Set(value.filter((id): id is string => typeof id === "string" && id !== ""))];
        const capped = field.max !== undefined ? ids.slice(0, field.max) : ids;
        if (capped.length > 0) out[field.key] = capped;
        break;
      }
    }
  }

  return out;
}
