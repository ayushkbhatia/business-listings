import type { Metadata } from "next";
import Link from "next/link";
import { Eyebrow } from "@/components/display";
import { cn } from "@/lib/cn";
import { PublicShell } from "@/components/structure";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { LegalBlock, LegalDocument } from "@/lib/legal/documents";
import { siblingsOf } from "@/lib/legal/pages";
import { absoluteUrl } from "@/lib/site";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { LegalSectionNav } from "./_SectionNav";

/**
 * The shared legal template — board 13f §2, and the reason 13f, 13g and 13h
 * were buildable in parallel.
 *
 * 212px section nav · 680px measure · 236px rail. One component, three content
 * documents, and nothing here knows which one it is drawing.
 *
 * ## The frame must not be a scroll container
 *
 * Both side columns are `position: sticky`. An `overflow: hidden` on any
 * ancestor makes that ancestor a scroll container, sticky then resolves against
 * something that never scrolls, and the columns scroll away with no error
 * anywhere. `PublicShell` sets no overflow and nothing here does either; if a
 * wrapper ever needs to clip a corner radius, it clips with `overflow: clip`.
 *
 * ## The offset is the site nav
 *
 * `PublicNav` is `sticky top-0` and 68px tall. The stuck columns sit at 84px —
 * that height plus the 16px the board asks for so they are not flush to the
 * edge — and every section heading carries the same `scroll-mt`, which is what
 * makes acceptance criterion 3 true: a deep link to `#12-our-liability` lands
 * with the heading clear of the bar rather than underneath it.
 *
 * ## Print
 *
 * People print terms. `@media print` drops the site nav, the footer, the
 * section nav and the rail, lets the measure run full width, and prints the URL
 * and the version date at the end — criterion 6. All of it is `print:` variants
 * on the elements themselves rather than a stylesheet, so a column that stops
 * being printed is a visible diff.
 */

export interface LegalPageProps {
  document: LegalDocument;
}

export function legalMetadata(doc: LegalDocument): Metadata {
  return {
    title: doc.title,
    alternates: { canonical: doc.href },
  };
}

/** `**like this**` — the only markup a legal paragraph carries. */
function Emphasised({ text }: { text: string }) {
  return (
    <>
      {text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
        i % 2 === 1 ? (
          <b key={i} className="font-medium text-ink">
            {part}
          </b>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * A real `<table>`, which is CLAUDE.md's fourth non-negotiable.
 *
 * The canvas draws these as flex `<div>`s and says so in its own note; the
 * build owes header cells with `scope`, a caption, and row groups for the
 * cookie register's four category bands. The caption is visually hidden
 * because the board draws none — it is there for the reader who cannot see the
 * section heading sitting above it.
 */
function LegalTable({ block }: { block: Extract<LegalBlock, { kind: "table" }> }) {
  /*
     The register's four category bands are row groups, so each band opens a
     `tbody` and the rows under it belong to that one. A table with no bands —
     both of 13g's — is a single unlabelled group, which is what the leading
     entry here is for.
  */
  const groups: { band?: string; rows: string[][] }[] = [{ rows: [] }];
  for (const row of block.rows) {
    if (row.kind === "band") groups.push({ band: row.label, rows: [] });
    else groups[groups.length - 1]?.rows.push(row.cells);
  }

  return (
    <div className="mb-[1.625rem] mt-0.5 overflow-x-auto rounded-card border border-line bg-card print:overflow-visible">
      <table className="w-full border-collapse text-start">
        <caption className="sr-only">{block.caption}</caption>
        <thead>
          <tr className="border-b border-line bg-paper-sunk">
            {block.columns.map((column) => (
              <th
                key={column.head}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className="px-3.5 py-2.5 text-start font-mono text-colhead font-medium uppercase text-muted"
              >
                {column.head}
              </th>
            ))}
          </tr>
        </thead>
        {groups
          .filter((group) => group.rows.length > 0)
          .map((group, g) => (
          <tbody key={group.band ?? g}>
            {group.band && (
              <tr>
                {/*
                   A band is a heading for the rows under it, so it is a row
                   header spanning the group rather than a styled cell — which
                   is what lets a screen reader say "Analytics — optional"
                   before reading `bl_a_id`.
                */}
                <th
                  scope="colgroup"
                  colSpan={block.columns.length}
                  className="border-b border-line-mid bg-paper px-3.5 py-2 text-start font-mono text-colhead font-medium uppercase text-moss"
                >
                  {group.band}
                </th>
              </tr>
            )}
            {group.rows.map((cells, r) => (
              <tr key={r} className="border-b border-line-mid last:border-b-0">
                {cells.map((cell, c) => (
                  <td
                    key={c}
                    className={cn(
                      "px-3.5 py-2.5 align-top",
                      c > 0 && "text-body-sm text-body",
                      c === 0 && block.columns[c]?.mono && "font-mono text-caption text-ink",
                      c === 0 && !block.columns[c]?.mono && "text-body-sm text-ink",
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === "table") return <LegalTable block={block} />;

  if (block.kind === "eyebrow") {
    /*
       13g §1: §02's three sources are mono eyebrows and not subheadings, so
       that the section nav goes on listing twelve entries rather than fifteen.
       An `h3` would read better in an outline and would be wrong here — the
       board is explicit, and the nav is generated from headings.
    */
    return (
      <Eyebrow as="p" className="mb-2.5 mt-1">
        {block.text}
      </Eyebrow>
    );
  }

  return (
    <p className="mb-3.5 text-[0.875rem] leading-[1.75] text-body text-pretty last:mb-[1.625rem]">
      <Emphasised text={block.text} />
    </p>
  );
}

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-card-lg border border-line bg-card p-4">
      <Eyebrow as="p" className="mb-3">
        {title}
      </Eyebrow>
      {children}
    </section>
  );
}

export function LegalPage({ document: doc }: LegalPageProps) {
  const siblings = siblingsOf(doc.slug);
  const effective = formatDate(doc.effectiveFrom);

  return (
    <PublicShell
      nav={
        <div className="print:hidden">
          <DirectoryNav />
        </div>
      }
      footer={
        <div className="print:hidden">
          <DirectoryFooter />
        </div>
      }
    >
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: doc.title,
          url: absoluteUrl(doc.href),
          inLanguage: "en",
          datePublished: doc.effectiveFrom.toISOString(),
          publisher: { "@type": "Organization", name: "Business Listings" },
        }}
      />

      <div className="grid gap-x-10 gap-y-9 md:grid-cols-[13.25rem_minmax(0,1fr)] wide:grid-cols-[13.25rem_minmax(0,42.5rem)_14.75rem] print:block">
        <div className="flex flex-col gap-[1.375rem] self-start md:sticky md:top-21 md:row-span-2 wide:row-span-1 print:hidden">
          <LegalSectionNav
            label={t("legal.on_this_page")}
            items={doc.sections.map((section) => ({
              id: section.id,
              number: section.number,
              label: section.heading,
            }))}
          />

          <div className="h-px bg-line" aria-hidden />

          <nav aria-label={t("legal.siblings")}>
            <Eyebrow as="p" className="mb-3.5">
              {t("legal.siblings")}
            </Eyebrow>
            <ul className="flex flex-col gap-2.5">
              {siblings.map((sibling) => (
                <li key={sibling.href}>
                  <Link
                    href={sibling.href}
                    className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    {sibling.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <article className="min-w-0">
          <h1 className="font-serif text-[2.125rem] leading-[1.12] tracking-[-0.02em] text-ink">
            {doc.title}
          </h1>
          <p className="mt-3 font-mono text-[0.625rem] uppercase tracking-[0.08em] text-muted">
            {doc.metaLine}
          </p>
          <div className="mb-[1.625rem] mt-6 h-px bg-line" aria-hidden />

          {doc.sections.map((section) => (
            <section key={section.id} aria-labelledby={section.id}>
              {/*
                 An id a support reply already links to keeps working after a
                 renumbering: the old one stays as an empty anchor beside the
                 real heading rather than 404ing the fragment. 13f §2 calls the
                 id an API and this is the whole of honouring that.
              */}
              {section.aliases?.map((alias) => (
                <span key={alias} id={alias} className="block scroll-mt-21" aria-hidden />
              ))}
              <div className="mb-3 flex items-baseline gap-2.5">
                <span className="shrink-0 font-mono text-[0.625rem] font-medium leading-[1.7] text-muted tabular-nums">
                  {section.number}
                </span>
                <h2
                  id={section.id}
                  className="scroll-mt-21 text-[1rem] font-medium tracking-[-0.01em] text-ink"
                >
                  {section.heading}
                </h2>
              </div>
              {section.blocks.map((block, i) => (
                <Block key={i} block={block} />
              ))}
            </section>
          ))}

          {/*
             Criterion 6. A printed page with no address on it cannot be checked
             against the live one, and a printed policy with no version date
             cannot be checked against anything at all.
          */}
          <p className="hidden border-t border-line pt-3 font-mono text-caption text-muted print:block">
            {t("legal.print_source", {
              url: absoluteUrl(doc.href),
              version: effective,
            })}
          </p>
        </article>

        <aside className="flex flex-col gap-3.5 self-start wide:sticky wide:top-21 print:hidden">
          <RailCard title={t("legal.glance")}>
            <ul className="flex flex-col">
              {doc.glance.map((line, i) => (
                <li
                  key={line}
                  className={
                    i === 0
                      ? "text-[0.75rem] leading-[1.55] text-body"
                      : "mt-2.5 border-t border-fill pt-2.5 text-[0.75rem] leading-[1.55] text-body"
                  }
                >
                  {line}
                </li>
              ))}
            </ul>
          </RailCard>

          <RailCard title={t("legal.versions")}>
            <ul className="flex flex-col gap-2.5">
              <li className="flex items-baseline gap-2">
                <span className="font-mono text-caption uppercase text-muted tabular-nums">
                  {effective}
                </span>
                <span className="ms-auto text-caption text-body">{t("legal.version_current")}</span>
              </li>
            </ul>
            {/*
               13f §3: the archive starts at first publish. Two dated rows are
               drawn on the canvas and they are specimens — rendering them would
               be two links to versions that never existed, which is the padding
               CLAUDE.md's interface-honesty section is about.
            */}
            <p className="mt-3 text-caption leading-relaxed text-muted">
              {t("legal.versions_first")}
            </p>
          </RailCard>
        </aside>
      </div>
    </PublicShell>
  );
}
