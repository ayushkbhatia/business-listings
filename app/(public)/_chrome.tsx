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
      laterLabel={t("chrome.later")}
      links={[
        // Named so the nav is the right shape now, not linked until the
        // handoff that builds them. docs/routes.md marks these later; a dead
        // link is worse than an honest greyed one.
        { key: "categories", label: t("chrome.categories"), href: "/categories" },
        { key: "guides", label: t("chrome.guides"), href: "/guides" },
        { key: "pricing", label: t("chrome.pricing"), href: "/pricing", later: true },
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
            { key: "terms", label: t("chrome.terms") },
            { key: "privacy", label: t("chrome.privacy") },
            { key: "verification", label: t("chrome.verification_policy") },
            { key: "reviews", label: t("chrome.review_policy") },
          ].map((link) => (
            // Policy pages are board 10j and belong to a later handoff. Named
            // here so the footer is the right shape, not linked into a 404.
            <span
              key={link.key}
              aria-disabled="true"
              title={t("chrome.later")}
              className="cursor-not-allowed text-caption text-faint"
            >
              {link.label}
            </span>
          ))}
        </nav>
      </div>
    </div>
  );
}
