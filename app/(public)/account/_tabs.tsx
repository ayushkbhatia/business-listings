import { Tabs } from "@/components/structure";
import { t } from "@/lib/i18n";

export type AccountTab = "enquiries" | "saved" | "suppliers";

/**
 * The buyer account's tab row — board 10e.
 *
 * Three tabs, not the four the board draws. *Company & team* is board 7b, which
 * is not built, and Q3 is right that half a tab row is a worse promise than a
 * shorter one: a tab that opens nothing tells a buyer the product is unfinished
 * in the one place they came to get work done. It is added with 7b.
 *
 * *Saved suppliers* is here because it exists — `/account/saved/shortlist`,
 * built with board 8's shortlist, is the page `routes.md` calls
 * `/account/suppliers` and marks *later*.
 */
export function AccountTabs({
  active,
  counts,
}: {
  active: AccountTab;
  counts: { enquiries: number; saved: number; suppliers: number };
}) {
  return (
    <div className="border-b border-line bg-card">
      <div className="mx-auto w-full max-w-7xl px-5">
        <Tabs
          as="a"
          label={t("account.tabs_label")}
          active={active}
          items={[
            { key: "enquiries", label: t("account.tab.enquiries"), href: "/account/enquiries", badge: counts.enquiries },
            { key: "saved", label: t("account.tab.saved"), href: "/account/saved", badge: counts.saved },
            { key: "suppliers", label: t("account.tab.suppliers"), href: "/account/saved/shortlist", badge: counts.suppliers },
          ]}
        />
      </div>
    </div>
  );
}
