"use server";

import { redirect } from "next/navigation";
import { isSafeNext } from "@/lib/auth/flow";
import { getActor } from "@/lib/auth/session";
import { acceptInvite } from "@/lib/team/invite";

/**
 * The one mutation this route has. Thin, like every other action in the app:
 * read the form, ask the service, redirect.
 *
 * Nothing about a refusal is carried back in the query string, and that is
 * deliberate. Every state this can end in — the token lapsed while the page was
 * open, the owner revoked it, somebody else took the seat, the address does not
 * match — is a state the page derives for itself from the token and the
 * signed-in row when it renders. Passing a `?refused=` token as well would give
 * the screen two sources for the same fact, and the query string is the one a
 * visitor can type.
 */
export async function acceptInviteAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const here = `/invite/${encodeURIComponent(token)}`;

  const actor = await getActor();
  if (!actor) {
    /*
       Signed out between rendering the button and pressing it — a session that
       expired, or a link opened in a second tab. Back through sign-in, carrying
       the invitation as `next` so the round trip lands here again rather than
       on the directory home page with the token lost.

       `isSafeNext` guards a path this function built itself, which looks
       redundant and is not: the token comes from a URL a stranger controls, and
       `encodeURIComponent` is what keeps a `//host` or a backslash in it from
       becoming an off-site destination. The assertion is cheap and the failure
       it prevents is an open redirect.
    */
    redirect(`/signin?next=${encodeURIComponent(isSafeNext(here) ? here : "/")}`);
  }

  const result = await acceptInvite(token, actor);
  redirect(result.ok ? `${here}?accepted=1` : here);
}
