"use server";

import { redirect } from "next/navigation";
import { t } from "@/lib/i18n";
import { PermissionError } from "@/lib/auth/errors";
import { addSuppliers } from "@/lib/enquiry/add-recipients";
import { resolveBuyerId, trackingTokenFor } from "@/app/(public)/enquiry/_buyer";

/**
 * Board 1i — sending an enquiry that has already gone to more suppliers.
 *
 * Thin: identify the buyer the way the tracking page does, hand the ticks to
 * `lib/enquiry/add-recipients.ts`, and land back on the tracking page saying
 * how many it went to. Every refusal is worded here, where it is known.
 */
export async function sendToMoreSuppliers(input: {
  refOrId: string;
  token: string | null;
  chosenBusinessIds: string[];
}): Promise<{ ok: false; error: string }> {
  const buyerId = await resolveBuyerId(input.token);
  if (!buyerId) return { ok: false, error: t("add.closed") };

  const result = await addSuppliers({
    buyerId,
    refOrId: input.refOrId,
    chosenBusinessIds: input.chosenBusinessIds.slice(0, 8),
  }).catch((error: unknown) => {
    // Build plan 9.4: sending to more suppliers asks `enquiry.create`.
    if (error instanceof PermissionError) return null;
    throw error;
  });
  if (result === null) return { ok: false, error: t("rfq.not_permitted") };

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "none_chosen"
          ? t("add.none_chosen")
          : result.reason === "none_available"
            ? t("add.none_available")
            : result.reason === "accepted"
              ? t("add.accepted")
              : result.reason === "full"
                ? t("add.full")
                : result.reason === "brief"
                  ? t("add.brief")
                  : t("add.closed"),
    };
  }

  const params = new URLSearchParams({ added: String(result.added) });
  const token = await trackingTokenFor(buyerId);
  if (token) params.set("t", token);
  redirect(`/enquiry/${result.enquiryId}?${params}`);
}
