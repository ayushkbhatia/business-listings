import Link from "next/link";
import { Button, SearchField } from "@/components/primitives";
import { Eyebrow } from "@/components/display";
import { PublicNav } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * The nav and footer every public page shares.
 *
 * Deliberately per-page rather than in the layout: PublicShell owns the
 * breadcrumb and results-toolbar slots as well, and a Next layout cannot hand
 * those down to the page below it. One line at the top of each page is a
 * smaller cost than splitting the shell in half.
 */
export interface DirectoryNavScope {
  /** Where the header search submits. A category page searches within itself. */
  action: string;
  /** The pill: "IN · DUBAI". Already built by the caller. */
  label: string;
  /** "Search in HVAC & ventilation". */
  placeholder: string;
  /**
   * Facets carried into the search, as hidden fields.
   *
   * A GET form serialises its own fields and **discards the query string on its
   * `action`** — so `action: "/search?area=al-quoz"` submits to `/search?q=…`
   * with the area silently dropped. Board 6a §1 promises the opposite: *"A
   * search from here starts pre-filtered to this scope and lands on `1c`."*
   *
   * A category page has no need of this because its scope is in the path it
   * submits to. A landing page's scope is not, so it travels as fields.
   */
  hidden?: Record<string, string>;
}

export function DirectoryNav({
  active,
  scope,
}: { active?: string; scope?: DirectoryNavScope } = {}) {
  return (
    <PublicNav
      label={t("nav.label.public")}
      brand={
        // Instrument Serif, with the second word in its italic — the wordmark
        // as board 1a draws it. The italic is the only place the serif's
        // second face is used, which is what keeps it a mark rather than a
        // style anything else can reach for.
        <>
          Business <span className="italic">Listings</span>
        </>
      }
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
        /*
           On a category page this submits back to that category rather than to
           /search, which is what the scope pill is promising — board 1b: "typing
           here searches within the category, not site-wide". Everywhere else it
           is the site search it has always been.
        */
        <form action={scope?.action ?? "/search"} method="get" role="search" className="contents">
          <SearchField
            name="q"
            label={scope ? scope.placeholder : t("search.label")}
            clearLabel={t("search.clear")}
            placeholder={scope?.placeholder ?? t("search.placeholder")}
            scope={scope?.label}
          />
          {/* See `DirectoryNavScope.hidden`: a GET form drops its action's query. */}
          {Object.entries(scope?.hidden ?? {}).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
        </form>
      }
      laterLabel={t("chrome.later")}
      active={active}
      links={[
        // Board 1a's four. Products and Suppliers are the two tabs of the same
        // results page rather than two routes — /search is one surface with a
        // tab, and inventing /products for the nav's sake would be a second
        // canonical URL for a page that already has one.
        { key: "categories", label: t("chrome.categories"), href: "/categories" },
        { key: "products", label: t("chrome.products"), href: "/search?tab=products" },
        { key: "suppliers", label: t("chrome.suppliers"), href: "/search" },
        { key: "pricing", label: t("chrome.pricing"), href: "/pricing" },
      ]}
      actions={
        <>
          <Link
            href="/signin"
            className="hidden rounded-ctl px-2 py-1.5 text-body-sm text-body hover:text-ink focus-visible:outline-none focus-visible:shadow-focus sm:inline-flex"
          >
            {t("chrome.sign_in")}
          </Link>
          {/*
             A box, not `display: contents`.

             The button carries `tabIndex={-1}` so the anchor is the one
             focusable thing here — and an anchor with `display: contents`
             generates no box, which in Blink means it cannot be focused at
             all. `.focus()` on it was a no-op and Tab skipped straight past:
             the site's primary seller call to action was unreachable by
             keyboard on every public page.

             With a box it also gets the ring, and `min-h-11` gives it the
             44px mobile target §09's floor asks for — the green button itself
             is 32px, which is the desktop floor and no more.
          */}
          <Link
            href="/onboarding/claim"
            className="inline-flex min-h-11 items-center rounded-ctl focus-visible:outline-none focus-visible:shadow-focus sm:min-h-0"
          >
            <Button size="sm" tabIndex={-1}>
              {t("gallery.list_your_business")}
            </Button>
          </Link>
        </>
      }
    />
  );
}

interface FooterColumn {
  key: string;
  heading: string;
  links: { key: string; label: string; href: string }[];
}

/**
 * The ink footer, four columns, from board 1a §8.
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
export function DirectoryFooter() {
  const columns: FooterColumn[] = [
    {
      key: "buyers",
      heading: t("home.footer_buyers"),
      links: [
        { key: "categories", label: t("home.link_browse_categories"), href: "/categories" },
        { key: "rfq", label: t("home.link_post_rfq"), href: "/rfq/new" },
        { key: "products", label: t("home.link_browse_products"), href: "/search?tab=products" },
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

  return (
    <div className="bg-ink-surface">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-11 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:gap-10">
        <div>
          <p className="font-serif text-h1-serif text-on-ink">
            Business <span className="italic">Listings</span>
          </p>
          <p className="mt-2.5 max-w-[260px] text-caption leading-relaxed text-on-ink-muted">
            {t("home.footer_blurb")}
          </p>
        </div>

        {columns.map((column) => (
          /*
             `aria-labelledby` rather than a heading.

             These three words label a navigation landmark; they are not
             sections of the document. Marking them up as `h2` put three extra
             headings into the outline of every public page — which is not just
             untidy: `storefront.spec.ts` counts `h2`s to know how many branches
             a page lists, and the footer silently added three to that number.

             Pointing the landmark at its own visible label keeps the accessible
             name identical to the text on screen, which `aria-label` would not
             guarantee.
          */
          <nav key={column.key} aria-labelledby={`footer-${column.key}`}>
            <Eyebrow as="p" onInk id={`footer-${column.key}`} className="mb-3.5">
              {column.heading}
            </Eyebrow>
            <ul className="flex flex-col gap-2.5">
              {column.links.map((link) => (
                <li key={link.key}>
                  <a
                    href={link.href}
                    className="rounded-tag text-body-sm text-on-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus-on-ink"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-ink-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-5 py-4">
          {/*
            The year is the deploy's, not a constant. A footer reading 2026 in
            2027 is the smallest possible signal that nobody is home.
          */}
          <span className="font-mono text-eyebrow uppercase tabular-nums text-on-ink-muted">
            {t("home.footer_legal", { year: new Date().getFullYear() })}
          </span>
          <span className="font-mono text-eyebrow uppercase text-on-ink-muted">
            {t("home.footer_locale")}
          </span>
        </div>
      </div>
    </div>
  );
}
