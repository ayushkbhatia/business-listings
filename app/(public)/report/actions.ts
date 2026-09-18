"use server";

import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth/session";
import { fileListingReport, type FileReportError } from "@/lib/reports/file";
import { reportFormData } from "@/lib/reports/form";
import type { FileResult, ReportFieldName, ReportFormData } from "@/lib/reports/form";
import { reportSubject } from "@/lib/reports/subject";
import { t } from "@/lib/i18n";

/**
 * Boards 4h and 13c — the two server functions behind *Report this listing*.
 *
 * One file for both surfaces. The modal over the storefront and the page at
 * `/report/:slug` import these and nothing else, which is what keeps them one
 * form rather than two that agree today.
 *
 * The reporter is resolved from the session, never from the form: a hidden
 * field naming who is reporting is a field anybody can change, and the
 * difference between a report filed by a named buyer and one filed anonymously
 * is the difference between a reply and none.
 */

export type { FileResult } from "@/lib/reports/form";

/*
   Every refusal says what is wrong and what correct looks like, and none of
   them blames the person filing. Design system §08.
*/
const MESSAGES: Record<
  FileReportError,
  { key: string; fix: string; field?: ReportFieldName }
> = {
  not_found: { key: "report_listing.error.not_found", fix: "report_listing.fix.not_found" },
  invalid_kind: {
    key: "report_listing.error.invalid_kind",
    fix: "report_listing.fix.invalid_kind",
    field: "kind",
  },
  invalid_field: {
    key: "report_listing.error.invalid_field",
    fix: "report_listing.fix.invalid_field",
    field: "field",
  },
  detail_too_long: {
    key: "report_listing.error.too_long",
    fix: "report_listing.fix.too_long",
    field: "detail",
  },
  correction_too_long: {
    key: "report_listing.error.correction_too_long",
    fix: "report_listing.fix.correction_too_long",
    field: "correction",
  },
  invalid_category: {
    key: "report_listing.error.invalid_category",
    fix: "report_listing.fix.invalid_category",
    field: "category",
  },
  invalid_email: {
    key: "report_listing.error.invalid_email",
    fix: "report_listing.fix.invalid_email",
    field: "email",
  },
  already_reported: {
    key: "report_listing.error.already_reported",
    fix: "report_listing.fix.already_reported",
  },
  rate_limited: { key: "report_listing.error.rate_limited", fix: "report_listing.fix.rate_limited" },
  listing_rate_limited: {
    key: "report_listing.error.listing_rate_limited",
    fix: "report_listing.fix.listing_rate_limited",
  },
};

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" && value !== "" ? value : null;
}

export async function fileReport(formData: FormData): Promise<FileResult> {
  const actor = await getActor();

  const result = await fileListingReport({
    slug: text(formData, "slug") ?? "",
    kind: text(formData, "kind") ?? "",
    field: text(formData, "field"),
    detail: text(formData, "detail"),
    correction: text(formData, "correction"),
    suggestedCategoryId: text(formData, "category"),
    reporterEmail: text(formData, "email"),
    reporterId: actor?.id ?? null,
  });

  if (!result.ok) {
    const message = MESSAGES[result.error];
    return {
      ok: false,
      error: t(message.key as "report_listing.error.not_found"),
      fix: t(message.fix as "report_listing.fix.not_found"),
      ...(message.field ? { field: message.field } : {}),
    };
  }

  /*
     The queue and the console badge both count open reports, so both are stale
     the moment one is filed. The storefront is not: nothing a report writes is
     visible on a listing (`B11`), and the platform does not tell a buyer that
     somebody complained.
  */
  revalidatePath("/admin/reports");
  revalidatePath("/admin");
  return {
    ok: true,
    reference: result.reference,
    replyTo: result.replyTo,
    email: result.replyTo === "email" ? (text(formData, "email")?.trim().toLowerCase() ?? null) : null,
  };
}

/**
 * The form, worded, for the modal to open on.
 *
 * The storefront does not build this on every render. Thirty thousand pages,
 * most of them read by somebody who will never report anything, each paying
 * for the trade tree and a second read of the listing — so the modal asks for
 * it on the click that opens it, and the storefront pays only when somebody
 * does. Where the URL already carries `?report=1` the page builds it on the
 * server instead, so a shared link opens on a form rather than on a spinner.
 *
 * Null where there is no public page to report, which the modal renders as the
 * same sentence `not_found` gives.
 */
export async function loadReportForm(slug: string): Promise<ReportFormData | null> {
  const [subject, actor] = await Promise.all([reportSubject(slug), getActor()]);
  if (!subject) return null;
  return reportFormData(subject, actor !== null);
}
