import "server-only";
import { prisma } from "@/lib/db/client";
import { checkRate, recordHit, requesterKey, retryAfterSeconds } from "@/lib/rate-limit";
import {
  FIELDS_FOR_KIND,
  isPublicReportKind,
  isReportSubjectField,
  type PublicReportKind,
  type ReportSubjectField,
} from "./taxonomy";

/**
 * Board 4h — the public's way into this queue.
 *
 * The storefront has carried *Report this listing* since it shipped, twice: on
 * the unclaimed panel and in the verification rail. Both pointed at
 * `/verification-policy`, a page of prose. So the queue board 4h works had
 * exactly one producer — the off-platform message detector — and four of the
 * eight `ReportKind`s had none at all, which is why two of the board's own
 * drawn rows (`Public ×3`, `Public ×2`) could not have existed.
 *
 * ## Signed out is allowed, and says so
 *
 * The person who notices that a landline rings a different company is a buyer
 * who has just tried to call it, and requiring an account there is requiring an
 * account to do us a favour. So a report may be filed with no session, and the
 * form states the consequence plainly rather than implying an answer it cannot
 * send: with no account there is nowhere to write back to, and `Q5`'s
 * notification is skipped.
 *
 * ## What it cannot do
 *
 * It cannot set an outcome, an assignee, a detector or an evidence line. A
 * report arrives as a claim; everything the platform knows about it is measured
 * on the way past, by the queue and the detectors, and nothing a form posts can
 * write into that column.
 */

export const MIN_DETAIL = 20;
export const MAX_DETAIL = 1200;

export type FileReportError =
  | "not_found"
  | "invalid_kind"
  | "invalid_field"
  | "detail_too_short"
  | "detail_too_long"
  | "already_reported"
  | "rate_limited";

export type FileReportResult =
  | { ok: true; reportId: string; willHearBack: boolean }
  | { ok: false; error: FileReportError; retryAfterS?: number };

export interface FileReportInput {
  slug: string;
  kind: string;
  /** The field it is about. Required where the kind offers a choice. */
  field: string | null;
  detail: string;
  /** The signed-in reporter, or null for a member of the public. */
  reporterId: string | null;
  /** Pre-computed in tests; derived from the request otherwise. */
  requester?: string;
}

export async function fileListingReport(
  input: FileReportInput,
  now = new Date(),
): Promise<FileReportResult> {
  if (!isPublicReportKind(input.kind)) return { ok: false, error: "invalid_kind" };
  const kind: PublicReportKind = input.kind;

  const allowed = FIELDS_FOR_KIND[kind];
  const field: ReportSubjectField | null =
    input.field && isReportSubjectField(input.field) ? input.field : null;
  /*
     A field is required wherever the kind offers more than one, and refused
     where it does not fit the kind. `subjectField` is what the three-strikes
     count and the duplicate collapse group on, so a value that does not belong
     to the kind would split a group silently rather than fail loudly.
  */
  if (!field || !allowed.includes(field)) return { ok: false, error: "invalid_field" };

  const detail = input.detail.trim();
  if (detail.length < MIN_DETAIL) return { ok: false, error: "detail_too_short" };
  if (detail.length > MAX_DETAIL) return { ok: false, error: "detail_too_long" };

  const business = await prisma.business.findUnique({
    where: { slug: input.slug },
    select: { id: true, publishedAt: true },
  });
  if (!business || !business.publishedAt) return { ok: false, error: "not_found" };

  /*
     One open report per person, business and field.

     Not a rate limit — a rate limit is about cost, and this is about the
     record: a buyer pressing the button again a week later has not found a
     second problem, and two open rows would collapse into one work item
     carrying a count of two that means one person twice.
  */
  if (input.reporterId) {
    const existing = await prisma.supplierReport.findFirst({
      where: {
        subjectBusinessId: business.id,
        reporterId: input.reporterId,
        kind,
        subjectField: field,
        outcome: null,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (existing) return { ok: false, error: "already_reported" };
  }

  const identifier = input.requester ?? (await requesterKey(input.reporterId));
  const decision = await checkRate("listing_report", identifier, now);
  if (!decision.allowed) {
    return { ok: false, error: "rate_limited", retryAfterS: retryAfterSeconds(decision) };
  }
  await recordHit("listing_report", identifier);

  const report = await prisma.supplierReport.create({
    data: {
      subjectBusinessId: business.id,
      reporterId: input.reporterId,
      kind,
      subjectField: field,
      detail,
      createdAt: now,
    },
    select: { id: true },
  });

  return { ok: true, reportId: report.id, willHearBack: input.reporterId !== null };
}
