import type { Metadata } from "next";

/**
 * The buyer account subtree.
 *
 * This exists for one field. `/account/saved` and `/account/saved/shortlist`
 * each set `robots: { index: false, follow: false }` and `/account/enquiries`
 * did not — three sibling pages, one of them disagreeing, and nothing in
 * app/robots.ts covers `/account` either way. A page listing every enquiry a
 * buyer has ever sent is not a page to leave to a default.
 *
 * Metadata resolves per segment and a page inherits any field it does not set
 * itself, so declaring it here settles it for the subtree and for whatever
 * board 7b adds next. The pages keep their own titles.
 *
 * There is deliberately no auth check here. Next renders a layout and its page
 * concurrently, so a layout cannot stop a page's own data fetching — a guard
 * here would look like protection and provide none. Every page calls
 * `requireBuyerSeat()` itself, which is the same rule app/(admin)/layout.tsx
 * states for the console and the same reason.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AccountLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
