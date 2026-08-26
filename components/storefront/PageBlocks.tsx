import { Tag } from "@/components/display";
import { blockSpec, type Block } from "@/lib/storefront/blocks";
import type { StorefrontDocument } from "@/lib/storefront/render-data";
import { t } from "@/lib/i18n";

/**
 * A template page's blocks, rendered.
 *
 * Eight kinds of paragraph rather than fourteen kinds of query — a storefront
 * home is data and a page is prose. Nothing here reads the seller's catalogue.
 *
 * A block whose kind has left the vocabulary is skipped rather than thrown on,
 * the same call `resolveSections` and `readBlocks` make: a deploy that made
 * every About page in a sector 500 is worse than one that dropped a paragraph.
 */

function list(values: Record<string, unknown>, key: string): { label: string; value: string }[] {
  const raw = values[key];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is { label?: unknown; value?: unknown } => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      label: typeof entry.label === "string" ? entry.label : "",
      value: typeof entry.value === "string" ? entry.value : "",
    }))
    .filter((entry) => entry.label || entry.value);
}

function line(values: Record<string, unknown>, key: string): string {
  const value = values[key];
  return typeof value === "string" ? value : "";
}

export interface PageBlocksProps {
  blocks: readonly Block[];
  /** For the certifications block. Already fenced to publishable kinds. */
  documents: readonly StorefrontDocument[];
  catalogueHref: string;
  enquireHref: string;
}

export function PageBlocks({ blocks, documents, catalogueHref, enquireHref }: PageBlocksProps) {
  return (
    <div className="flex flex-col gap-6">
      {blocks.map((block) => {
        if (!blockSpec(block.kind)) return null;

        switch (block.kind) {
          case "heading":
            return (
              <h2 key={block.id} className="text-h2 text-brand-ink">
                {line(block.values, "text")}
              </h2>
            );

          case "text":
            return (
              <p key={block.id} className="max-w-[var(--measure-prose)] text-prose text-prose">
                {line(block.values, "body")}
              </p>
            );

          case "image_text":
            return (
              <div key={block.id} className="grid gap-4 sm:grid-cols-2">
                {line(block.values, "image") && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={line(block.values, "image")}
                    alt={line(block.values, "alt")}
                    className="w-full rounded-card border border-line object-cover"
                  />
                )}
                <p className="max-w-[var(--measure-prose)] text-prose text-prose">
                  {line(block.values, "body")}
                </p>
              </div>
            );

          case "numbers":
            return (
              <dl key={block.id} className="grid gap-4 sm:grid-cols-3">
                {list(block.values, "items").map((item) => (
                  <div key={item.label} className="rounded-card border border-line bg-card p-4">
                    <dt className="font-mono text-eyebrow uppercase text-muted">{item.label}</dt>
                    <dd className="mt-1 text-h2 tabular-nums text-brand-ink">{item.value}</dd>
                  </div>
                ))}
              </dl>
            );

          case "timeline":
            return (
              <ol key={block.id} className="flex flex-col gap-3">
                {list(block.values, "items").map((item) => (
                  <li key={item.label} className="border-s-2 border-brand-line ps-4">
                    <p className="font-mono text-eyebrow uppercase text-muted">{item.label}</p>
                    <p className="mt-1 text-body-sm text-prose">{item.value}</p>
                  </li>
                ))}
              </ol>
            );

          case "gallery":
            return (
              <ul key={block.id} className="grid gap-3 sm:grid-cols-3">
                {list(block.values, "images").map((image) => (
                  <li key={image.value}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.value}
                      alt={image.label}
                      className="w-full rounded-card border border-line object-cover"
                    />
                  </li>
                ))}
              </ul>
            );

          case "certifications":
            return documents.length === 0 ? null : (
              <ul key={block.id} className="grid gap-3 sm:grid-cols-2">
                {documents.map((document) => (
                  <li key={document.id} className="rounded-card border border-line bg-card p-4">
                    <p className="text-body-sm text-ink">{document.title}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Tag>{t(`document.kind.${document.kind}` as never)}</Tag>
                      <a
                        href={document.href}
                        className="rounded-tag font-mono text-eyebrow uppercase text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                      >
                        {t("section.certifications.open")}
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            );

          case "cta":
            return (
              <div
                key={block.id}
                className="rounded-card border border-brand-line bg-brand-wash px-5 py-4"
              >
                <p className="max-w-[var(--measure-prose)] text-body-sm text-prose">
                  {line(block.values, "text")}
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <a
                    href={catalogueHref}
                    className="rounded-tag text-body-sm text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {line(block.values, "label") || t("section.catalogue.title")}
                  </a>
                  <a
                    href={enquireHref}
                    className="rounded-tag text-body-sm text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {t("section.hero.enquire")}
                  </a>
                </div>
              </div>
            );

          default:
            return null;
        }
      })}
    </div>
  );
}
