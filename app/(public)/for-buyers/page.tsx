import type { Metadata } from "next";
import { getBuyerFacts } from "@/lib/db/queries";
import { publishedTestimonials } from "@/lib/content/testimonials";
import { t } from "@/lib/i18n";
import { EntryForm } from "../_entry/EntryForm";
import { EntryShell } from "../_entry/EntryShell";
import { CountedFacts, Testimonials, type CountedFact } from "../_entry/Evidence";

/**
 * The buyer entry surface.
 *
 * A buyer arrives asking one question — does this directory have the supplier
 * I need — so the numbers answer that one and nothing else. How many listings,
 * how many have had a trade licence checked by us, how many trades, how many
 * emirates. No enquiry volume: that is a supplier's evidence, and putting it
 * here would be telling a buyer how busy the suppliers are, which is not a
 * reason to use anything.
 *
 * `/signin` still exists and still works. This page does not replace it; it is
 * the door with an argument on it, and the plain door stays for anybody who
 * already knows what they came for.
 */
export const metadata: Metadata = {
  title: "For buyers",
  description:
    "Find licensed UAE suppliers, send one enquiry, and compare the quotes that come back.",
  alternates: { canonical: "/for-buyers" },
};

/*
   Dynamic, and cached where it counts.

   A page-level `revalidate` would be inert here: reading `searchParams` opts
   the route out of static rendering, so there is no route cache for it to
   govern. What is cached is the *data* — `getBuyerFacts` and `publishedTestimonials`
   both hold for an hour under a tag the admin screen clears — which is the
   same arrangement, and the same reasoning, as the directory home page.
*/
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ForBuyersPage({ searchParams }: Props) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);

  const [facts, quotes] = await Promise.all([getBuyerFacts(), publishedTestimonials("buyer")]);

  // Zero is dropped rather than rendered. See lib/db/queries/entry.ts.
  const rows: CountedFact[] = [
    { value: facts.listings, label: t("entry.buyer.fact_listings") },
    { value: facts.verified, label: t("entry.buyer.fact_verified") },
    { value: facts.subcategories, label: t("entry.buyer.fact_trades") },
    { value: facts.emirates, label: t("entry.buyer.fact_emirates") },
  ].filter((row) => row.value > 0);

  return (
    <EntryShell
      title={t("entry.buyer.title")}
      lede={t("entry.buyer.lede")}
      form={
        <EntryForm
          audience="buyer"
          params={{
            ...(one("error") ? { error: one("error") } : {}),
            ...(one("retry") ? { retry: one("retry") } : {}),
            ...(one("since") ? { since: one("since") } : {}),
            ...(one("limit") ? { limit: one("limit") } : {}),
            ...(one("to") ? { to: one("to") } : {}),
          }}
        />
      }
    >
      <CountedFacts facts={rows} />
      <Testimonials quotes={quotes} />
    </EntryShell>
  );
}
