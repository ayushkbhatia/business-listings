import { Tabs } from "@/components/structure";
import { can } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { t } from "@/lib/i18n";

/**
 * Billing operations, as the board's header row.
 *
 * *"Plans & entitlements, Failed payments, Invoices & credits."* Board 12e flag
 * 8 records that the third had nothing behind it when the board was drawn; it
 * has since — `/admin/invoices` is where a subscription credit is issued — so
 * the strip carries three real routes and no dead tab.
 *
 * Real links, not buttons. A tab that is a route and behaves like a button
 * cannot be opened in a new tab and does not appear in history, which on a
 * console where staff keep two of these open at once is the difference between
 * a nav and a toy.
 *
 * Gated per item rather than per strip: `/admin/invoices` is `subscription.credit`
 * — finance's alone — and an ops lead who can edit every number on the plan
 * table cannot issue a credit. A tab that 404s is worse than no tab.
 */
export function CommerceTabs({ actor, active }: { actor: Actor; active: string }) {
  const items = [
    { key: "/admin/plans", href: "/admin/plans", label: t("admin.commerce.tab.plans"), show: can(actor, "plan.entitlements.write") || can(actor, "revenue.read") },
    { key: "/admin/dunning", href: "/admin/dunning", label: t("admin.commerce.tab.dunning"), show: can(actor, "revenue.read") },
    { key: "/admin/invoices", href: "/admin/invoices", label: t("admin.commerce.tab.invoices"), show: can(actor, "subscription.credit") },
  ].filter((item) => item.show);

  if (items.length < 2) return null;

  return (
    <div className="mb-[var(--gutter)]">
      <Tabs
        as="a"
        label={t("admin.commerce.tabs_label")}
        active={active}
        items={items.map(({ key, href, label }) => ({ key, href, label }))}
      />
    </div>
  );
}
