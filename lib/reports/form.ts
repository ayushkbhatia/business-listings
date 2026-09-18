import "server-only";
import { prisma } from "@/lib/db/client";
import { t } from "@/lib/i18n";
import { MAX_DETAIL } from "./file";
import { REPORT_SLA_HOURS } from "./sla";
import { fieldsFor, kindsFor, type ReportSubject } from "./subject";
import {
  CLAIM_DISPUTE_REASON,
  MAX_CORRECTION,
  takesCorrection,
  type PublicReportKind,
} from "./taxonomy";

/**
 * Board 13c — everything the report form needs, worded, as data.
 *
 * One builder for both places the form renders: the modal over the storefront
 * (`/b/:slug?report=1`) and the page it degrades to (`/report/:slug`). Two
 * surfaces for one form is the shape this codebase has learnt to distrust — a
 * second route keeps none of the first one's promises — so the second surface
 * is allowed to exist only on the condition that it cannot differ: same
 * builder, same component, same server action, same writer.
 *
 * Data rather than components, because the form is a client component and the
 * one thing a server may not hand it is a function. Every label is resolved
 * here; the client only chooses between them.
 */

/** The inputs a refusal can point at, so the form marks the right one invalid. */
export type ReportFieldName = "kind" | "field" | "detail" | "correction" | "category" | "email";

/** What the file action answers. Declared here so the client imports a type, not a server file. */
export type FileResult =
  | {
      ok: true;
      reference: string;
      replyTo: "account" | "email" | null;
      /** The address repeated back, so a typo is seen while it can still be put right. */
      email: string | null;
    }
  | { ok: false; error: string; fix: string; field?: ReportFieldName };

export interface ReportFieldOption {
  value: string;
  label: string;
  /** `B1` — the field takes *what should it say*. */
  takesCorrection: boolean;
  /** `B9` — the field takes a suggested trade. */
  takesCategory: boolean;
}

export interface ReportReasonOption {
  value: PublicReportKind | typeof CLAIM_DISPUTE_REASON;
  label: string;
  description: string;
  /** Empty for the claim route, which files nothing. */
  fields: ReportFieldOption[];
  /** Days a moderator has to decide it — `lib/reports/sla.ts`, never restated. */
  slaDays: number;
}

export interface CategoryGroup {
  label: string;
  options: { value: string; label: string }[];
}

export interface ReportFormData {
  slug: string;
  businessName: string;
  reasons: ReportReasonOption[];
  /** Offered under *Not this trade*, grouped by sector. The listing's own is left out. */
  categories: CategoryGroup[];
  /** Signed in: the reply goes to the account, and the email field is not asked. */
  signedIn: boolean;
  /** `B10` — where an ownership claim goes instead of the queue. */
  claimHref: string;
  limits: { detail: number; correction: number };
}

export async function reportFormData(
  subject: ReportSubject,
  signedIn: boolean,
): Promise<ReportFormData> {
  const kinds = kindsFor(subject);
  const offersCategory = kinds.includes("wrong_trade") && fieldsFor(subject, "wrong_trade").includes("category");

  const reasons: ReportReasonOption[] = kinds.map((kind) => ({
    value: kind,
    label: t(`report_listing.kind.${kind}` as "report_listing.kind.closed"),
    description: t(`report_listing.kind_hint.${kind}` as "report_listing.kind_hint.closed"),
    fields: fieldsFor(subject, kind).map((field) => ({
      value: field,
      label: t(`report_listing.field.${field}` as "report_listing.field.phone"),
      takesCorrection: takesCorrection(field),
      takesCategory: kind === "wrong_trade" && field === "category",
    })),
    slaDays: Math.ceil(REPORT_SLA_HOURS[kind] / 24),
  }));

  /*
     `B10`. Always last, and always offered: a rightful owner who has found
     their company under somebody else's account is the one visitor for whom
     this modal is not optional reading. On an unclaimed listing it is still
     the right door — a claim is how the owner gets the listing either way.
  */
  reasons.push({
    value: CLAIM_DISPUTE_REASON,
    label: t("report_listing.kind.claim_dispute"),
    description:
      subject.claimStatus === "unclaimed"
        ? t("report_listing.kind_hint.claim_dispute_unclaimed")
        : t("report_listing.kind_hint.claim_dispute"),
    fields: [],
    slaDays: 0,
  });

  return {
    slug: subject.slug,
    businessName: subject.displayName,
    reasons,
    categories: offersCategory ? await categoryGroups(subject.primaryCategoryId) : [],
    signedIn,
    claimHref: `/onboarding/claim?q=${encodeURIComponent(subject.displayName)}`,
    limits: { detail: MAX_DETAIL, correction: MAX_CORRECTION },
  };
}

/**
 * `4d`'s tree, two levels, as select groups — sector, then the trades in it.
 *
 * The sector itself is the first option of its own group: some listings are
 * filed at that level, and a reporter who knows only *this is a construction
 * firm, not an electrical one* has said something a moderator can use.
 * Categories kept out of the index are kept out of this list for the reason
 * they are kept out of the index.
 */
async function categoryGroups(exclude: string): Promise<CategoryGroup[]> {
  const rows = await prisma.category.findMany({
    where: { showInIndex: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, parentId: true },
  });
  const tops = rows.filter((row) => row.parentId === null);
  return tops
    .map((top) => ({
      label: top.name,
      options: [
        { value: top.id, label: t("report_listing.category_general", { sector: top.name }) },
        ...rows
          .filter((row) => row.parentId === top.id)
          .map((row) => ({ value: row.id, label: row.name })),
      ].filter((option) => option.value !== exclude),
    }))
    .filter((group) => group.options.length > 0);
}
