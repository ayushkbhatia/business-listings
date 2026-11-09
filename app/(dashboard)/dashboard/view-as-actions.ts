"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/roles";
import { endViewAs } from "@/lib/support/view-as";

/**
 * Board 12f — ending a session from inside it.
 *
 * The warning strip on every `/dashboard` page named the business, the ticket
 * and the minutes left, and carried no way out: a staff member had to find
 * `/admin/support` again to end the session they were sitting in. The strip
 * now carries *Stop looking*, and this is what it presses.
 *
 * Here rather than in `app/(admin)/admin/support/actions.ts` because the strip
 * is dashboard chrome and this is the one write it needs. `endViewAs` is the
 * same writer the desk's own Stop uses, so there is one way a session ends.
 *
 * No capability check and no audit row: ending early is the staff member
 * closing their own session, the start is what `support.view_as` gated and
 * audited, and `endViewAs` is scoped to the caller's own `staffId` — a staff
 * actor can only ever end their own.
 */
export async function stopViewAs(): Promise<void> {
  const actor = await getActor();
  if (!actor || !isStaff(actor)) return;

  await endViewAs(actor.id);
  revalidatePath("/dashboard", "layout");
  revalidatePath("/admin/support");
  // Back to the desk. Without the session this actor has no seller seat, so
  // staying on `/dashboard` would answer 404 to somebody who has just pressed
  // a button that worked.
  redirect("/admin/support");
}
