"use server";

import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth/session";
import { fileListingReport, type FileReportError } from "@/lib/reports/file";
import { t } from "@/lib/i18n";

/**
 * Board 4h — filing a report from a storefront.
 *
 * The one public write in this board. It resolves the reporter from the session
 * rather than from the form: a hidden field naming who is reporting is a field
 * anybody can change, and the difference between a report filed by a named
 * buyer and one filed anonymously is the difference between a reply and none.
 */

export type FileResult =
  | { ok: true; willHearBack: boolean }
  | { ok: false; error: string; fix: string; field?: "kind" | "field" | "detail" };

/*
   Every refusal says what is wrong and what correct looks like, and none of
   them blames the person filing. Design system §08.
*/
const MESSAGES: Record<
  FileReportError,
  { key: string; fix: string; field?: "kind" | "field" | "detail" }
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
  detail_too_short: {
    key: "report_listing.error.too_short",
    fix: "report_listing.fix.too_short",
    field: "detail",
  },
  detail_too_long: {
    key: "report_listing.error.too_long",
    fix: "report_listing.fix.too_long",
    field: "detail",
  },
  already_reported: {
    key: "report_listing.error.already_reported",
    fix: "report_listing.fix.already_reported",
  },
  rate_limited: { key: "report_listing.error.rate_limited", fix: "report_listing.fix.rate_limited" },
};

export async function fileReport(formData: FormData): Promise<FileResult> {
  const actor = await getActor();
  const slug = String(formData.get("slug") ?? "");

  const result = await fileListingReport({
    slug,
    kind: String(formData.get("kind") ?? ""),
    field: String(formData.get("field") ?? "") || null,
    detail: String(formData.get("detail") ?? ""),
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
     visible on a listing, which is the whole shape of this board — the platform
     does not tell a buyer that somebody complained.
  */
  revalidatePath("/admin/reports");
  revalidatePath("/admin");
  return { ok: true, willHearBack: result.willHearBack };
}
