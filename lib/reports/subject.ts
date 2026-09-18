import "server-only";
import { prisma } from "@/lib/db/client";
import {
  FIELDS_FOR_KIND,
  PUBLIC_REPORT_KINDS,
  type PublicReportKind,
  type ReportSubjectField,
} from "./taxonomy";

/**
 * Board 13c — the listing a report is about, read once, for both the form and
 * the write.
 *
 * Two questions, and one reader for both so they cannot disagree:
 *
 *   1. **Which fields can this listing be reported on?** Only the ones it
 *      shows. `4h`'s taxonomy lets *A detail is wrong* name the website, and no
 *      listing in this directory has published a website — there is no column
 *      for one. A form that offers *Website* under a storefront with no website
 *      on it is offering a complaint about nothing, and the moderator who
 *      receives it has nothing to check. The same goes for *Opening hours* on a
 *      listing with none and *A photograph* on a listing with no photographs.
 *
 *   2. **What does the listing say today?** The value `B2` aggregates on. Read
 *      here, server-side, at the moment of filing — never posted by the form.
 *
 * The form is built from the first answer and the server action checks the
 * write against the same one, so a field removed from a listing between the
 * page loading and the report arriving is refused with a sentence rather than
 * filed against a value that is no longer there.
 */

export interface ReportSubject {
  id: string;
  slug: string;
  displayName: string;
  claimStatus: "unclaimed" | "claimed" | "disputed";
  licenceNumber: string;
  licenceExpiry: Date;
  primaryCategoryId: string;
  /** The first published location's number, or the first number at all. */
  phone: string | null;
  address: string | null;
  hasHours: boolean;
  hasPhoto: boolean;
  hasDescription: boolean;
}

/**
 * The listing, or null where there is no public page to report.
 *
 * Unpublished, suspended, closed and merged listings all return null. Each of
 * them 404s or redirects on `/b/:slug`, so a report about one would be about a
 * page the reporter cannot be looking at — and saying *that listing is
 * suspended* would tell a stranger something the storefront deliberately does
 * not.
 */
export async function reportSubject(slug: string): Promise<ReportSubject | null> {
  const business = await prisma.business.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      displayName: true,
      claimStatus: true,
      licenceNumber: true,
      licenceExpiry: true,
      primaryCategoryId: true,
      description: true,
      headline: true,
      publishedAt: true,
      suspendedAt: true,
      closedAt: true,
      mergedIntoId: true,
      /*
         Published first, then the oldest, which is the order the storefront
         reads `locations[0]` in for its header. The phone a buyer rang is the
         one on the page they were reading.
      */
      locations: {
        orderBy: [{ published: "desc" }, { createdAt: "asc" }, { id: "asc" }],
        select: { phone: true, addressLine: true, hours: true },
      },
      _count: { select: { media: { where: { kind: "gallery" } } } },
    },
  });
  if (
    !business ||
    !business.publishedAt ||
    business.suspendedAt ||
    business.closedAt ||
    business.mergedIntoId
  ) {
    return null;
  }

  const productPhotos =
    business._count.media > 0
      ? 0
      : await prisma.productMedia.count({
          where: { product: { businessId: business.id } },
        });

  const head = business.locations[0] ?? null;
  const phone = business.locations.find((location) => location.phone)?.phone ?? null;
  const hasHours = business.locations.some(
    (location) =>
      location.hours !== null &&
      typeof location.hours === "object" &&
      Object.keys(location.hours as Record<string, unknown>).length > 0,
  );

  return {
    id: business.id,
    slug: business.slug,
    displayName: business.displayName,
    claimStatus: business.claimStatus,
    licenceNumber: business.licenceNumber,
    licenceExpiry: business.licenceExpiry,
    primaryCategoryId: business.primaryCategoryId,
    phone,
    address: head?.addressLine ?? null,
    hasHours,
    hasPhoto: business._count.media > 0 || productPhotos > 0,
    hasDescription: Boolean(business.description?.trim() || business.headline?.trim()),
  };
}

/**
 * True where the listing shows this field, so a report about it has a subject.
 *
 * An **unclaimed** storefront shows the licence record and nothing else — the
 * name, the licence, the area, the trade — and deliberately no telephone, no
 * hours, no photograph and no description, because nobody has vouched for any
 * of them (`1d`: *an unclaimed listing says plainly that nothing is verified*).
 * The import may hold a number; the page does not print it. So the form does
 * not offer it either: a report about a number the reporter cannot have read
 * off this listing is a report about some other page.
 */
export function showsField(subject: ReportSubject, field: ReportSubjectField): boolean {
  const unclaimed = subject.claimStatus === "unclaimed";
  switch (field) {
    case "phone":
      return !unclaimed && subject.phone !== null;
    case "address":
      return subject.address !== null;
    case "hours":
      return !unclaimed && subject.hasHours;
    case "photo":
      return !unclaimed && subject.hasPhoto;
    case "description":
      return !unclaimed && subject.hasDescription;
    /*
       No listing publishes one. `REPORT_SUBJECT_FIELDS` keeps the value so that
       a row written before this board still reads, and so the day a website
       column lands it is one line here rather than a migration.
    */
    case "website":
      return false;
    case "name":
    case "category":
    case "licence":
      return true;
  }
}

/** The fields this listing may be reported on under one kind, in taxonomy order. */
export function fieldsFor(subject: ReportSubject, kind: PublicReportKind): ReportSubjectField[] {
  return FIELDS_FOR_KIND[kind].filter((field) => showsField(subject, field));
}

/**
 * The kinds this listing may be reported under — every public kind that has at
 * least one field left once the listing's own gaps are taken out.
 *
 * *A photograph or a description is not theirs* on a listing with neither is
 * a reason with nothing under it, and a radio button that leads to an empty
 * select is a form that looks broken. It is left off instead.
 */
export function kindsFor(subject: ReportSubject): PublicReportKind[] {
  return PUBLIC_REPORT_KINDS.filter((kind) => fieldsFor(subject, kind).length > 0);
}

/**
 * What the listing says about this field today, as a person would read it.
 *
 * Null where the field is not a value — hours, a photograph, the category —
 * and `subjectValueKey` then aggregates by listing instead.
 */
export function currentValue(subject: ReportSubject, field: ReportSubjectField): string | null {
  switch (field) {
    case "phone":
      return subject.phone;
    case "address":
      return subject.address;
    case "name":
      return subject.displayName;
    case "licence":
      return subject.licenceNumber;
    default:
      return null;
  }
}
