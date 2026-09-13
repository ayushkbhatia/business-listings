import { DOCUMENT_TYPES, MAX_LICENCE_BYTES, safeName } from "@/lib/storage/buckets";

/**
 * Board `1d-s` — the enquiry that asks about a situation, not a quantity.
 *
 * Pure, so the refusals are unit tested and the client form can check the same
 * rules before it posts. The server re-checks every one of them: a form can
 * post anything.
 *
 * ## The fields, and why these and not the render's
 *
 * The render asks an audit firm's buyer for a financial year end and a turnover
 * band. Both are right for audit and wrong for a cleaning contract, a customs
 * broker or a marine surveyor, and the owner's standing constraint on this
 * track is that it serves every kind of firm that sells work — *anything that
 * branches per trade belongs in data, never in a component*.
 *
 * So the form asks four things that are true of every job, and lets the trade
 * speak through the copy:
 *
 *  - **which service** — prefilled from the page the buyer came from (B11);
 *  - **what you need, in your own words** — where *FY2025, AED 40m turnover*
 *    lives for an audit and *4,000 sq m, two floors, nightly* for cleaning;
 *  - **how big the job is** — decision D7's one free-text scale field, stored as
 *    a string on `Enquiry.scale`, never a controlled set per subcategory;
 *  - **needed by** — the column the goods composer already writes.
 *
 * And the attachment, optional (Q1), whose prompt comes from the service's own
 * scope sheet: the firm's *what we need from you* row, when it filled one in.
 */

/** The shortest requirement worth sending — the goods composer's own floor. */
export const REQUIREMENT_MIN = 10;
/** And the longest. A requirement is a message, not a document. */
export const REQUIREMENT_MAX = 4000;
/** D7's scale, in one line. A paragraph belongs in the requirement. */
export const SCALE_MAX = 120;
/** One file. The strongest qualifying signal, not a data room. */
export const MAX_ENQUIRY_ATTACHMENTS = 1;
/**
 * Ten megabytes, the licence step's ceiling and for the same reason: a trial
 * balance or a set of signed accounts is a handful of pages, and anything
 * larger is a scan nobody has resized.
 */
export const ENQUIRY_ATTACHMENT_BYTES = MAX_LICENCE_BYTES;
/**
 * PDF, JPEG or PNG — the private bucket's own allow-list.
 *
 * A trial balance is often a spreadsheet, and the bucket refuses spreadsheets
 * at the storage layer: widening it is a `pnpm storage:setup` against every
 * environment, not a constant here. The hint says *export it as a PDF*, which
 * is also the form a seller can open on a phone.
 */
export const ENQUIRY_ATTACHMENT_TYPES = DOCUMENT_TYPES;

export type ServiceEnquiryField =
  | "service"
  | "requirement"
  | "scale"
  | "neededBy"
  | "attachment"
  | "contact";

export type ServiceEnquiryRefusal =
  | { field: "service"; reason: "not_offered" }
  | { field: "requirement"; reason: "too_short"; min: number }
  | { field: "requirement"; reason: "too_long"; max: number }
  | { field: "scale"; reason: "too_long"; max: number }
  | { field: "neededBy"; reason: "invalid" | "past" }
  | { field: "attachment"; reason: "type" | "size" }
  | { field: "contact"; reason: "missing" };

export interface ServiceEnquiryDraft {
  /** Empty for *something not listed*. */
  service: string;
  requirement: string;
  scale: string;
  /** `YYYY-MM-DD` or empty. */
  neededBy: string;
  attachment: { type: string; bytes: number } | null;
  /** Only asked of a buyer with no account. */
  contactPhone: string | null;
}

export interface ServiceEnquiryClean {
  serviceSlug: string | null;
  requirement: string;
  scale: string | null;
  neededBy: Date | null;
}

/**
 * Clean and check. Every refusal, not the first, so a buyer over on two fields
 * is told both — the form marks each field it names.
 *
 * `offered` is the firm's live service slugs. A slug that is not one of them
 * is refused rather than dropped: the select only offers live services, so an
 * unknown value is a stale page or a hand-built post, and silently turning it
 * into *something not listed* would send the firm a different enquiry from the
 * one the buyer wrote.
 *
 * `today` is the UAE calendar date, `YYYY-MM-DD`, passed in so the rule is
 * testable and so a buyer at 23:30 in Dubai is not refused tomorrow's date by
 * a server whose clock is in UTC.
 */
export function checkServiceEnquiry(
  draft: ServiceEnquiryDraft,
  offered: readonly string[],
  today: string,
): { ok: true; value: ServiceEnquiryClean } | { ok: false; refusals: ServiceEnquiryRefusal[] } {
  const refusals: ServiceEnquiryRefusal[] = [];

  const service = draft.service.trim();
  if (service !== "" && !offered.includes(service)) {
    refusals.push({ field: "service", reason: "not_offered" });
  }

  const requirement = draft.requirement.trim();
  if (requirement.length < REQUIREMENT_MIN) {
    refusals.push({ field: "requirement", reason: "too_short", min: REQUIREMENT_MIN });
  } else if (requirement.length > REQUIREMENT_MAX) {
    refusals.push({ field: "requirement", reason: "too_long", max: REQUIREMENT_MAX });
  }

  const scale = draft.scale.trim().replace(/\s+/g, " ");
  if (scale.length > SCALE_MAX) refusals.push({ field: "scale", reason: "too_long", max: SCALE_MAX });

  let neededBy: Date | null = null;
  const date = draft.neededBy.trim();
  if (date !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      refusals.push({ field: "neededBy", reason: "invalid" });
    } else if (date < today) {
      refusals.push({ field: "neededBy", reason: "past" });
    } else {
      neededBy = new Date(`${date}T00:00:00.000Z`);
    }
  }

  if (draft.attachment) {
    const refusal = checkEnquiryAttachment(draft.attachment.type, draft.attachment.bytes);
    if (refusal) refusals.push(refusal);
  }

  if (draft.contactPhone !== null && draft.contactPhone.trim() === "") {
    refusals.push({ field: "contact", reason: "missing" });
  }

  if (refusals.length > 0) return { ok: false, refusals };
  return {
    ok: true,
    value: {
      serviceSlug: service === "" ? null : service,
      requirement,
      scale: scale === "" ? null : scale,
      neededBy,
    },
  };
}

/** The file's own refusal, or null. Shared by the pick, the send and the confirm. */
export function checkEnquiryAttachment(
  type: string,
  bytes: number,
): Extract<ServiceEnquiryRefusal, { field: "attachment" }> | null {
  if (!(ENQUIRY_ATTACHMENT_TYPES as readonly string[]).includes(type)) {
    return { field: "attachment", reason: "type" };
  }
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > ENQUIRY_ATTACHMENT_BYTES) {
    return { field: "attachment", reason: "size" };
  }
  return null;
}

/**
 * The enquiry line a service enquiry writes.
 *
 * **One line, carrying the service and no quantity** — the service-side twin of
 * a product line. `EnquiryLine.qty` is nullable since pull request 173, and null means
 * *unquantified*, not none: the seller's quote composer prices the line as a
 * whole and every renderer omits the figure rather than printing `×1`, which
 * would be the platform inventing a unit for work sold as a job.
 *
 * Where the buyer picked *something not listed*, the line is named from the
 * first sentence of what they wrote, so the seller's inbox row says what the
 * enquiry is about rather than a placeholder.
 */
export function serviceLine(
  service: { id: string; name: string } | null,
  requirement: string,
): { description: string; qty: null; serviceId: string | null } {
  if (service) return { description: service.name, qty: null, serviceId: service.id };
  const flat = requirement.replace(/\s+/g, " ").trim();
  const first = flat.split(/(?<=[.?!])\s/)[0] ?? flat;
  return {
    description: first.length > 120 ? `${first.slice(0, 119).trimEnd()}…` : first,
    qty: null,
    serviceId: null,
  };
}

/**
 * Where an enquiry's file lives in the private bucket.
 *
 * Under the enquiry's id, never the buyer's or a business's: the file belongs
 * to one conversation, the recipients who can read it are the enquiry's, and a
 * path that cannot be derived from anything else is a path the confirm step can
 * check a posted value against.
 */
export function enquiryAttachmentPath(enquiryId: string, filename: string): string {
  return `enquiries/${enquiryId}/${safeName(filename)}`;
}

/** Whether a posted path is one this enquiry's signed upload could have written. */
export function isEnquiryAttachmentPath(enquiryId: string, path: string): boolean {
  const prefix = `enquiries/${enquiryId}/`;
  return (
    path.startsWith(prefix) &&
    /^[a-z0-9.-]+$/.test(path.slice(prefix.length)) &&
    !path.includes("..")
  );
}

/** A filename fit to show a seller: the buyer's own, trimmed to something a row can hold. */
export function displayFilename(raw: string): string {
  const name = raw.replace(/[\\/]+/g, " ").replace(/\s+/g, " ").trim();
  if (name === "") return "attachment";
  return name.length > 120 ? `${name.slice(0, 80)}…${name.slice(-30)}` : name;
}

/** Today's date in Dubai, `YYYY-MM-DD`. The UAE has one zone and no DST. */
export function uaeToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
