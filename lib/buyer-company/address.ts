import { isEmirate } from "@/lib/uae";
import { toE164 } from "@/lib/format/phone";
import type { Emirate } from "@/lib/db/generated/enums";

/**
 * Board `7b` `B6` — a delivery address as a set of facts a supplier can plan a
 * vehicle around, not a paragraph.
 *
 * Pure. The form posts strings; this reads them into the row's shape, and the
 * same shape is snapshotted onto an enquiry when it is sent there — so what a
 * supplier was told stays what they were told after the address is edited.
 *
 * ## Two halves, and Rule 1
 *
 * Before acceptance a supplier sees a first name and nothing that identifies
 * the buyer. So the snapshot splits: the **area and constraints** (emirate,
 * area, access hours and point, load limit) go to every recipient, because
 * they are what a quote is priced against; the **label, street line and attn.
 * contact** go only to the supplier whose quote is accepted. *Marina Plaza,
 * Tower 2, Level 14* names a tenant as surely as a company name does.
 */

export const LOAD_LIMITS = ["small_parcels", "pallets", "full_loads"] as const;
export type LoadLimit = (typeof LOAD_LIMITS)[number];

export function isLoadLimit(value: string): value is LoadLimit {
  return (LOAD_LIMITS as readonly string[]).includes(value);
}

export const ADDRESS_LIMITS = {
  label: 80,
  addressLine: 160,
  attnName: 80,
  accessPoint: 40,
} as const;

export interface AddressFields {
  label: string;
  addressLine: string;
  emirate: Emirate;
  areaId: string | null;
  attnName: string | null;
  /** E.164. */
  attnPhone: string | null;
  accessPoint: string | null;
  /** Minutes from midnight. */
  accessFrom: number | null;
  accessUntil: number | null;
  loadLimit: LoadLimit | null;
}

export type AddressField = keyof AddressFields;
export type AddressError = "required" | "too_long" | "invalid" | "window_order";

export type AddressRead =
  | { ok: true; value: AddressFields }
  | { ok: false; errors: Partial<Record<AddressField, AddressError>> };

/** `07:00` → 420. `24:00` is midnight at the end of the day; anything else past 23:59 is not a time. */
export function readClock(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!m) return "invalid";
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return "invalid";
  return h * 60 + min;
}

function text(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Read the posted fields. Every error at once, keyed by field, because the
 * form shows them beside their inputs — the design system's rule that
 * required-field errors arrive on submit, together.
 */
export function readAddress(raw: Partial<Record<AddressField, string>>): AddressRead {
  const errors: Partial<Record<AddressField, AddressError>> = {};

  const label = text(raw.label);
  if (!label) errors.label = "required";
  else if (label.length > ADDRESS_LIMITS.label) errors.label = "too_long";

  const addressLine = text(raw.addressLine);
  if (!addressLine) errors.addressLine = "required";
  else if (addressLine.length > ADDRESS_LIMITS.addressLine) errors.addressLine = "too_long";

  const emirate = text(raw.emirate);
  if (!emirate) errors.emirate = "required";
  else if (!isEmirate(emirate)) errors.emirate = "invalid";

  const areaId = text(raw.areaId) || null;

  const attnName = text(raw.attnName) || null;
  if (attnName && attnName.length > ADDRESS_LIMITS.attnName) errors.attnName = "too_long";

  const phoneText = text(raw.attnPhone);
  const attnPhone = phoneText ? toE164(phoneText) : null;
  if (phoneText && !attnPhone) errors.attnPhone = "invalid";

  const accessPoint = text(raw.accessPoint) || null;
  if (accessPoint && accessPoint.length > ADDRESS_LIMITS.accessPoint) errors.accessPoint = "too_long";

  const from = readClock(raw.accessFrom ?? "");
  const until = readClock(raw.accessUntil ?? "");
  if (from === "invalid" || (typeof from === "number" && from > 1439)) errors.accessFrom = "invalid";
  if (until === "invalid" || until === 0) errors.accessUntil = "invalid";
  if (typeof from === "number" && typeof until === "number" && from >= until && !errors.accessFrom && !errors.accessUntil) {
    errors.accessUntil = "window_order";
  }

  const load = text(raw.loadLimit);
  if (load && !isLoadLimit(load)) errors.loadLimit = "invalid";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      label,
      addressLine,
      emirate: emirate as Emirate,
      areaId,
      attnName,
      attnPhone,
      accessPoint,
      accessFrom: typeof from === "number" ? from : null,
      accessUntil: typeof until === "number" ? until : null,
      loadLimit: load ? (load as LoadLimit) : null,
    },
  };
}

/**
 * The address as an enquiry carries it. Versioned, because it is JSON in a
 * column and a future field must not make an old row unreadable.
 */
export interface DeliverySnapshot {
  v: 1;
  label: string;
  addressLine: string;
  emirate: Emirate;
  areaId: string | null;
  areaName: string | null;
  attnName: string | null;
  attnPhone: string | null;
  accessPoint: string | null;
  accessFrom: number | null;
  accessUntil: number | null;
  loadLimit: LoadLimit | null;
}

export function snapshotOf(address: AddressFields, areaName: string | null): DeliverySnapshot {
  return {
    v: 1,
    label: address.label,
    addressLine: address.addressLine,
    emirate: address.emirate,
    areaId: address.areaId,
    areaName,
    attnName: address.attnName,
    attnPhone: address.attnPhone,
    accessPoint: address.accessPoint,
    accessFrom: address.accessFrom,
    accessUntil: address.accessUntil,
    loadLimit: address.loadLimit,
  };
}

/** Read a stored snapshot back, or null for anything that is not one. */
export function parseSnapshot(value: unknown): DeliverySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row["v"] !== 1) return null;
  const str = (key: string) => (typeof row[key] === "string" ? (row[key] as string) : null);
  const num = (key: string) => (typeof row[key] === "number" ? (row[key] as number) : null);
  const emirate = str("emirate");
  const label = str("label");
  const addressLine = str("addressLine");
  if (!emirate || !isEmirate(emirate) || !label || !addressLine) return null;
  const load = str("loadLimit");
  return {
    v: 1,
    label,
    addressLine,
    emirate,
    areaId: str("areaId"),
    areaName: str("areaName"),
    attnName: str("attnName"),
    attnPhone: str("attnPhone"),
    accessPoint: str("accessPoint"),
    accessFrom: num("accessFrom"),
    accessUntil: num("accessUntil"),
    loadLimit: load && isLoadLimit(load) ? load : null,
  };
}

/** What every recipient of the enquiry may see: where, roughly, and on what terms. */
export interface DeliveryConstraints {
  emirate: Emirate;
  areaName: string | null;
  accessPoint: string | null;
  accessFrom: number | null;
  accessUntil: number | null;
  loadLimit: LoadLimit | null;
}

export function constraintsOf(snapshot: DeliverySnapshot): DeliveryConstraints {
  return {
    emirate: snapshot.emirate,
    areaName: snapshot.areaName,
    accessPoint: snapshot.accessPoint,
    accessFrom: snapshot.accessFrom,
    accessUntil: snapshot.accessUntil,
    loadLimit: snapshot.loadLimit,
  };
}

/** Whether a snapshot says anything about access at all, beyond the place. */
export function hasConstraints(c: Pick<DeliveryConstraints, "accessFrom" | "accessUntil" | "loadLimit">): boolean {
  return c.accessFrom !== null || c.accessUntil !== null || c.loadLimit !== null;
}

/** `07:00` for the form's time inputs. */
export function clockValue(minutes: number | null): string {
  if (minutes === null) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** A saved delivery address, as the enquiry composer offers it. Already worded. */
export interface DeliveryChoice {
  id: string;
  /** *Site store — JLT, Dubai*. */
  title: string;
  /** *Deliveries before 11:00 · Small parcels only*, shown under the picker. */
  detail: string;
  emirate: string;
  /** The area's name, sent as the enquiry's `deliverToArea`. */
  areaName: string | null;
  isDefault: boolean;
}
