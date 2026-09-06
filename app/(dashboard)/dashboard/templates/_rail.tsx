import Link from "next/link";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * Board 3h §3 — the templates rail.
 *
 * `YOUR TEMPLATES` with the products on each, then what is left in the library.
 * A category plainly needs more than one template — valves and fittings are
 * both "HVAC" — so this is not the `6c` taxonomy tree with a different label,
 * and the spec says to stop implying it is.
 *
 * The library list is what this business has not already cloned. "Browse all
 * 84" on the board was a constant of unclear provenance; the count here is what
 * the query returned.
 */
export interface RailTemplate {
  slug: string;
  name: string;
  products: number;
  pendingChanges: number;
}

export interface RailClonable {
  id: string;
  name: string;
}

export function TemplatesRail({
  templates,
  clonable,
  activeSlug,
  cloneAction,
}: {
  templates: readonly RailTemplate[];
  clonable: readonly RailClonable[];
  activeSlug: string | null;
  cloneAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <div className="flex w-full shrink-0 flex-col gap-[var(--gutter)] xl:w-[200px]">
      <Panel eyebrow={t("template.rail_yours")} padded={false}>
        <ul className="flex flex-col">
          {templates.map((template) => (
            <li key={template.slug} className="border-b border-line last:border-0">
              <Link
                href={`/dashboard/templates/${template.slug}`}
                aria-current={template.slug === activeSlug ? "page" : undefined}
                className={`flex items-baseline justify-between gap-2 px-3 py-2 text-body-sm focus-visible:outline-none focus-visible:shadow-focus ${
                  template.slug === activeSlug
                    ? "bg-ink text-on-ink"
                    : "text-ink hover:bg-paper-sunk"
                }`}
              >
                <span className="min-w-0 truncate">{template.name}</span>
                <span className="shrink-0 font-mono tabular-nums text-caption opacity-80">
                  {template.products}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>

      {clonable.length > 0 ? (
        <Panel eyebrow={t("template.rail_library")} padded={false}>
          <ul className="flex flex-col">
            {clonable.map((sheet) => (
              <li key={sheet.id} className="border-b border-line last:border-0">
                <form action={cloneAction}>
                  <input type="hidden" name="platformTemplateId" value={sheet.id} />
                  <button
                    type="submit"
                    className="w-full px-3 py-2 text-left text-body-sm text-ink hover:bg-paper-sunk focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {sheet.name}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Panel>
      ) : (
        <Panel eyebrow={t("template.rail_library")}>
          <p className="text-caption text-muted">{t("template.rail_none")}</p>
        </Panel>
      )}
    </div>
  );
}
