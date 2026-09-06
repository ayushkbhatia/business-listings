/**
 * What a seller has changed and has not applied, and what applying it costs.
 *
 * Board 3h §8. The board had `Save & apply to 318` — one button, one click, a
 * retroactive edit to 318 live products with nothing stating what would happen
 * to them. The replacement is a list where every entry carries its own blast
 * radius, because the three kinds are genuinely different and a seller cannot
 * tell them apart from the control:
 *
 *   - **display only** — order, unit rendering. Nothing about the products
 *     changes; they read differently.
 *   - **republish** — a label. Every product carrying the field says something
 *     new to buyers, and the storefront pages holding it want rebuilding.
 *   - **flag** — a new requirement. Products missing the field are marked and
 *     their next save is blocked, and *none of them is delisted* (§5).
 *
 * Pure. The counts a screen shows come from a query in `./template.ts`; what
 * kind of change it is, and therefore what the count means, is decided here so
 * the wording and the arithmetic cannot drift apart.
 */

import type { FieldMappings, OwnField } from "./overlay";


/** What applying one change does to the catalogue that already exists. */
export type BlastRadius = "display_only" | "republish" | "flag";

export type ChangeKind =
  | "renamed"
  | "reordered"
  | "required_on"
  | "options_narrowed"
  | "unit_display"
  | "detached"
  | "field_added"
  | "field_removed";

export interface TemplateChange {
  kind: ChangeKind;
  /** The key `Product.specValues` uses — a platform field id, or an own field's. */
  fieldId: string;
  /** What the field is called after the change, for the sentence on screen. */
  label: string;
  /** The previous label, on a rename. */
  from?: string;
  blast: BlastRadius;
}

const BLAST: Record<ChangeKind, BlastRadius> = {
  // A label is what a buyer reads on the product page and in the seller's own
  // spec table. Nothing is stored differently and nothing is flagged — but the
  // pages carrying it now say something else, so they are rebuilt.
  renamed: "republish",
  reordered: "display_only",
  // §5's whole argument. A requirement flags and blocks the next save; it never
  // delists, so the radius is the count of products missing the field rather
  // than the count that would come down.
  required_on: "flag",
  // Narrowing the options a seller stocks does not touch a stored value — a
  // product carrying a value no longer offered keeps it and reads as filled,
  // which is true and is better than blanking it.
  options_narrowed: "display_only",
  unit_display: "display_only",
  // Out of comparison and out of any facet. The data stays; the field stops
  // being the same field as everyone else's, which is the point of doing it.
  detached: "republish",
  field_added: "display_only",
  // A seller's own field, removed. The values stay in `specValues` — nothing
  // prunes them, deliberately, so re-adding the field brings the data back.
  field_removed: "republish",
};

function sameOptions(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

export interface OverlayState {
  mappings: FieldMappings;
  ownFields: readonly OwnField[];
}

/** How a field is labelled and positioned before any override. */
export interface FieldNaming {
  fieldId: string;
  /** The platform's own label, or the own field's, before any override. */
  base: string;
  /**
   * The platform's own position.
   *
   * A reorder is a field ending up somewhere else, not an override appearing or
   * disappearing. Dropping a redundant `sortOrder: 0` from a field the platform
   * already puts first moves nothing, and reporting it as "Moved" put a change
   * in front of a seller that their catalogue would not show.
   */
  basePosition: number;
}

/**
 * Every change between the applied overlay and the draft.
 *
 * Ordered by field, then by kind, so the list a seller reads is stable between
 * renders rather than reshuffling as they edit.
 */
export function diffOverlay(
  applied: OverlayState,
  draft: OverlayState,
  naming: readonly FieldNaming[],
): TemplateChange[] {
  const baseOf = new Map(naming.map((n) => [n.fieldId, n.base]));
  const baseOrder = new Map(naming.map((n) => [n.fieldId, n.basePosition]));
  const changes: TemplateChange[] = [];

  const push = (kind: ChangeKind, fieldId: string, label: string, from?: string) =>
    changes.push({ kind, fieldId, label, blast: BLAST[kind], ...(from ? { from } : {}) });

  const fieldIds = [
    ...new Set([...Object.keys(applied.mappings), ...Object.keys(draft.mappings), ...baseOf.keys()]),
  ].sort();

  for (const fieldId of fieldIds) {
    const before = applied.mappings[fieldId] ?? {};
    const after = draft.mappings[fieldId] ?? {};
    const base = baseOf.get(fieldId);
    // A mapping key for a field the template no longer carries. Nothing to say
    // about it: it is not on screen and applying changes nothing a seller sees.
    if (base === undefined) continue;

    const wasLabel = before.label ?? base;
    const nowLabel = after.label ?? base;
    if (wasLabel !== nowLabel) push("renamed", fieldId, nowLabel, wasLabel);

    const wasPosition = before.sortOrder ?? baseOrder.get(fieldId);
    const nowPosition = after.sortOrder ?? baseOrder.get(fieldId);
    if (wasPosition !== nowPosition) push("reordered", fieldId, nowLabel);
    // Only switching a requirement ON is a change worth stating. Turning the
    // seller's own requirement off removes flags and blocks nothing — it is
    // the one edit here that can only make a catalogue more valid.
    if (!before.required && after.required) push("required_on", fieldId, nowLabel);
    if (!sameOptions(before.options, after.options)) push("options_narrowed", fieldId, nowLabel);
    if ((before.unitDisplay ?? "both") !== (after.unitDisplay ?? "both")) {
      push("unit_display", fieldId, nowLabel);
    }
    if (!before.detached && after.detached) push("detached", fieldId, nowLabel);
  }

  const appliedOwn = new Map(applied.ownFields.map((f) => [f.id, f]));
  const draftOwn = new Map(draft.ownFields.map((f) => [f.id, f]));

  for (const [id, field] of draftOwn) {
    if (!appliedOwn.has(id)) push("field_added", id, field.label);
    else {
      const was = appliedOwn.get(id)!;
      if (was.label !== field.label) push("renamed", id, field.label, was.label);
      if (was.sortOrder !== field.sortOrder) push("reordered", id, field.label);
      if (!was.required && field.required) push("required_on", id, field.label);
      if (!sameOptions(was.options, field.options)) push("options_narrowed", id, field.label);
    }
  }
  for (const [id, field] of appliedOwn) {
    if (!draftOwn.has(id)) push("field_removed", id, field.label);
  }

  return changes;
}

/** Which fields a change list newly requires. The `Fix N` count reads this. */
export function newlyRequired(changes: readonly TemplateChange[]): string[] {
  return changes.filter((change) => change.kind === "required_on").map((change) => change.fieldId);
}
