"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signInHref } from "@/lib/auth/next-path";

/**
 * The header's "Sign in", returning to the page it was pressed on.
 *
 * Board 7a `B9`: auth is deferred, not gating, and a round trip must preserve
 * what was in progress. The composer on `/rfq/new` keeps its draft in session
 * storage, which survives the trip — but only if the trip comes back. The link
 * used to be a bare `/signin`, so signing in mid-draft landed on the buyer
 * account and the draft sat in storage on a page nobody was sent back to.
 *
 * The page is read at the moment of the click rather than rendered into the
 * `href`: the header is shared by every public page, and reading the path and
 * query while rendering would opt each of them out of static rendering for one
 * link. Without JavaScript the plain `/signin` still works.
 */
export function ReturnSignInLink({ className, children }: { className: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <Link
      href="/signin"
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        const here = `${window.location.pathname}${window.location.search}`;
        if (here === "/" || here.startsWith("/signin")) return;
        event.preventDefault();
        router.push(signInHref(here));
      }}
    >
      {children}
    </Link>
  );
}
