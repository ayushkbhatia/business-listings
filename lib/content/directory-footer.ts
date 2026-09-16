import { t } from "@/lib/i18n";

export interface FooterColumn {
  key: string;
  heading: string;
  links: { key: string; label: string; href: string }[];
}

/**
 * The ink footer's link columns, from board 1a §8.
 *
 * Here rather than inside `DirectoryFooter` so board 6h's rails map can count
 * what the footer renders instead of stating a number of its own.
 *
 * Terms and privacy are two links rather than the board's single "Terms &
 * privacy". They are two pages, they have been live since handoff 5, and
 * `campaign.spec.ts` checks that the footer reaches every policy from every
 * page on the site — a combined label would reach one fewer.
 *
 * Cookies joined them with board 13h. It is not decoration: 13h §4 puts the
 * consent answer behind a footer link, the policy states that the answer can be
 * changed "from Cookie settings in the footer", and a page that promises a
 * link the footer does not carry is a page telling the reader something untrue.
 * The settings screen itself is not built — this reaches the register and the
 * §03 explanation of how to withdraw, and the label goes to "Cookie settings"
 * when the four toggles land.
 */
export function directoryFooterColumns(): FooterColumn[] {
  return [
    {
      key: "buyers",
      heading: t("home.footer_buyers"),
      links: [
        { key: "categories", label: t("home.link_browse_categories"), href: "/categories" },
        { key: "rfq", label: t("home.link_post_rfq"), href: "/rfq/new" },
        { key: "products", label: t("home.link_browse_products"), href: "/search?kind=products" },
        { key: "enquiries", label: t("home.link_my_enquiries"), href: "/account/enquiries" },
      ],
    },
    {
      key: "businesses",
      heading: t("home.footer_businesses"),
      links: [
        { key: "list", label: t("home.link_list_business"), href: "/onboarding/claim" },
        { key: "claim", label: t("home.link_claim"), href: "/onboarding/claim" },
        // Board 1l. `home.link_pricing` has been in the catalogue since handoff
        // 1 with nothing rendering it, because the page it names did not exist.
        { key: "pricing", label: t("home.link_pricing"), href: "/pricing" },
        { key: "verification", label: t("chrome.verification_policy"), href: "/verification-policy" },
        { key: "reviews", label: t("chrome.review_policy"), href: "/review-policy" },
      ],
    },
    {
      key: "company",
      heading: t("home.footer_company"),
      links: [
        { key: "guides", label: t("chrome.guides"), href: "/guides" },
        { key: "terms", label: t("chrome.terms"), href: "/terms" },
        { key: "privacy", label: t("chrome.privacy"), href: "/privacy" },
        { key: "cookies", label: t("chrome.cookies"), href: "/cookies" },
        { key: "report", label: t("home.link_report"), href: "/verification-policy" },
      ],
    },
  ];
}

/** Catalogue strings the footer's columns render: each heading and each link label. */
export function directoryFooterKeyCount(): number {
  return directoryFooterColumns().reduce((total, column) => total + 1 + column.links.length, 0);
}
