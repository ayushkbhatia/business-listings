/**
 * The suggested slots on board 8b, and the copy that belongs to each.
 *
 * ## The one thing this module exists to keep straight
 *
 * Board 8b §4 spends half its length on a distinction that one visual treatment
 * hides: the green line under a photograph — "Good — shows racking and stock" —
 * is **the slot's own description**, shown because the seller filed the picture
 * there. It is not an assessment of the pixels. Nothing in this build looks at
 * image content; there is no vision model, no confidence threshold and no
 * wrong-answer story, and a line that reads like a compliment about a
 * photograph nobody examined would be the product asserting something it does
 * not know.
 *
 * So the hint lives here, next to the slot, and never next to a file. A
 * photograph uploaded outside a slot keeps its filename and gets no line at
 * all, which is what `IMG_4471.jpg` shows in the render.
 *
 * ## Why the list is a constant for now
 *
 * §3 wants the list configured per top-level category in admin (board 12g),
 * because a chiller supplier and a print shop want different photographs, and
 * says the generic fallback ships fine. This is that fallback. `slotsFor` takes
 * the category so the call sites are already shaped for the per-category list
 * and adding it later is a lookup rather than a signature change.
 *
 * Pure — no `server-only`, no database. The client grid renders these and the
 * service validates against them, and one list is what keeps the two honest.
 */

export interface PhotoSlot {
  /** Stored on `Media.slotKey`. Stable; the label is not. */
  key: string;
  /** Catalogue key for the tile's name. */
  labelKey: string;
  /**
   * Catalogue key for the green line, or absent where the slot promises
   * nothing. "Anything else" is a place to put a photograph, not a claim.
   */
  hintKey?: string;
  /**
   * Offered as a dashed tile before anything is in it.
   *
   * The two the render draws — team at work, delivery vehicle — plus the
   * catch-all. The first two slots are not suggested because a seller arriving
   * from the hub has usually taken those already and a grid that opens with
   * five empty prompts reads as a form.
   */
  suggested: boolean;
}

/**
 * The generic list, in the order the grid offers them.
 *
 * Warehouse and shopfront lead because they are the two the right rail argues
 * for — stock on shelves proves inventory, signage is how a buyer finds the
 * unit — and because they are the two photographs a supplier already has.
 */
export const PHOTO_SLOTS: readonly PhotoSlot[] = [
  {
    key: "warehouse",
    labelKey: "photos.slot.warehouse",
    hintKey: "photos.slot.warehouse_hint",
    suggested: false,
  },
  {
    key: "shopfront",
    labelKey: "photos.slot.shopfront",
    hintKey: "photos.slot.shopfront_hint",
    suggested: false,
  },
  {
    key: "team",
    labelKey: "photos.slot.team",
    hintKey: "photos.slot.team_hint",
    suggested: true,
  },
  {
    key: "vehicle",
    labelKey: "photos.slot.vehicle",
    hintKey: "photos.slot.vehicle_hint",
    suggested: true,
  },
  {
    key: "other",
    labelKey: "photos.slot.other",
    suggested: true,
  },
];

/**
 * The slots offered to one business.
 *
 * `categoryId` is accepted and unused, deliberately: it is the seam board 12g
 * fills, and taking it now means the call sites do not move when it does.
 */
export function slotsFor(_categoryId?: string | null): readonly PhotoSlot[] {
  return PHOTO_SLOTS;
}

export function photoSlot(key: string | null | undefined): PhotoSlot | undefined {
  if (!key) return undefined;
  return PHOTO_SLOTS.find((slot) => slot.key === key);
}

/** A posted slot key, or null. Anything unrecognised is filed as unslotted. */
export function readSlotKey(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  return photoSlot(value) ? value : null;
}
