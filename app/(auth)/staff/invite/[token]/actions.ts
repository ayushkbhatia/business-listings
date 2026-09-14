"use server";

import { redirect } from "next/navigation";
import { signInHref } from "@/lib/auth/next-path";
import { getActor } from "@/lib/auth/session";
import { acceptStaffInvite } from "@/lib/staff/accept";

/**
 * Board 4i — taking the role. Thin, like the seller invite's action.
 *
 * No refusal travels in the query string. Every state this can end in is one
 * the page derives for itself from the token and the signed-in row, and a
 * `?refused=` would be a second source for the same fact that anybody can type.
 * `?accepted=1` only says "you have just come from here"; the page checks the
 * role on the record before it believes it.
 */
export async function acceptStaffInviteAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const here = `/staff/invite/${encodeURIComponent(token)}`;

  const actor = await getActor();
  if (!actor) redirect(signInHref(here));

  const result = await acceptStaffInvite(token, actor);
  redirect(result.ok ? `${here}?accepted=1` : here);
}
