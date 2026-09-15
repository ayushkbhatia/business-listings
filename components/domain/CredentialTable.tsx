import { cn } from "@/lib/cn";
import { formatMonth } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Check, Minus } from "@/components/primitives/icons";

/**
 * What a firm holds, and who checked it — boards `1d-s`, `1g-s` and the
 * storefront's credentials tab.
 *
 * **One component, because the two boards say so.** `1d-s`'s one cross-board
 * invariant is that it and `1g-s` render credentials identically: *"if they
 * drift, a buyer sees a different firm on two pages of the same listing."* The
 * service page had its own list; this replaces it, and the storefront overview
 * and the credentials tab mount the same thing.
 *
 * ## An unverified claim must never render like a verified one
 *
 * `8b-s` B10, `1d-s` B3. The separation is structural before it is a colour:
 *
 *  - a checked row carries a filled check **and** the register that answered,
 *    by name, in words;
 *  - a claim carries a dash **and** whose claim it is, by name — *"Stated by
 *    Meridian Chartered Accountants"* — which tells a buyer exactly what the line
 *    is worth.
 *
 * Neither mark is a storefront colour. Trust signals come from the status
 * palette and render the same on every storefront — non-negotiable 2.
 *
 * ## Validity renders, and nothing tracks it
 *
 * `1d-s` B4, `8b-s` B5. A date the certificate carries is printed as it is, in
 * the past or not. There is no *expired* badge, no strike-through and no
 * re-ordering on expiry: a buyer reading a lapsed date has learned something
 * true, and a platform that re-badged on a date it does not verify would be
 * inventing a check. `3e-s` was cut for exactly this.
 *
 * ## A real table
 *
 * Non-negotiable 4. The board draws divs; the build does not. The render has no
 * column heads, and the build draws them anyway, small and mono: a visually
 * hidden `<thead>` is taken out of the table's layout, so its heads no longer
 * sit over their own columns — which is the misalignment `gallery.spec.ts`
 * measures every table for — and a sighted reader loses the one line saying
 * which column is the register and which is the date.
 *
 * Presentational and server-safe. It owns no loading — `publicCredentialsFor`
 * never selects the document path, so no file can reach this.
 */

export interface CredentialView {
  id: string;
  kind: string;
  identifier: string | null;
  issuer: string | null;
  expiresOn: Date | null;
  verified: boolean;
  /** The register that answered, named. Null on a claim. */
  verifiedBy: string | null;
}

export interface CredentialTableProps {
  rows: readonly CredentialView[];
  /** The firm's display name, for the claim line. Never the trade name. */
  name: string;
  /** The table's accessible name. */
  caption: string;
  /** Rendered as the last row, in the table's own footer. `1d-s`'s *see all*. */
  footer?: React.ReactNode;
}

export function CredentialTable({ rows, name, caption, footer }: CredentialTableProps) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-card">
      <table className="w-full border-collapse text-body-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line bg-paper-sunk">
            <th scope="col" className="py-2 pe-4 ps-4 text-start font-mono text-colhead font-normal uppercase text-muted sm:ps-5">
              {t("credentials_public.col_credential")}
            </th>
            <th scope="col" className="py-2 pe-4 text-start font-mono text-colhead font-normal uppercase text-muted">
              {t("credentials_public.col_detail")}
            </th>
            <th scope="col" className="py-2 pe-4 text-end font-mono text-colhead font-normal uppercase text-muted sm:pe-5">
              {t("credentials_public.col_validity")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-line last:border-b-0">
              <th scope="row" className="py-3 pe-4 ps-4 text-start align-top font-normal sm:ps-5">
                <div className="flex items-start gap-3">
                  <TrustMark verified={row.verified} />
                  <div className="min-w-0">
                    <span className="block font-medium text-ink">{credentialName(row)}</span>
                    {/*
                       The half of B3 that is words. A claim line is present on
                       every unchecked row, so the difference survives greyscale,
                       a colour-blind reader and a screen reader alike.
                    */}
                    <span
                      className={cn(
                        "mt-0.5 block text-caption",
                        row.verified ? "text-ok-ink" : "text-muted",
                      )}
                    >
                      {row.verified
                        ? row.verifiedBy
                          ? t("service_public.credential_by", { register: row.verifiedBy })
                          : t("credentials.tier.register_verified")
                        : t("service_public.credential_claim", { name })}
                    </span>
                  </div>
                </div>
              </th>
              <td className="py-3 pe-4 align-top text-body">{detailOf(row)}</td>
              <td className="whitespace-nowrap py-3 pe-4 text-end align-top font-mono text-eyebrow uppercase text-muted sm:pe-5">
                {row.expiresOn === null
                  ? null
                  : t("credentials_public.valid_to", { when: formatMonth(row.expiresOn) })}
              </td>
            </tr>
          ))}
        </tbody>
        {footer ? (
          <tfoot>
            <tr className="border-t border-line bg-paper-sunk">
              <td colSpan={3} className="px-4 py-2.5 sm:px-5">
                {footer}
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/**
 * The two marks. Shape first, colour second — a filled check and a dash differ
 * in outline, so the distinction does not rest on hue.
 */
function TrustMark({ verified }: { verified: boolean }) {
  return verified ? (
    <span
      aria-hidden
      className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-ok text-on-ink"
    >
      <Check size={12} />
    </span>
  ) : (
    <span
      aria-hidden
      className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-line-strong text-muted"
    >
      <Minus size={12} />
    </span>
  );
}

/**
 * What the buyer calls it.
 *
 * `other` is the seller form's *Something else*, which is a prompt and not a
 * name. On a buyer's surface the firm's own words stand in for it — the issuer
 * if they gave one, the identifier otherwise — and only an `other` with neither
 * falls back to the generic label.
 */
export function credentialName(row: Pick<CredentialView, "kind" | "issuer" | "identifier">): string {
  if (row.kind === "other") {
    return row.issuer ?? row.identifier ?? t("credentials_public.kind.other");
  }
  return t(`credentials_public.kind.${row.kind}` as "credentials_public.kind.fta_tax_agent");
}

/**
 * Issuer and identifier, where the firm gave them.
 *
 * Absent rather than *Not provided*: a trust line with nothing to compare
 * against is not the scope table, where the grey row is the point. An `other`
 * whose issuer already became its name does not print it twice.
 */
function detailOf(row: CredentialView): string {
  const issuer = row.kind === "other" ? null : row.issuer;
  const identifier =
    row.kind === "other" && row.issuer === null ? null : row.identifier;
  return [issuer, identifier].filter((part): part is string => Boolean(part)).join(" · ");
}
