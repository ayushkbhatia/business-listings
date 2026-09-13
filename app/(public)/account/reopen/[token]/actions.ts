"use server";

import { reverseByToken } from "@/lib/closure/service";
import { revalidateClosure } from "@/lib/closure/revalidate";
import { t } from "@/lib/i18n";
import { checkRate, recordHit, requesterKey } from "@/lib/rate-limit";

export type ReopenByLinkResult =
  | { ok: true; businessName: string; slug: string; seatsSkipped: number }
  | { ok: false; error: string };

/**
 * Build note `B3`. The one write this unauthenticated page makes.
 *
 * Rate-limited, because it is reachable without a session and takes a secret
 * as input. 32 random bytes are not guessable, so the limit is not what makes
 * the token safe — it is what keeps a script hammering the endpoint from being
 * free.
 */
export async function reopenByLinkAction(token: string): Promise<ReopenByLinkResult> {
  const key = await requesterKey();
  const decision = await checkRate("closure_reopen", key);
  if (!decision.allowed) return { ok: false, error: t("closure.link.slow_down") };
  await recordHit("closure_reopen", key);

  const result = await reverseByToken(token);
  if (!result.ok) {
    switch (result.error) {
      case "expired":
      case "final":
        return { ok: false, error: t("closure.reopen.error_expired") };
      case "already_reversed":
        return { ok: false, error: t("closure.reopen.error_already") };
      case "platform":
        return { ok: false, error: t("closure.reopen.error_platform") };
      default:
        return { ok: false, error: t("closure.link.broken_title") };
    }
  }

  revalidateClosure(result.slug);
  return { ok: true, businessName: result.businessName, slug: result.slug, seatsSkipped: result.seatsSkipped };
}
