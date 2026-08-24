import { Button, SearchField } from "@/components/primitives";
import { PublicNav } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * The nav and footer every public page shares.
 *
 * Deliberately per-page rather than in the layout: PublicShell owns the
 * breadcrumb and results-toolbar slots as well, and a Next layout cannot hand
 * those down to the page below it. One line at the top of each page is a
 * smaller cost than splitting the shell in half.
 */
export function DirectoryNav() {
  return (
    <PublicNav
      label={t("nav.label.public")}
      brand="Business Listings"
      search={
        <SearchField
          label={t("search.label")}
          clearLabel={t("search.clear")}
          placeholder={t("search.placeholder")}
        />
      }
      links={[
        { key: "categories", label: t("chrome.categories"), href: "/categories" },
        { key: "guides", label: t("chrome.guides"), href: "/guides" },
        { key: "pricing", label: t("chrome.pricing"), href: "/pricing" },
      ]}
      actions={
        <Button size="sm" disabled title={t("enquiry.disabled")}>
          {t("gallery.list_your_business")}
        </Button>
      }
    />
  );
}

export function DirectoryFooter({ listingCount }: { listingCount?: number }) {
  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="font-serif text-h2 text-ink">Business Listings</p>
          {listingCount !== undefined && (
            <p className="mt-1 text-caption text-muted">
              {t("chrome.footer_count", { count: formatCount(listingCount) })}
            </p>
          )}
        </div>
        <nav aria-label={t("chrome.footer_nav")} className="flex flex-wrap gap-x-8 gap-y-2">
          {[
            { key: "terms", label: t("chrome.terms"), href: "/terms" },
            { key: "privacy", label: t("chrome.privacy"), href: "/privacy" },
            { key: "verification", label: t("chrome.verification_policy"), href: "/verification-policy" },
            { key: "reviews", label: t("chrome.review_policy"), href: "/review-policy" },
          ].map((link) => (
            <a
              key={link.key}
              href={link.href}
              className="rounded-tag text-caption text-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
