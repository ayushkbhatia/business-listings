import { t, type MessageKey } from "@/lib/i18n";

/**
 * The five legal pages, in the order the sibling nav shows them.
 *
 * Boards 13f, 13g and 13h each draw "the other four" as a fixed list: always
 * all four, always in the same order, so a reader who learns where the cookie
 * policy sits on one page finds it in the same place on the next. That only
 * holds if there is one list — the board 10j renderer had its own, which is how
 * `/verification-policy` came to link to three siblings while the pages beside
 * it linked to four.
 *
 * The addresses are the ones already published. 13f draws them under a `/legal`
 * prefix; `/terms` and `/privacy` shipped at the root in handoff 5, the footer
 * on every page points there and `docs/routes.md` names them, so the prefix
 * would have bought a redirect table and nothing a reader can see.
 */
export interface LegalPageRef {
  slug: LegalPageSlug;
  href: string;
  /** The full name, for the sibling nav. The footer uses its own shorter set. */
  labelKey: MessageKey;
}

export type LegalPageSlug =
  | "terms"
  | "privacy"
  | "cookies"
  | "verification-policy"
  | "review-policy";

export const LEGAL_PAGES: readonly LegalPageRef[] = [
  { slug: "terms", href: "/terms", labelKey: "legal.kind.terms" },
  { slug: "privacy", href: "/privacy", labelKey: "legal.kind.privacy" },
  { slug: "cookies", href: "/cookies", labelKey: "legal.kind.cookies" },
  {
    slug: "verification-policy",
    href: "/verification-policy",
    labelKey: "legal.kind.verification_policy",
  },
  { slug: "review-policy", href: "/review-policy", labelKey: "legal.kind.review_policy" },
];

/** The other four, in order, for whichever page is asking. */
export function siblingsOf(slug: LegalPageSlug): { href: string; label: string }[] {
  return LEGAL_PAGES.filter((page) => page.slug !== slug).map((page) => ({
    href: page.href,
    label: t(page.labelKey),
  }));
}
