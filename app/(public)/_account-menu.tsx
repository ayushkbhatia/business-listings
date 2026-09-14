import Link from "next/link";
import { ChevronDown } from "@/components/primitives/icons";
import { signOutAction } from "@/app/(auth)/actions";
import type { Viewer } from "@/lib/auth/viewer";
import { DetailsDismiss } from "./_details-dismiss";
import { t } from "@/lib/i18n";

/**
 * The header's account menu, in place of *Sign in* — board 10e Q1.
 *
 * A native disclosure, so it opens without JavaScript and has no focus trap to
 * get wrong; `DetailsDismiss` adds the outside-press and Escape closes a menu is
 * expected to have. `summary` is keyboard-operable and announced as a button with its expanded state, and the
 * menu is a list of links plus one form. Sign-out is a POST, never a link — a
 * link that ends a session is one a prefetch or a mail scanner can press.
 */
const ITEM =
  "block rounded-ctl px-3 py-2 text-body-sm text-ink hover:bg-fill focus-visible:outline-none focus-visible:shadow-focus";

export function AccountMenu({ viewer }: { viewer: Viewer }) {
  return (
    <details className="group relative">
      <summary
        className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-ctl px-2 py-1.5 text-body-sm text-ink hover:bg-fill focus-visible:outline-none focus-visible:shadow-focus sm:min-h-0 [&::-webkit-details-marker]:hidden"
      >
        {viewer.firstName ? t("chrome.account_named", { name: viewer.firstName }) : t("chrome.account")}
        <span className="text-muted transition-transform duration-120 group-open:rotate-180">
          <ChevronDown size={14} />
        </span>
      </summary>
      <div className="absolute right-0 z-30 mt-1 w-56 rounded-card border border-line bg-card p-1.5 shadow-overlay">
        <DetailsDismiss />
        <ul className="flex flex-col">
          <li>
            <Link href="/account/enquiries" className={ITEM}>
              {t("account.tab.enquiries")}
            </Link>
          </li>
          <li>
            <Link href="/account/saved" className={ITEM}>
              {t("account.tab.saved")}
            </Link>
          </li>
          <li>
            <Link href="/account/saved/shortlist" className={ITEM}>
              {t("account.tab.suppliers")}
            </Link>
          </li>
          {viewer.seller ? (
            <li>
              <Link href="/dashboard" className={ITEM}>
                {t("chrome.account_dashboard")}
              </Link>
            </li>
          ) : null}
          {viewer.staff ? (
            <li>
              <Link href="/admin" className={ITEM}>
                {t("chrome.account_console")}
              </Link>
            </li>
          ) : null}
        </ul>
        <form action={signOutAction} className="mt-1 border-t border-line pt-1">
          <button type="submit" className={`${ITEM} w-full text-left`}>
            {t("chrome.sign_out")}
          </button>
        </form>
      </div>
    </details>
  );
}

/**
 * The directory header, signed in where the visitor is — for pages that are
 * dynamic already. An async server component, so a page can drop it in where it
 * had `<DirectoryNav />` without resolving the viewer itself.
 */
export async function ViewerNav() {
  const { DirectoryNav } = await import("./_chrome");
  const { getViewer } = await import("@/lib/auth/viewer");
  return <DirectoryNav viewer={await getViewer()} />;
}
