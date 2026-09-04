import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Breadcrumb, Card, PublicShell } from "@/components/structure";
import { Eyebrow } from "@/components/display";
import { VerificationBadge, tierSpec } from "@/components/domain";
import { getActor } from "@/lib/auth/session";
import { formatCount, formatDate, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import { shortlistFor } from "@/lib/shortlist/service";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { removeFromShortlist } from "@/app/(public)/_shortlist";

/**
 * The suppliers a buyer kept.
 *
 * The other half of the save control. A button that writes a row nobody can
 * find again is a button that pretends to work, and this is the page that stops
 * it pretending — the same reason `/account/saved` exists beside "save this
 * search", and the same shape, deliberately.
 *
 * Signed in only, because a shortlist is. There is no anonymous list and no
 * cookie behind one: a list that lives in a browser is lost on the next device.
 *
 * Removing here tells the supplier nothing. `shortlistCount` is a number on
 * their dashboard and it simply goes down; there is no notification and no
 * record of who left.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("shortlist.title"),
  robots: { index: false, follow: false },
};

export default async function SavedSuppliersPage() {
  const actor = await getActor();
  if (!actor) redirect("/signin?next=%2Faccount%2Fsaved%2Fshortlist");

  const suppliers = await shortlistFor(actor.id);
  const now = new Date();

  const crumbs = [
    { label: t("chrome.directory"), href: "/" },
    { label: t("saved.title"), href: "/account/saved" },
    { label: t("shortlist.title") },
  ];

  return (
    <PublicShell
      nav={<DirectoryNav />}
      breadcrumb={<Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />}
      footer={<DirectoryFooter />}
    >
      <header className="border-b border-line pb-4">
        <h1 className="font-serif text-h1-serif text-ink">{t("shortlist.title")}</h1>
        <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-muted">
          {t("shortlist.intro")}
        </p>
      </header>

      {suppliers.length === 0 ? (
        /*
           The cold-start state, and a designed one. Nothing is padded to fill
           the page and nothing is suggested that would not be true — the second
           line says where the control is, which is the only thing a buyer with
           an empty list needs to know.
        */
        <div className="mt-5">
          <Card padded>
            <h2 className="text-h3 text-ink">{t("shortlist.empty")}</h2>
            <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-muted">
              {t("shortlist.empty_body")}
            </p>
          </Card>
        </div>
      ) : (
        <>
          {/* The number, counted off the rows below rather than stored. */}
          <Eyebrow as="p" className="mt-5">
            {t("shortlist.count", {
              count: suppliers.length,
              formatted: formatCount(suppliers.length),
            })}
          </Eyebrow>

          <ul className="mt-2 flex flex-col gap-2">
            {suppliers.map((supplier) => {
              const spec = tierSpec(supplier.verificationTier);
              const verifiedOn =
                spec.dateField === "verifiedAt" ? supplier.verifiedAt : null;

              const nameId = `shortlist-name-${supplier.businessId}`;
              const removeId = `shortlist-remove-${supplier.businessId}`;

              return (
                <Card as="li" key={supplier.businessId}>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      {/*
                         `displayName`, here as everywhere. This row links to
                         the supplier's storefront, so a trade name would mean
                         the buyer reads one name and lands on another.

                         Unlinked where the listing is no longer served: a link
                         to a page that 404s is worse than no link, and the row
                         stays either way — dropping it would shrink a list the
                         buyer built without saying why.
                      */}
                      {supplier.reachable ? (
                        <Link
                          id={nameId}
                          href={`/b/${supplier.slug}`}
                          className="rounded-tag text-body font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                        >
                          {supplier.displayName}
                        </Link>
                      ) : (
                        <>
                          <span id={nameId} className="text-body font-medium text-ink">
                            {supplier.displayName}
                          </span>
                          <p className="mt-0.5 text-caption text-muted">
                            {t("shortlist.error.not_found")}
                          </p>
                        </>
                      )}
                      <p className="mt-0.5 font-mono text-eyebrow text-muted">
                        {t("shortlist.saved_on", {
                          when: formatRelative(supplier.savedAt, { now }),
                        })}
                      </p>
                    </div>

                    {/*
                       Compact, but it still states what was checked and when —
                       criterion 8 has no exceptions. The badge takes no seller
                       colour on any surface, this one included.
                    */}
                    <VerificationBadge
                      tier={supplier.verificationTier}
                      label={t(spec.labelKey as never)}
                      checked={t(spec.checkedKey as never)}
                      date={verifiedOn ? formatDate(verifiedOn) : undefined}
                      tierLabel={t("verify.tier", { tier: supplier.verificationTier })}
                      size="sm"
                      compact
                    />

                    {/* A real form, so removing one works without JavaScript. */}
                    <form action={removeFromShortlist}>
                      <input type="hidden" name="businessId" value={supplier.businessId} />
                      <button
                        id={removeId}
                        type="submit"
                        /*
                           Every row's button says the same four words, so on
                           their own they are twelve identical controls to
                           anyone listening. Pairing each with its supplier's
                           name reads as "Remove from shortlist, Al Quoz
                           Hydraulics" without inventing a second string that
                           the visible label would then have to match.
                        */
                        aria-labelledby={`${removeId} ${nameId}`}
                        className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                      >
                        {t("shortlist.remove")}
                      </button>
                    </form>
                  </div>
                </Card>
              );
            })}
          </ul>
        </>
      )}
    </PublicShell>
  );
}
