"use server";

import { revalidatePath } from "next/cache";
import {
  BUYER_REFERENCE_MAX,
  REPORT_DETAIL_MAX,
  REPORT_DETAIL_MIN,
  reportAcceptedQuote,
  setBuyerReference,
} from "@/lib/enquiry/accepted-record-server";
import { t } from "@/lib/i18n";
import { resolveBuyerId } from "../../_buyer";
import type { RecordFormState } from "./_state";

/**
 * Board `7c` — the two writes on the accepted record.
 *
 * Thin, like every action in this app: resolve who is asking, hand the work to
 * `lib/enquiry/accepted-record-server.ts`, word the answer, revalidate. The
 * enquiry id and the claim token arrive from the form, and neither is trusted —
 * the service scopes every write to the buyer the token or session resolves to.
 *
 * Both return a state rather than redirecting, because both are used through
 * `useActionState`: the form keeps what the buyer typed when a refusal comes
 * back, and a failed save is announced where it happened.
 */

function fields(formData: FormData) {
  const token = formData.get("t");
  return {
    enquiryId: String(formData.get("enquiryId") ?? ""),
    token: typeof token === "string" && token ? token : null,
  };
}

export async function saveReferenceAction(
  _previous: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const { enquiryId, token } = fields(formData);
  const buyerId = await resolveBuyerId(token);
  if (!buyerId) return { status: "error", message: t("accepted.error.not_found") };

  const value = String(formData.get("reference") ?? "");
  const result = await setBuyerReference({ buyerId, refOrId: enquiryId, value });

  if (!result.ok) {
    const message =
      result.error === "too_long"
        ? t("accepted.reference.error.too_long", {
            max: BUYER_REFERENCE_MAX,
            length: value.replace(/\s+/g, " ").trim().length,
          })
        : result.error === "invalid"
          ? t("accepted.reference.error.invalid")
          : result.error === "required"
            ? t("company.error.po_kept")
            : t("accepted.error.not_found");
    return { status: "error", message };
  }

  revalidatePath(`/enquiry/${enquiryId}/accepted`);
  return {
    status: "saved",
    message: result.buyerReference ? t("accepted.reference.saved") : t("accepted.reference.removed"),
  };
}

export async function reportProblemAction(
  _previous: RecordFormState,
  formData: FormData,
): Promise<RecordFormState> {
  const { enquiryId, token } = fields(formData);
  const buyerId = await resolveBuyerId(token);
  if (!buyerId) return { status: "error", message: t("accepted.error.not_found") };

  const result = await reportAcceptedQuote({
    buyerId,
    refOrId: enquiryId,
    detail: String(formData.get("detail") ?? ""),
  });

  if (!result.ok) {
    if (result.error === "already_reported") {
      // Not a failure the buyer can fix: the case exists, so show it.
      revalidatePath(`/enquiry/${enquiryId}/accepted`);
      return { status: "error", message: t("accepted.report.error.already_reported") };
    }
    const message =
      result.error === "too_short"
        ? t("accepted.report.error.too_short", { min: REPORT_DETAIL_MIN })
        : result.error === "too_long"
          ? t("accepted.report.error.too_long", { max: REPORT_DETAIL_MAX })
          : t("accepted.error.not_found");
    return { status: "error", message };
  }

  revalidatePath(`/enquiry/${enquiryId}/accepted`);
  revalidatePath("/admin/reports");
  return { status: "saved", message: t("accepted.report.sent") };
}
