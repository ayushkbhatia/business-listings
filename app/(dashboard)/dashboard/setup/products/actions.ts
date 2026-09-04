"use server";

import { revalidatePath } from "next/cache";
import {
  attrsLostByChanging,
  chooseSheet,
  deleteRow,
  productBoardFor,
  saveRow,
  type ProductResult,
} from "@/lib/products/service";
import { parsePaste, PRODUCT_TARGET } from "@/lib/products/rows";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { requireSellerSeat } from "../../_shell";

/**
 * Board 8c's writers.
 *
 * Thin, like every action here: resolve the seat, hand it to the service,
 * revalidate. Every rule about what goes live, what counts and what a sheet
 * change costs lives in `lib/products/service.ts`.
 */

export type RowResult = { ok: true; id?: string } | { ok: false; error: string };
export type PasteResult = { ok: true; added: number } | { ok: false; error: string };

/**
 * Four paths, because a product is on four screens.
 *
 * This one, the hub that counts them, the catalogue that lists them, and the
 * public storefront that renders them. A seller who finishes the task and finds
 * the hub still saying two of ten has been told the work did not land.
 */
function revalidate(): void {
  revalidatePath("/dashboard/setup/products");
  revalidatePath("/dashboard/setup");
  revalidatePath("/dashboard/products");
  revalidatePath("/dashboard");
}

export async function saveRowAction(formData: FormData): Promise<RowResult> {
  const seat = await requireSellerSeat();

  const id = formData.get("id");
  const result = await saveRow(seat.actor, seat.businessId, {
    ...(typeof id === "string" && id !== "" ? { id } : {}),
    name: String(formData.get("name") ?? ""),
    size: String(formData.get("size") ?? ""),
    availability: formData.get("availability") ? String(formData.get("availability")) : null,
  });

  if (!result.ok) return { ok: false, error: message(result) };
  revalidate();
  return { ok: true, ...(result.id ? { id: result.id } : {}) };
}

export async function deleteRowAction(formData: FormData): Promise<RowResult> {
  const seat = await requireSellerSeat();
  const result = await deleteRow(seat.actor, seat.businessId, String(formData.get("id") ?? ""));
  if (!result.ok) return { ok: false, error: message(result) };
  revalidate();
  return { ok: true };
}

export async function chooseSheetAction(formData: FormData): Promise<RowResult> {
  const seat = await requireSellerSeat();
  const result = await chooseSheet(
    seat.actor,
    seat.businessId,
    String(formData.get("templateId") ?? ""),
  );
  if (!result.ok) return { ok: false, error: message(result) };
  revalidate();
  return { ok: true };
}

/**
 * What changing the sheet would stop showing, as sentences. §7.
 *
 * Formatted here rather than in the modal. The confirm is a client component
 * and a server component may not hand one a formatter — the repeated defect
 * this codebase has a rule about — so the line arrives finished and the modal
 * renders strings.
 */
export async function sheetChangeCost(templateId: string): Promise<string[]> {
  const seat = await requireSellerSeat();
  const losing = await attrsLostByChanging(seat.businessId, templateId);
  return losing.map((entry) =>
    t("products.change_sheet_row", {
      label: entry.label,
      formatted: formatCount(entry.products),
    }),
  );
}

/**
 * A block pasted out of a spreadsheet. §6.
 *
 * Rows are written one at a time through `saveRow`, so a paste obeys every rule
 * a typed row obeys — the cap, the publishable trio, the slug retry and the
 * search text. A cheaper bulk insert would be a second way to create a product
 * and a second place for those rules to be missing.
 */
export async function pasteRowsAction(text: string): Promise<PasteResult> {
  const seat = await requireSellerSeat();

  const board = await productBoardFor(seat.businessId);
  const room = board.capRemaining ?? PRODUCT_TARGET * 2;
  const rows = parsePaste(text, Math.max(0, room));
  if (rows.length === 0) return { ok: false, error: t("products.paste_none") };

  let added = 0;
  for (const row of rows) {
    const result = await saveRow(seat.actor, seat.businessId, {
      name: row.name,
      size: row.size,
      availability: matchAvailability(row.availability),
    });
    if (!result.ok) break;
    added += 1;
  }

  revalidate();
  return { ok: true, added };
}

/**
 * "In stock" out of a spreadsheet, matched to the enum.
 *
 * Loose on purpose: a supplier's own sheet says "In Stock", "made to order" or
 * "MTO", and refusing the row over a capitalisation would lose the paste's whole
 * point. Anything unrecognised leaves availability unset, which keeps the row
 * saved and not live — the seller then picks it from the column, which is one
 * click and unambiguous.
 */
function matchAvailability(value: string): string | null {
  const text = value.trim().toLowerCase().replace(/[^a-z]+/g, "_");
  if (text === "") return null;
  if (text.includes("stock") && text.includes("out")) return "out_of_stock";
  if (text.includes("in_stock") || text === "stock" || text === "available") return "in_stock";
  if (text.includes("made") || text === "mto") return "made_to_order";
  if (text.includes("indent")) return "indent";
  return null;
}

/** Service refusals that are a key rather than a sentence. */
function message(result: Extract<ProductResult, { ok: false }>): string {
  if (result.error === "too_short") return t("products.error.too_short");
  if (result.error === "at_cap") return t("products.error.at_cap", { plan: "" }).trim();
  return result.error;
}
