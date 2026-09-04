"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { takeSeat } from "@/lib/dev/seat";

/**
 * Take a seat, or give one up.
 *
 * Thin, like every other action in this codebase: read the form, ask the
 * service, redirect. The guard lives in `takeSeat`, not here — a server action
 * is a URL and the page refusing to render does not stop a POST.
 */
export async function takeSeatAction(formData: FormData): Promise<void> {
  const kind = String(formData.get("kind") ?? "");
  const slugValue = formData.get("slug");
  const slug = typeof slugValue === "string" && slugValue !== "" ? slugValue : null;

  const result = await takeSeat(kind, slug);
  if (!result.ok) {
    redirect(`/dev/seat?error=${encodeURIComponent(result.error)}`);
  }

  redirect(result.destination);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/dev/seat");
  redirect("/dev/seat?signed_out=1");
}
