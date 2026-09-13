import type { MessageKey } from "@/lib/i18n";

/**
 * The numeric caps the plan console edits — one list, read by the form that
 * draws the boxes and by the action that reads them back.
 *
 * ## Why it is not two lists any more
 *
 * It was. `PlanEditor`'s `CAPS` decided what rendered and `saveEntitlements`
 * carried its own array of field names, and the two disagreed: `serviceLimit`
 * had a box from the day board `2e-s` shipped and was not in the action's
 * list, so a staff member typed the services cap, pressed Save, and got
 * "nothing changed" — a control that collects a number, discards it, and
 * reports success. `publicPhotoLimit` had neither and could only be changed by
 * writing the row by hand, which skips the audit row every other entitlement
 * change writes.
 *
 * Two lists that must agree will eventually not. This is the list.
 *
 * `unlimited` is what the two halves need to differ on. Every cap here means
 * "empty box is unlimited" except `teamSeats`: a plan with unlimited seats is a
 * plan with no seat pricing, which is a commercial decision and not a field. So
 * the form draws all of them and the action's null-accepting loop takes only
 * the ones marked, reading seats separately.
 *
 * The three on/off entitlements are not caps and live in `ENTITLEMENTS` on the
 * editor, for the reason `capFor` gives.
 */
export const EDITABLE_CAPS = [
  { field: "enquiriesPerMonth", unlimited: true, labelKey: "admin.plans.col.enquiries" },
  { field: "productLimit", unlimited: true, labelKey: "admin.plans.col.products" },
  /*
     Board `2e-s`. `serviceLimit` is what `productLimit` is for a firm that
     sells work, and the numbers it shipped with — three, fifteen, unlimited —
     are proposed rather than ratified: D1 settled seven plan numbers and
     services were not their own model yet. It needs an editor from the first
     day it exists, or the eighth number is the one only the database can
     change.
  */
  { field: "serviceLimit", unlimited: true, labelKey: "admin.plans.col.services" },
  { field: "locationLimit", unlimited: true, labelKey: "admin.plans.col.locations" },
  { field: "photoLimit", unlimited: true, labelKey: "admin.plans.col.photos" },
  /*
     `photoLimit` is what a seller may upload; `publicPhotoLimit` is how many a
     visitor is shown, and only the second one is visible to a buyer. It has a
     column, an `EditPlanInput` field and an enforcement point on the
     storefront — the same defect `storageMb` and `categoryLimit` each had.
  */
  { field: "publicPhotoLimit", unlimited: true, labelKey: "admin.plans.col.public_photos" },
  { field: "storageMb", unlimited: true, labelKey: "admin.plans.col.storage" },
  /*
     Board 11f renders `categoryLimit` as its own comparison row, so a seller
     reads it against the plan they are considering. A number a seller compares
     plans on that only the database can change is the same defect again.
  */
  { field: "categoryLimit", unlimited: true, labelKey: "admin.plans.col.categories" },
  /*
     Never unlimited, and the box says so by carrying no "empty is unlimited"
     hint. The action reads it outside the nullable loop and ignores an empty
     value rather than writing null.
  */
  { field: "teamSeats", unlimited: false, labelKey: "admin.plans.col.seats" },
] as const satisfies readonly { field: string; unlimited: boolean; labelKey: MessageKey }[];

/** The names the action may set to null. `teamSeats` is not one of them. */
export const NULLABLE_CAP_FIELDS = EDITABLE_CAPS.filter((cap) => cap.unlimited).map(
  (cap) => cap.field,
) as Exclude<EditableCapField, "teamSeats">[];

export type EditableCapField = (typeof EDITABLE_CAPS)[number]["field"];
