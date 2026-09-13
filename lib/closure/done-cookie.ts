/**
 * Board 11i — what the confirmation page says, carried across the redirect.
 *
 * Its own module because `"use server"` files may export only async functions.
 *
 * The request ends every session, the requester's included, and revalidating
 * the storefront makes Next re-render the page the action came from — which,
 * with no session left, was a 404 at the one moment the seller needs to know
 * where the reversal link went. So the result goes into a short-lived cookie
 * and the seller lands on `/account/closed`, which needs no session to read it.
 *
 * Nothing in it grants anything: a business name, a date and a masked address.
 * A forged cookie shows its forger their own text.
 */
export interface ClosureDoneCookie {
  businessName: string;
  finalOn: string;
  emailed: boolean;
  emailTo: string | null;
}

export const CLOSURE_DONE_COOKIE = "bl_closure_done";

export function encodeDone(done: ClosureDoneCookie): string {
  return Buffer.from(JSON.stringify(done)).toString("base64url");
}

export function decodeDone(raw: string | undefined): ClosureDoneCookie | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<ClosureDoneCookie>;
    if (typeof value.businessName !== "string" || typeof value.finalOn !== "string") return null;
    return {
      businessName: value.businessName,
      finalOn: value.finalOn,
      emailed: value.emailed === true,
      emailTo: typeof value.emailTo === "string" ? value.emailTo : null,
    };
  } catch {
    return null;
  }
}
