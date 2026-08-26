import { isPublishableDocumentKind } from "@/lib/storefront/section-types";
import { picks, type SectionProps } from "@/lib/storefront/render-data";
import { t } from "@/lib/i18n";

/**
 * Section 14 — downloads.
 *
 * The same fence as Certifications, for the same reason: `Document` holds trade
 * licences in the same private bucket as a datasheet, and the seller was told
 * in writing that those never appear on their public listing.
 */
export function Downloads({ data, content }: SectionProps) {
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
      <h2 className="text-h2 text-brand-ink">{t("section.downloads.title")}</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {documents.map((document) => (
          <li key={document.id}>
            <a
              href={document.href}
              className="flex items-baseline justify-between gap-3 rounded-card border border-line bg-card px-4 py-3 text-body-sm text-ink hover:border-brand focus-visible:outline-none focus-visible:shadow-focus"
            >
              <span className="min-w-0">{document.title}</span>
              <span className="font-mono text-eyebrow uppercase text-muted">
                {t(`document.kind.${document.kind}` as never)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
