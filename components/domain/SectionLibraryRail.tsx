import Link from "next/link";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LibraryGroup } from "@/lib/storefront/library";
import type { TradeScope } from "@/lib/storefront/section-types";

/**
 * Board `5c-s` — the section library, as a rail of grouped cards.
 *
 * Presentational and server-safe, so the gallery renders the services, goods
 * and both states from `sectionLibrary()` and the builder renders the same
 * markup for a real template.
 *
 * **Unavailable and held sections render disabled with their reason** (B1).
 * Not links and not focusable — there is nothing to do with one but read why,
 * and the why is printed on the card. A screen reader hears that it is not
 * offered, after its name and its reason.
 */
export function SectionLibraryRail({
  groups,
  scope,
  selectedKey,
  hrefs,
  navLabel,
}: {
  groups: readonly LibraryGroup[];
  scope: TradeScope;
  selectedKey: string | null;
  /** Section key to the address that selects it. A map, not a function — this renders on the server. */
  hrefs: Readonly<Record<string, string>>;
  /**
   * The nav's accessible name. A named nav is a landmark, and two sharing a
   * name are two identical entries in a screen reader's landmark list — the
   * gallery, which renders one per state, passes its own.
   */
  navLabel: string;
}) {
  return (
    <nav aria-label={navLabel} className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 border-b border-line pb-2">
        <h2 className="text-body font-medium text-ink">{t("section.library.sections")}</h2>
        <span className="font-mono text-eyebrow uppercase text-muted">
          {t(`section.library.scope.${scope}` as never)}
        </span>
      </div>

      {groups.map((group) => (
        <div key={group.key} className="mt-4">
          <h3 className="font-mono text-eyebrow uppercase text-muted">
            {t(`section.library.group.${group.key}` as never)}
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {group.entries.map((entry) => {
              const refused = entry.state === "unavailable" || entry.state === "held";
              const current = !refused && selectedKey === entry.type.key;
              const body = (
                <>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cn("text-body-sm", refused ? "text-muted" : "text-ink")}>
                      {t(entry.type.labelKey as never)}
                    </span>
                    {entry.inUse && (
                      <span className="shrink-0 font-mono text-eyebrow uppercase text-muted">
                        {t("section.library.on_page")}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-caption text-muted">
                    {entry.reasonKey ? t(entry.reasonKey as never) : t(entry.type.sourceKey as never)}
                  </span>
                </>
              );

              return (
                <li key={entry.type.key}>
                  {refused ? (
                    <div className="block rounded-card border border-dashed border-line bg-paper-sunk px-3 py-2.5">
                      {body}
                      <span className="sr-only">{t("section.library.not_offered")}</span>
                    </div>
                  ) : (
                    <Link
                      href={hrefs[entry.type.key] ?? "#"}
                      aria-current={current ? "true" : undefined}
                      className={cn(
                        "block rounded-card border bg-card px-3 py-2.5 focus-visible:shadow-focus focus-visible:outline-none",
                        current ? "border-ink ring-1 ring-inset ring-ink" : "border-line hover:bg-paper-sunk",
                      )}
                    >
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
