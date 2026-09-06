import { t } from "@/lib/i18n";
import { signInHref } from "@/lib/auth/next-path";
import type { ShortlistLabels } from "./ShortlistButton";

/**
 * The save control, as one import for the surfaces that mount it.
 *
 * The storefront, its product pages and a search result row all carry the same
 * button, and a shared component renders identically on every screen that
 * carries it. Building the label set in three places is how the copy on one of
 * them quietly drifts, so it is built here, once.
 */

export { ShortlistButton, type ShortlistButtonProps, type ShortlistLabels } from "./ShortlistButton";
export {
  toggleShortlistAction,
  removeFromShortlist,
  type ShortlistActionResult,
} from "./actions";

/**
 * Every string the button needs, translated, plus the sign-in link.
 *
 * `next` is the path the buyer is on — the caller knows it and a server
 * component cannot ask for it. The URL is built by `signInHref`, which is the
 * one construction of it in the project: encoding here rather than in each
 * caller is what stops a slug with a query string on it truncating the return
 * path at the first ampersand.
 */
export function shortlistLabels(next: string): ShortlistLabels {
  return {
    save: t("shortlist.save"),
    saved: t("shortlist.saved"),
    remove: t("shortlist.remove"),
    signIn: t("shortlist.sign_in"),
    signInHref: signInHref(next),
  };
}
