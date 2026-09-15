import { Tabs } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board `12g-s` — the three tabs of the string store. Routes, not buttons.
 *
 * *All* is the catalogue report `12g` shipped, *Paired* is this board, and
 * *Templates* is `12g`'s notification templates — the other place a string
 * carries a services twin — which already has a screen of its own.
 */
export function StringsTabs({ active, all, paired }: { active: "all" | "paired"; all: number; paired: number }) {
  return (
    <div className="mb-[var(--gutter)]">
      <Tabs
        as="a"
        label={t("strings.tabs")}
        active={active}
        items={[
          { key: "all", label: t("strings.tab.all", { n: formatCount(all) }), href: "/admin/strings" },
          { key: "paired", label: t("strings.tab.paired", { n: formatCount(paired) }), href: "/admin/strings/paired" },
          { key: "templates", label: t("strings.tab.templates"), href: "/admin/notifications" },
        ]}
      />
    </div>
  );
}
