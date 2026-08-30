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
        /*
           A real GET form, because for a long time this was not one: a bare
           `SearchField` with no `name` and nothing to submit to, so pressing
           Enter in the header did nothing on every page but the home page.

           No submit button — a single text input in a form submits on Enter,
           and `type="search"` already gives a mobile keyboard its Search key,
           so a button would only take room from a 68px bar.

           Unnamed on purpose. Axe counts a form as a landmark only once it has
           an accessible name, and the home page carries its own search form;
           naming both would put two identically-named landmarks on that page.
        */
        <form action="/search" method="get" role="search" className="contents">
          <SearchField
            name="q"
            label={t("search.label")}
            clearLabel={t("search.clear")}
            placeholder={t("search.placeholder")}
          />
        </form>
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
          {/*
             Linked, at last. All four pages have been live since handoff 5 and
             the footer went on rendering them as greyed spans, so the only way
             to reach the terms of a platform taking subscriptions was to know
             the URL. Two comments elsewhere in the codebase already claimed
             "the footer links here from every page on the site"; now they are
             true.
          */}
          {[
            { key: "terms", label: t("chrome.terms"), href: "/terms" },
            { key: "privacy", label: t("chrome.privacy"), href: "/privacy" },
            {
              key: "verification",
              label: t("chrome.verification_policy"),
              href: "/verification-policy",
            },
            { key: "reviews", label: t("chrome.review_policy"), href: "/review-policy" },
          ].map((link) => (
            <a
              key={link.key}
              href={link.href}
              className="text-caption text-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </div>
  );
}
