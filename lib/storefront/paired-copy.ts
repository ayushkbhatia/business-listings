import { t } from "@/lib/i18n";
import type { ListingKind } from "./library";

/**
 * Shared sections are shared in layout, not in copy — board `5c-s` B5.
 *
 * *What buyers said* heads a stockist's reviews and *What clients said* an audit
 * practice's; *Enquire about your situation* heads a composer that asks about a
 * job rather than a quantity. The pair lives here, as data, so no component
 * branches on a trade — the owner's standing rule for the service track.
 *
 * A key with no services half speaks the same words for both, which is most of
 * them. `12g-s`'s paired-strings table is the eventual home of this; until it
 * exists, this is the one list and it is short on purpose.
 */
const PAIRED = {
  "section.enquiry.title": "storefront_services.composer.title",
  "section.enquiry.default_intro": "section.enquiry.default_intro_services",
  "section.hero.enquire": "storefront.request_quote",
  "section.reviews.title": "section.reviews.title_services",
} as const;

export type PairedKey = keyof typeof PAIRED;

/** The words for this kind of listing. */
export function paired(key: PairedKey, kind: ListingKind): string {
  return t((kind === "services" ? PAIRED[key] : key) as never);
}

/** The key itself, for a caller that needs to fall back through `line()`. */
export function pairedKey(key: PairedKey, kind: ListingKind): string {
  return kind === "services" ? PAIRED[key] : key;
}
