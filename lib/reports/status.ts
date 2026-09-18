import "server-only";
import { prisma } from "@/lib/db/client";
import type { $Enums } from "@/lib/db/generated/client";
import { isReference } from "./reference";
import { REPORT_SLA_HOURS } from "./sla";

/**
 * Board 13c `B4` — what a reference is for, when nobody left an address.
 *
 * The export's second correction asked for *an optional email field, and a
 * reference number on the confirmation.* The email answers the reporter who
 * leaves one. The reference has to answer the one who does not, and a number
 * that only a support desk could look up is a number with nowhere to be quoted
 * — this directory has no support desk. So the reference is its own key: paste
 * it into `/report` and read where the report stands.
 *
 * ## What it shows, and what it never does
 *
 * The listing, the kind, when it was filed, and — once decided — the outcome
 * in words and the day. Never the reporter, never the moderator, never the
 * reason a moderator wrote: that is prose about a listing which may itself be
 * a private-information complaint, the same judgement `report_resolved`'s
 * parameters make. A reference is forty random bits, so holding one is
 * holding the report, and the `report_status` limiter keeps a script from
 * turning the page into a guessing machine anyway.
 *
 * A report about a listing that has since been suspended, closed or merged
 * still answers. The reporter asked what happened, and *the listing is gone*
 * is an answer — it is shown as the outcome the moderator recorded, never as a
 * sentence about the business's standing.
 */

export interface ReportStatus {
  reference: string;
  businessName: string;
  /** Only while the listing is still public — a dead slug is not a link. */
  businessSlug: string | null;
  kind: $Enums.ReportKind;
  filedAt: Date;
  /** Days a moderator has, from the same table the queue's clock runs on. */
  slaDays: number;
  /** Null while open. For a duplicate, the decision of the report it joined. */
  outcome: Exclude<$Enums.ReportOutcome, "duplicate"> | null;
  decidedAt: Date | null;
}

export async function reportStatus(reference: string): Promise<ReportStatus | null> {
  if (!isReference(reference)) return null;
  const report = await prisma.supplierReport.findUnique({
    where: { reference },
    select: {
      reference: true,
      kind: true,
      createdAt: true,
      outcome: true,
      resolvedAt: true,
      duplicateOf: { select: { outcome: true, resolvedAt: true } },
      subjectBusiness: {
        select: {
          displayName: true,
          slug: true,
          publishedAt: true,
          suspendedAt: true,
          closedAt: true,
          mergedIntoId: true,
        },
      },
    },
  });
  if (!report) return null;

  /*
     A duplicate reads as the decision it was closed under. *Duplicate* is the
     queue's bookkeeping; the reporter asked about the listing, and the answer
     is what happened to it.
  */
  const decided = report.outcome === "duplicate" ? report.duplicateOf : report;
  const outcome = decided?.outcome && decided.outcome !== "duplicate" ? decided.outcome : null;
  const business = report.subjectBusiness;
  const live =
    business.publishedAt !== null &&
    business.suspendedAt === null &&
    business.closedAt === null &&
    business.mergedIntoId === null;

  return {
    reference: report.reference,
    businessName: business.displayName,
    businessSlug: live ? business.slug : null,
    kind: report.kind,
    filedAt: report.createdAt,
    slaDays: Math.ceil(REPORT_SLA_HOURS[report.kind] / 24),
    outcome,
    decidedAt: outcome ? (decided?.resolvedAt ?? report.resolvedAt) : null,
  };
}
