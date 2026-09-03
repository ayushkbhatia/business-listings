import { Tag } from "@/components/display";
import { isPublishableDocumentKind } from "@/lib/storefront/section-types";
import { picks, type SectionProps } from "@/lib/storefront/render-data";
import { formatMonth } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Section 7 — certifications.
 *
 * **The fence is the section.** `Document` holds trade licences and VAT
 * certificates in the same private bucket as an ISO certificate, separated only
 * by an enum the seller picks — and `verify_listing.documents_hint` tells them,
 * on the upload screen, that those two are never on their public listing.
 *
 * The loader already filters to `PUBLISHABLE_DOCUMENT_KINDS`. This filters
 * again, because the promise is worth two lines of belt and braces and because
 * the specimens page feeds these components hand-written sample data that does
 * not go through the loader at all.
 */
export function Certifications({ data, content }: SectionProps) {
  const chosen = picks(content, "documents");
  const documents = (chosen.length
    ? chosen
        .map((id) => data.documents.find((document) => document.id === id))
        .filter((document): document is (typeof data.documents)[number] => document !== undefined)
    : data.documents
  ).filter((document) => isPublishableDocumentKind(document.kind));

  if (documents.length === 0) return null;

  return (
    <section>
      <h2 className="text-h2 text-brand-ink">{t("section.certifications.title")}</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {documents.map((document) => (
          <li key={document.id} className="rounded-card border border-line bg-card p-4">
            <p className="text-body-sm text-ink">{document.title}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Tag>{t(`document.kind.${document.kind}` as never)}</Tag>

              {document.validUntil && (
                <span className="font-mono text-eyebrow uppercase tabular-nums text-muted">
                  {t("section.certifications.valid_until", {
                    month: formatMonth(document.validUntil),
                  })}
                </span>
              )}

              {/*
                 A certificate lists its name and its validity, and nothing
                 opens it.

                 Board 1d: "Certificates list name and validity month only,
                 never the document." The reason is not squeamishness — an ISO
                 certificate carries the auditor's reference and a scan of one
                 is a forgeable original, and the fact a buyer needs is that the
                 supplier holds it until March 2027.

                 A catalogue or a datasheet is the opposite: it exists to be
                 downloaded, and a buyer who cannot open it has been shown a
                 filename for no reason. So the link stays for those two kinds
                 and goes for the one the board names.
              */}
              {document.kind !== "certificate" && (
                <a
                  href={document.href}
                  className="rounded-tag font-mono text-eyebrow uppercase text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                >
                  {t("section.certifications.open")}
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 max-w-prose text-caption text-faint">
        {t("section.certifications.note")}
      </p>
    </section>
  );
}
