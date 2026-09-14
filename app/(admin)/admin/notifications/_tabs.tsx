import { Tabs } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * Board 12g's four tabs. Routes, not buttons: each is a page somebody links a
 * colleague to — "the delivery log for that seller" — and a tab that is a route
 * and behaves like a button breaks the link and the back button both.
 *
 * Templates is the board. The other three answer the states its spec sends
 * elsewhere: a channel outage is *"Delivery log tab, not this one"*, and `Q4`
 * asks whether the log is this screen or its own — its own, because a per-send
 * log is a paged query over every delivery and the list is a content table.
 */
export const NOTIFICATION_TABS = [
  { key: "templates", href: "/admin/notifications" },
  { key: "channels", href: "/admin/notifications/channels" },
  { key: "deliveries", href: "/admin/notifications/deliveries" },
  { key: "quiet", href: "/admin/notifications/quiet-hours" },
] as const;

export type NotificationTab = (typeof NOTIFICATION_TABS)[number]["key"];

export function NotificationTabs({ active }: { active: NotificationTab }) {
  return (
    <div className="mb-[var(--gutter)]">
      <Tabs
        as="a"
        label={t("notifications.tabs")}
        active={active}
        items={NOTIFICATION_TABS.map((tab) => ({
          key: tab.key,
          label: t(`notifications.tab.${tab.key}`),
          href: tab.href,
        }))}
      />
    </div>
  );
}
