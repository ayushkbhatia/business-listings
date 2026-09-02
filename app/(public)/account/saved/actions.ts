"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { getActor } from "@/lib/auth/session";

/**
 * Remove one saved search.
 *
 * Scoped to the signed-in buyer's own rows by the `where`, not by trusting the
 * id in the form: a posted id is a value the client chose.
 */
export async function forgetSearch(formData: FormData): Promise<void> {
  const actor = await getActor();
  if (!actor) return;

  await prisma.savedSearch.deleteMany({
    where: { id: String(formData.get("id") ?? ""), userId: actor.id },
  });

  revalidatePath("/account/saved");
}
