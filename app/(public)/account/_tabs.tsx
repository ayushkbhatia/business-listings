import { Tabs } from "@/components/structure";
import { t } from "@/lib/i18n";

export type AccountTab = "enquiries" | "saved" | "suppliers" | "company";

/**
 * The buyer account's tab row — boards 10e and 7b.
 *
 * Four tabs, not the five the boards draw. *Company & team* arrived with board
 * 7b and counts the requests waiting on this person's approval — the one thing
 * on that tab somebody is waiting for. *Saved requirements* opens
 * `/account/requirements`, which `routes.md` still marks *later*, and Q3 is
 * right that a tab opening nothing is a worse promise than a shorter row.
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
  counts: { enquiries: number; saved: number; suppliers: number; company: number };
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
            { key: "company", label: t("account.tab.company"), href: "/account/company", badge: counts.company },
          ]}
        />
      </div>
    </div>
  );
}
