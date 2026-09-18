"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth/session";
import { signInHref } from "@/lib/auth/next-path";
import { acceptCompanyInvite } from "@/lib/buyer-company/team-service";

/**
 * Board `7b` — joining a company from the invitation link.
 *
 * The token is posted back from the page rather than kept anywhere: it is the
 * only proof the person could read the inbox the invitation went to, and the
 * service checks the signed-in account is that inbox's.
 */
export async function joinCompanyAction(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "");
  const here = `/account/company/join/${encodeURIComponent(token)}`;
  const actor = await getActor();
  if (!actor) redirect(signInHref(here));

  const result = await acceptCompanyInvite(token, actor.id);
  if (!result.ok) redirect(`${here}?error=${result.error}`);

  revalidatePath("/account/company");
  redirect("/account/company?joined=1");
}
