"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { trayCookie } from "@/lib/compare/service";
import { COMPARE_COOKIE, compareHref, idsFromParam, parseTray, removeFromTray } from "@/lib/compare/tray";

/**
 * Board `10d` — the remove control on a column of `/compare`.
 *
 * A Server Action rather than the tray's route, because here the re-render is
 * the point: the page is the comparison, and removing a column changes it.
 *
 * Two things at once, and both are needed. The column leaves the URL the page is
 * showing, and the product leaves the tray if it is in it — a buyer looking at
 * their own tray expects the bar on the next page to agree, and a buyer looking
 * at a link somebody sent has nothing in their tray to change.
 */
export async function removeColumn(form: FormData): Promise<void> {
  const productId = String(form.get("productId") ?? "");
  const { ids } = idsFromParam(String(form.get("set") ?? ""));
  const remaining = ids.filter((id) => id !== productId);

  const jar = await cookies();
  const tray = parseTray(jar.get(COMPARE_COOKIE)?.value);
  if (tray.items.some((item) => item.id === productId)) {
    const cookie = trayCookie(removeFromTray(tray, productId));
    if (cookie) jar.set(cookie.name, cookie.value, cookie.options);
    else jar.delete(COMPARE_COOKIE);
  }

  const href = compareHref(remaining);
  redirect(form.get("diff") === "1" && remaining.length > 0 ? `${href}&diff=1` : href);
}
