import { sectionType, sellerFieldKeys, type SectionType } from "./section-types";

/**
 * What a storefront renders, and what a seller may put in it. Pure.
 *
 * Criterion 2 — *"reordering, enabling or disabling a section changes every live
 * storefront on that template and nothing else"* — is a statement about this
 * function. Everything else is plumbing that calls it.
 */

export interface SectionRow {
  id: string;
  type: string;
  sortOrder: number;
  enabled: boolean;
  fixed: boolean;
  singleton: boolean;
  sellerEditableFields: string[];
  showOnMobile: boolean;
  settings: unknown;
}

export interface ResolvedSection extends SectionRow {
  definition: SectionType;
}

/**
 * The sections a storefront shows, in order.
 *
 * Disabled sections are dropped rather than hidden with CSS: a section that is
 * off should cost nothing to render and should not appear in the page for a
 * screen reader or a crawler. Ties in `sortOrder` fall back to the id so the
 * order is total — two sections at position 3 must not swap between renders.
 *
 * A row whose type is no longer in the catalogue is dropped and not thrown on.
 * A type can only leave the catalogue in a deploy, and a deploy that made every
 * storefront in a sector 500 would be a worse outcome than one that made a
 * section disappear until somebody noticed.
 */
export function resolveSections(rows: readonly SectionRow[]): ResolvedSection[] {
  return rows
    .filter((row) => row.enabled)
    .map((row) => {
      const definition = sectionType(row.type);
      return definition ? { ...row, definition } : null;
    })
    .filter((row): row is ResolvedSection => row !== null && !row.definition.comingSoon)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

export type SectionRefusal =
  | "unknown_type"
  | "coming_soon"
  | "singleton_exists"
  | "section_is_fixed"
  | "unknown_field";

/**
 * May this type be added to this template?
 *
 * Criterion 7. The database refuses a second singleton by a partial unique
 * index, and this refuses it in words first — a constraint violation surfaced
 * to staff as "an unexpected error" is a constraint nobody can act on.
 */
export function canAddSection(
  typeKey: string,
  existing: readonly Pick<SectionRow, "type">[],
): SectionRefusal | null {
  const definition = sectionType(typeKey);
  if (!definition) return "unknown_type";
  if (definition.comingSoon) return "coming_soon";
  if (definition.singleton && existing.some((row) => row.type === typeKey)) {
    return "singleton_exists";
  }
  return null;
}

/**
 * Which fields a template may open to sellers for one section.
 *
 * Bounded by the type's own declaration, so a template cannot invent a field
 * that nothing renders and nothing validates.
 */
export function checkSellerFields(typeKey: string, fields: readonly string[]): SectionRefusal | null {
  const allowed = new Set(sellerFieldKeys(typeKey));
  if (allowed.size === 0 && fields.length > 0) return "unknown_field";
  for (const field of fields) if (!allowed.has(field)) return "unknown_field";
  return null;
}

/**
 * Reorder, with the fixed sections held in place.
 *
 * Criterion 6: the header cannot be moved. Rather than refusing a request that
 * would move it, this puts fixed sections first in their existing order and
 * lays the rest out after them — so a drag that tried to drop something above
 * the header lands below it, which is what the builder should feel like.
 */
export function applyOrder(
  rows: readonly SectionRow[],
  orderedIds: readonly string[],
): SectionRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const fixed = rows.filter((row) => row.fixed).sort((a, b) => a.sortOrder - b.sortOrder);
  const fixedIds = new Set(fixed.map((row) => row.id));

  const moved = orderedIds
    .map((id) => byId.get(id))
    .filter((row): row is SectionRow => row !== undefined && !fixedIds.has(row.id));

  // Anything the caller did not mention keeps its place at the end, rather than
  // being dropped. A partial list is a bug in the caller, not a reason to lose
  // a section.
  const mentioned = new Set(moved.map((row) => row.id));
  const rest = rows
    .filter((row) => !fixedIds.has(row.id) && !mentioned.has(row.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return [...fixed, ...moved, ...rest].map((row, index) => ({ ...row, sortOrder: index }));
}

/** Criterion 6, as a refusal the service can return. */
export function canDisable(row: Pick<SectionRow, "fixed">): SectionRefusal | null {
  return row.fixed ? "section_is_fixed" : null;
}
