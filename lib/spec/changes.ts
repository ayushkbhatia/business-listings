/**
 * What ops has staged on a library template, and what publishing it costs.
 *
 * The admin twin of `lib/catalogue/template-changes.ts`, and it exists for the
 * same reason: the board had one button whose blast radius depended entirely on
 * what was in the draft, and nothing on screen said which.
 *
 * ## The board's card said 88,410 products would be left in violation
 *
 * It could not. Board `3h` §6 is the seller-side rule, already exported:
 * **additive platform changes land automatically** — a new field appears on
 * every clone, unfilled, **not required**, facet state inherited, and nothing
 * the seller has breaks. So a version publish cannot put an existing product in
 * violation of its template, there is nothing for a grace period to postpone,
 * and the only things that could happen on a grace period's day 61 — delisting,
 * unpublishing, dropping out of search — are exactly what `3h` §5 and `6f`'s
 * 301-not-404 exist to prevent.
 *
 * Requiring a field is therefore a **separate action** with its own review, not
 * a kind of change that can ride along inside a publish. It is not in
 * `ChangeKind` for that reason, and its absence is load-bearing rather than an
 * omission.
 *
 * ## The three radii
 *
 *   - **display only** — order, and the platform's own display label. Board
 *     `3h` §6: a platform rename changes the platform's label, never a
 *     seller's, so no clone changes and no buyer-facing page moves.
 *   - **republish** — a field arriving, a facet flag, `varies_by_variant`.
 *     Every clone gains something, or the filter rail changes shape, so the
 *     pages carrying it want rebuilding.
 *   - **flag** — nothing here. Kept in the type so the three names stay one
 *     vocabulary across the seller and admin sides, and so a future change kind
 *     that does flag has somewhere honest to sit.
 *
 * Pure. The counts come from a query in `./library.ts`; what kind of change it
 * is, and therefore what the count means, is decided here so the wording and
 * the arithmetic cannot drift apart.
 */

/** What applying one change does to the catalogue that already exists. */
export type BlastRadius = "display_only" | "republish" | "flag";

export type PlatformChangeKind =
  | "field_added"
  | "field_removed"
  | "relabelled"
  | "reordered"
  | "facet_on"
  | "facet_off"
  | "varies_on"
  | "varies_off"
  | "options_changed"
  | "unit_changed";

const BLAST: Record<PlatformChangeKind, BlastRadius> = {
  /*
     Additive and safe, and this is the entry the whole handoff turns on. The
     field lands on every clone unfilled and **not required**; no product
     violates anything and no seller's save is blocked. It is `republish`
     because every clone's field set is one longer, not because anything is at
     risk.
  */
  field_added: "republish",
  /*
     Not destructive either, and the review has to say so, because "remove from
     the library" reads like a delete. Per `3h` §6 the field and its values stay
     on every clone as a **seller-owned** field — same id, so `Product.specValues`
     keeps resolving — and it loses only its facet status.
  */
  field_removed: "republish",
  // The platform's own display label. A seller's label and mapping are
  // untouched, so no clone changes and this is genuinely display-only.
  relabelled: "display_only",
  reordered: "display_only",
  // The filter rail changes shape for a whole category. Board 1b applies it.
  facet_on: "republish",
  facet_off: "republish",
  // Board 3g reads this to decide what a push-to-variants may touch. Turning it
  // on stops a field being pushed; turning it off starts allowing it.
  varies_on: "republish",
  varies_off: "republish",
  options_changed: "republish",
  unit_changed: "republish",
};

/** One staged edit. Serialised into `SpecTemplate.draftChanges`. */
export interface DraftField {
  key: string;
  label: string;
  labelAr?: string | null;
  type: "select" | "multiselect" | "number" | "number_range" | "text" | "boolean";
  unit?: string | null;
  options?: string[];
  isFilterable: boolean;
  variesByVariant: boolean;
}

/**
 * The draft, as stored.
 *
 * Additions carry a whole field definition; edits and removals carry a field
 * id, because the field already exists and its id is what
 * `Product.specValues` is keyed by.
 */
export interface TemplateDraft {
  added: DraftField[];
  removed: string[];
  edited: Record<
    string,
    {
      label?: string;
      sortOrder?: number;
      isFilterable?: boolean;
      variesByVariant?: boolean;
      options?: string[];
      unit?: string | null;
    }
  >;
}

export const EMPTY_DRAFT: TemplateDraft = { added: [], removed: [], edited: {} };

/** The live state of one platform field, as the diff needs to see it. */
export interface LiveField {
  id: string;
  key: string;
  label: string;
  unit: string | null;
  options: readonly string[];
  isFilterable: boolean;
  variesByVariant: boolean;
  sortOrder: number;
}

export interface PlatformChange {
  kind: PlatformChangeKind;
  /** The platform field id, or the staged key for a field that has none yet. */
  fieldId: string;
  label: string;
  /** The previous label, on a relabel. */
  from?: string;
  blast: BlastRadius;
}

/**
 * Whether an edit's option list differs from the live one.
 *
 * An absent `edited` value means "not edited", never "cleared" — the same
 * distinction `mergeSpecValues` draws between a field a form emptied and one it
 * never rendered, and for the same reason: a partial edit object cannot be told
 * from a total one without it.
 */
function sameOptions(edited: readonly string[] | undefined, live: readonly string[]): boolean {
  if (edited === undefined) return true;
  return edited.length === live.length && edited.every((value, i) => value === live[i]);
}

/**
 * Reads a stored draft back, dropping anything that is not the shape above.
 *
 * A Json column is whatever was last written to it, including by a version of
 * this file that no longer exists. Every field is checked rather than cast.
 */
export function readDraft(raw: unknown): TemplateDraft {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_DRAFT };
  const entry = raw as Record<string, unknown>;

  const added: DraftField[] = [];
  if (Array.isArray(entry["added"])) {
    for (const value of entry["added"]) {
      if (!value || typeof value !== "object") continue;
      const field = value as Record<string, unknown>;
      if (typeof field["key"] !== "string" || typeof field["label"] !== "string") continue;
      const type = field["type"];
      added.push({
        key: field["key"],
        label: field["label"],
        labelAr: typeof field["labelAr"] === "string" ? field["labelAr"] : null,
        type: isFieldType(type) ? type : "text",
        unit: typeof field["unit"] === "string" ? field["unit"] : null,
        options: Array.isArray(field["options"])
          ? field["options"].filter((o): o is string => typeof o === "string")
          : [],
        isFilterable: field["isFilterable"] === true,
        variesByVariant: field["variesByVariant"] === true,
      });
    }
  }

  const removed = Array.isArray(entry["removed"])
    ? entry["removed"].filter((id): id is string => typeof id === "string")
    : [];

  const edited: TemplateDraft["edited"] = {};
  const rawEdited = entry["edited"];
  if (rawEdited && typeof rawEdited === "object" && !Array.isArray(rawEdited)) {
    for (const [fieldId, value] of Object.entries(rawEdited as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const edit = value as Record<string, unknown>;
      const out: TemplateDraft["edited"][string] = {};
      if (typeof edit["label"] === "string") out.label = edit["label"];
      if (typeof edit["sortOrder"] === "number") out.sortOrder = edit["sortOrder"];
      if (typeof edit["isFilterable"] === "boolean") out.isFilterable = edit["isFilterable"];
      if (typeof edit["variesByVariant"] === "boolean") {
        out.variesByVariant = edit["variesByVariant"];
      }
      if (Array.isArray(edit["options"])) {
        out.options = edit["options"].filter((o): o is string => typeof o === "string");
      }
      if (typeof edit["unit"] === "string" || edit["unit"] === null) {
        out.unit = edit["unit"] as string | null;
      }
      if (Object.keys(out).length > 0) edited[fieldId] = out;
    }
  }

  return { added, removed, edited };
}

function isFieldType(value: unknown): value is DraftField["type"] {
  return (
    value === "select" ||
    value === "multiselect" ||
    value === "number" ||
    value === "number_range" ||
    value === "text" ||
    value === "boolean"
  );
}

/** Whether a draft would change anything if published. */
export function isEmptyDraft(draft: TemplateDraft): boolean {
  return (
    draft.added.length === 0 &&
    draft.removed.length === 0 &&
    Object.keys(draft.edited).length === 0
  );
}

/**
 * Every change a draft would make, ordered by field then kind.
 *
 * Stable between renders rather than reshuffling as ops edits, which is the
 * same requirement `diffOverlay` has and for the same reason.
 */
export function diffDraft(live: readonly LiveField[], draft: TemplateDraft): PlatformChange[] {
  const byId = new Map(live.map((field) => [field.id, field]));
  const changes: PlatformChange[] = [];

  const push = (kind: PlatformChangeKind, fieldId: string, label: string, from?: string) =>
    changes.push({ kind, fieldId, label, blast: BLAST[kind], ...(from ? { from } : {}) });

  for (const field of [...draft.added].sort((a, b) => a.key.localeCompare(b.key))) {
    push("field_added", field.key, field.label);
  }

  for (const fieldId of [...Object.keys(draft.edited)].sort()) {
    const before = byId.get(fieldId);
    // An edit against a field the template no longer carries. Nothing to say
    // about it: it is not on screen and publishing it changes nothing.
    if (!before) continue;
    const edit = draft.edited[fieldId]!;

    const label = edit.label ?? before.label;
    if (edit.label !== undefined && edit.label !== before.label) {
      push("relabelled", fieldId, label, before.label);
    }
    if (edit.sortOrder !== undefined && edit.sortOrder !== before.sortOrder) {
      push("reordered", fieldId, label);
    }
    if (edit.isFilterable !== undefined && edit.isFilterable !== before.isFilterable) {
      push(edit.isFilterable ? "facet_on" : "facet_off", fieldId, label);
    }
    if (edit.variesByVariant !== undefined && edit.variesByVariant !== before.variesByVariant) {
      push(edit.variesByVariant ? "varies_on" : "varies_off", fieldId, label);
    }
    if (!sameOptions(edit.options, before.options)) push("options_changed", fieldId, label);
    if (edit.unit !== undefined && edit.unit !== before.unit) push("unit_changed", fieldId, label);
  }

  for (const fieldId of [...draft.removed].sort()) {
    const field = byId.get(fieldId);
    if (!field) continue;
    push("field_removed", fieldId, field.label);
  }

  return changes;
}

/**
 * What the live field set looks like once a draft is published.
 *
 * Used by the review to show the resulting order, and by the publish itself so
 * that what was previewed and what is written come from one function.
 */
export function applyDraft(live: readonly LiveField[], draft: TemplateDraft): LiveField[] {
  const removed = new Set(draft.removed);
  const kept = live
    .filter((field) => !removed.has(field.id))
    .map((field) => {
      const edit = draft.edited[field.id];
      if (!edit) return field;
      return {
        ...field,
        label: edit.label ?? field.label,
        sortOrder: edit.sortOrder ?? field.sortOrder,
        isFilterable: edit.isFilterable ?? field.isFilterable,
        variesByVariant: edit.variesByVariant ?? field.variesByVariant,
        options: edit.options ?? field.options,
        unit: edit.unit !== undefined ? edit.unit : field.unit,
      };
    });

  const next = kept.length === 0 ? 0 : Math.max(...kept.map((f) => f.sortOrder)) + 1;
  const additions = draft.added.map((field, i) => ({
    id: `__staged__${field.key}`,
    key: field.key,
    label: field.label,
    unit: field.unit ?? null,
    options: field.options ?? [],
    isFilterable: field.isFilterable,
    variesByVariant: field.variesByVariant,
    sortOrder: next + i,
  }));

  return [...kept, ...additions].sort((a, b) => a.sortOrder - b.sortOrder);
}
