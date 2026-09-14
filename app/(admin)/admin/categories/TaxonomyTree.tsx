"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { SearchField } from "@/components/primitives";
import { ChevronDown } from "@/components/primitives/icons";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  matchTree,
  sectorOf,
  visibleChildren,
  type TaxonomyTree as Tree,
  type TreeNode,
} from "@/lib/taxonomy/tree-model";

/**
 * Board 4d — the tree.
 *
 * A disclosure list, not an ARIA `tree`. Every row is a link that opens the
 * category in the editor and every sector has a button that opens or closes its
 * subcategories: both are ordinary Tab stops that behave the way a keyboard
 * user already expects, where a `role="tree"` owes a roving tab index and arrow
 * keys and is the pattern most often shipped half-working. Lists are lists
 * (§09.2).
 *
 * Every count is the row's own figure from `buildTree`, the same array the
 * header totals, so the tree cannot disagree with the sentence above it (`B1`).
 * Nothing marks a subcategory as too thin for its page: that prompt was cut at
 * the client's request, and the number that drove it exists nowhere here.
 */

function hrefFor(id: string): string {
  return `/admin/categories?c=${encodeURIComponent(id)}`;
}

function Count({ value, inverse = false }: { value: number; inverse?: boolean }) {
  return (
    <span className={cn("ms-auto shrink-0 font-mono text-eyebrow tabular-nums", inverse ? "text-on-ink-muted" : "text-muted")}>
      {formatCount(value)}
    </span>
  );
}

function Suppressed({ node, inverse = false }: { node: TreeNode; inverse?: boolean }) {
  if (node.showInIndex) return null;
  return (
    <span className={cn("shrink-0 font-mono text-eyebrow uppercase", inverse ? "text-on-ink-muted" : "text-muted")}>
      {t("taxonomy.tree.not_in_index")}
    </span>
  );
}

export function TaxonomyTree({ tree, selectedId }: { tree: Tree; selectedId: string | null }) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const openSector = selectedId ? sectorOf(tree, selectedId) : null;
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(openSector ? [openSector.id] : []));
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(() => new Set());

  const { matches, count } = useMemo(() => matchTree(tree, query), [tree, query]);
  const searching = query.trim().length > 0;

  const toggle = (set: ReadonlySet<string>, id: string, force?: boolean) => {
    const next = new Set(set);
    if (force ?? !next.has(id)) next.add(id);
    else next.delete(id);
    return next;
  };

  /*
     A selection that arrives from outside the tree — the merge tool landing on
     its target, an added category, a link — opens its sector. Adjusted during
     render against the last selection seen, rather than in an effect, so the
     first paint already shows the row.
  */
  const [seen, setSeen] = useState(selectedId);
  if (seen !== selectedId) {
    setSeen(selectedId);
    if (openSector) setOpen((current) => toggle(current, openSector.id, true));
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <SearchField
        id={searchId}
        label={t("taxonomy.tree.search")}
        placeholder={t("taxonomy.tree.search")}
        clearLabel={t("taxonomy.tree.search_clear")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery("")}
      />

      {/* Polite, and only while searching: the count is the answer to a question typed. */}
      <p aria-live="polite" className={cn("text-caption text-muted", !searching && "sr-only")}>
        {searching ? t("taxonomy.tree.matches", { count, query: query.trim() }) : ""}
      </p>

      {matches.length === 0 ? (
        <div className="rounded-panel border border-line bg-card px-4 py-6 text-center">
          <p className="text-body-sm text-body">{t("taxonomy.tree.no_match", { query: query.trim() })}</p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="mt-2 rounded-tag text-caption text-moss underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("taxonomy.tree.search_clear")}
          </button>
        </div>
      ) : (
        <ul aria-label={t("taxonomy.tree.label")} className="flex flex-col gap-0.5">
          {matches.map(({ sector, children }) => {
            const expanded = searching || open.has(sector.id);
            const holdsSelection = selectedId !== null && selectedId !== sector.id && openSector?.id === sector.id;
            const selected = selectedId === sector.id;
            const listId = `${searchId}-${sector.id}`;
            const { shown, hidden } = searching
              ? { shown: children, hidden: 0 }
              : visibleChildren(children, { selectedId, expanded: showAll.has(sector.id) });

            return (
              <li key={sector.id}>
                <div
                  className={cn(
                    "flex items-center gap-1 rounded-ctl border-[1.5px] border-transparent",
                    holdsSelection && "bg-ink",
                    selected && "border-moss bg-moss-wash",
                  )}
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={children.length ? listId : undefined}
                    aria-label={t(expanded ? "taxonomy.tree.collapse" : "taxonomy.tree.expand", { name: sector.name })}
                    disabled={searching || sector.children.length === 0}
                    onClick={() => setOpen((current) => toggle(current, sector.id))}
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-tag focus-visible:outline-none focus-visible:shadow-focus",
                      holdsSelection ? "text-on-ink-muted" : "text-muted",
                      sector.children.length === 0 && "invisible",
                    )}
                  >
                    <ChevronDown
                      size={12}
                      className={cn("transition-transform duration-120 ease-out", !expanded && "-rotate-90 rtl:rotate-90")}
                    />
                  </button>
                  <Link
                    href={hrefFor(sector.id)}
                    scroll={false}
                    aria-current={selected ? "page" : undefined}
                    onClick={() => setOpen((current) => toggle(current, sector.id, true))}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-tag py-2 pe-3 text-body-sm focus-visible:outline-none focus-visible:shadow-focus",
                      holdsSelection ? "text-on-ink" : "text-ink",
                    )}
                  >
                    <span className="truncate">{sector.name}</span>
                    <Suppressed node={sector} inverse={holdsSelection} />
                    <Count value={sector.listings} inverse={holdsSelection} />
                  </Link>
                </div>

                {expanded && shown.length > 0 ? (
                  <ul id={listId} className="mt-0.5 flex flex-col gap-0.5 ps-8">
                    {shown.map((child) => {
                      const current = selectedId === child.id;
                      return (
                        <li key={child.id}>
                          <Link
                            href={hrefFor(child.id)}
                            scroll={false}
                            aria-current={current ? "page" : undefined}
                            className={cn(
                              "flex items-center gap-2 rounded-ctl border-[1.5px] px-3 py-1.5 text-body-sm focus-visible:outline-none focus-visible:shadow-focus",
                              current ? "border-moss bg-moss-wash text-ink" : "border-transparent text-body hover:bg-paper-sunk",
                            )}
                          >
                            <span className="truncate">{child.name}</span>
                            <Suppressed node={child} />
                            <Count value={child.listings} />
                          </Link>
                        </li>
                      );
                    })}
                    {hidden > 0 ? (
                      <li>
                        <button
                          type="button"
                          onClick={() => setShowAll((current) => toggle(current, sector.id, true))}
                          className="rounded-tag px-3 py-1.5 text-body-sm text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                        >
                          {t("taxonomy.tree.more", { count: hidden })}
                        </button>
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
