"use server";

import { redirect } from "next/navigation";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { reviseRequirement } from "@/lib/enquiry/revise";
import { REQUIREMENT_MAX, REQUIREMENT_MIN, SCALE_MAX } from "@/lib/enquiry/service-enquiry";
import { resolveBuyerId } from "@/app/(public)/enquiry/_buyer";

/**
 * Sending a revised requirement — board 1i criterion 10, reached from the
 * tracking page's *Edit the requirement* and from the brief's promise that
 * *you can add detail after you send*.
 *
 * Identified the way the tracking page identifies a buyer: their session, or the
 * claim token the link carries. Anything else is the same answer as an unknown
 * reference.
 */
export async function reviseEnquiry(input: {
  refOrId: string;
  token: string | null;
  requirement: string;
  /** Only posted for a brief. */
  scale?: string;
}): Promise<{ ok: false; error: string }> {
  const buyerId = await resolveBuyerId(input.token);
  if (!buyerId) return { ok: false, error: t("revise.closed") };

  const result = await reviseRequirement({
    buyerId,
    ref: input.refOrId,
    requirement: input.requirement,
    ...(input.scale !== undefined ? { scale: input.scale } : {}),
  });

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "empty"
          ? t("brief.refusal.description_too_short", { min: formatCount(REQUIREMENT_MIN) })
          : result.error === "too_long"
            ? t("brief.refusal.description_too_long", { max: formatCount(REQUIREMENT_MAX) })
            : result.error === "scale_too_long"
              ? t("brief.refusal.scale_too_long", { max: formatCount(SCALE_MAX) })
              : result.error === "unchanged"
                ? t("revise.unchanged")
                : t("revise.closed"),
    };
  }

  const params = new URLSearchParams();
  if (input.token) params.set("t", input.token);
  const query = params.toString();
  redirect(`/enquiry/${result.enquiryId}${query ? `?${query}` : ""}`);
}
