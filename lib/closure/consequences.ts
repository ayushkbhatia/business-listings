import { t } from "@/lib/i18n";
import { formatCount } from "@/lib/format";
import { COOLING_OFF_DAYS, DOCUMENT_RETENTION_MONTHS, INVOICE_RETENTION_YEARS } from "./policy";

/**
 * Board `11i` — *What happens when you close*, as rows.
 *
 * Pure, so the page, the gallery and a unit test render one definition. Every
 * number in a cell is a parameter: the seat count is a query, the two retention
 * periods are the constants a test holds against Privacy §07, and the address
 * is this business's own slug.
 *
 * ## The table splits in two
 *
 * Three rows leave at closure and the rest are kept. Each kept row carries its
 * reason **in the cell** rather than in a footnote a seller will not read.
 *
 * ## One row the board did not draw
 *
 * Invoices. Privacy §07 keeps them five years under UAE tax law, and a closing
 * seller loses dashboard access to their own tax invoices the moment every seat
 * is revoked. Leaving the row out would let a seller discover that at their VAT
 * return. It is kept, and it says to download copies first.
 */

export type ConsequenceKind = "leaves" | "retained" | "reserved";

export interface ConsequenceRow {
  key: "listing" | "storefront" | "team" | "enquiries" | "reviews" | "documents" | "invoices" | "address";
  kind: ConsequenceKind;
  area: string;
  /** The bold lead-in on a kept row: `Kept.`, `Reserved, not released.` */
  lead: string | null;
  body: string;
  when: string;
  /** Only the invoices row, which sends the seller somewhere before they close. */
  link: { href: string; label: string } | null;
}

export interface ConsequenceFacts {
  seats: number;
  /** The storefront address under our zone, where the business has one. */
  subdomain: string | null;
  slug: string;
}

export function consequenceRows(facts: ConsequenceFacts): ConsequenceRow[] {
  const atClosure = t("closure.when.at_closure");
  const retained = t("closure.when.retained");

  return [
    {
      key: "listing",
      kind: "leaves",
      area: t("closure.row.listing"),
      lead: null,
      body: t("closure.row.listing_body"),
      when: atClosure,
      link: null,
    },
    {
      key: "storefront",
      kind: "leaves",
      area: t("closure.row.storefront"),
      lead: null,
      body: facts.subdomain
        ? t("closure.row.storefront_body_address", { address: facts.subdomain })
        : t("closure.row.storefront_body"),
      when: atClosure,
      link: null,
    },
    {
      key: "team",
      kind: "leaves",
      area: t("closure.row.team"),
      lead: null,
      body: t("closure.row.team_body", { count: facts.seats, formatted: formatCount(facts.seats) }),
      when: atClosure,
      link: null,
    },
    {
      key: "enquiries",
      kind: "retained",
      area: t("closure.row.enquiries"),
      lead: t("closure.row.kept"),
      body: t("closure.row.enquiries_body"),
      when: retained,
      link: null,
    },
    {
      key: "reviews",
      kind: "retained",
      area: t("closure.row.reviews"),
      lead: t("closure.row.kept"),
      body: t("closure.row.reviews_body"),
      when: retained,
      link: null,
    },
    {
      key: "documents",
      kind: "retained",
      area: t("closure.row.documents"),
      lead: t("closure.row.kept"),
      body: t("closure.row.documents_body", {
        months: formatCount(DOCUMENT_RETENTION_MONTHS),
        days: formatCount(COOLING_OFF_DAYS),
      }),
      when: retained,
      link: null,
    },
    {
      key: "invoices",
      kind: "retained",
      area: t("closure.row.invoices"),
      lead: t("closure.row.kept"),
      body: t("closure.row.invoices_body", { years: formatCount(INVOICE_RETENTION_YEARS) }),
      when: retained,
      link: { href: "/dashboard/billing", label: t("closure.row.invoices_link") },
    },
    {
      key: "address",
      kind: "reserved",
      area: t("closure.row.address"),
      lead: t("closure.row.reserved_lead"),
      body: t("closure.row.address_body", { path: `/b/${facts.slug}` }),
      when: t("closure.when.reserved"),
      link: null,
    },
  ];
}

/** How many kept rows are not ours to delete. The rail's argument counts them. */
export function notOursToDelete(rows: readonly ConsequenceRow[]): { notOurs: number; kept: number } {
  const kept = rows.filter((row) => row.kind !== "leaves");
  // The address is ours — reserving it is a promise we make. Everything else
  // kept is somebody else's record or held for somebody else's reason.
  const notOurs = kept.filter((row) => row.kind === "retained").length;
  return { notOurs, kept: kept.length };
}
