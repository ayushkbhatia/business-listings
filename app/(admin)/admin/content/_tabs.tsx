import { Tabs } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * Content & SEO — the five screens staff move between while working one page.
 *
 * Board 6f draws the strip and board 6h adds its last tab. Routes, not buttons:
 * each is a page somebody links a colleague to. The sidebar still lists all of
 * them; this is the row a person uses once they are already inside the section.
 */
export const CONTENT_TABS = [
  { key: "matrix", href: "/admin/content/matrix" },
  { key: "lists", href: "/admin/content/lists" },
  { key: "guides", href: "/admin/content/guides" },
  { key: "redirects", href: "/admin/content/redirects" },
  { key: "home", href: "/admin/content/home" },
] as const;

export type ContentTab = (typeof CONTENT_TABS)[number]["key"];

export function ContentTabs({ active }: { active: ContentTab }) {
  return (
    <div className="mb-[var(--gutter)]">
      <Tabs
        as="a"
        label={t("content_tabs.label")}
        active={active}
        items={CONTENT_TABS.map((tab) => ({ key: tab.key, label: t(`content_tabs.${tab.key}`), href: tab.href }))}
      />
    </div>
  );
}
