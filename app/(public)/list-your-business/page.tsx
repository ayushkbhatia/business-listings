import type { Metadata } from "next";
import { getSupplierFacts } from "@/lib/db/queries";
import { publishedTestimonials } from "@/lib/content/testimonials";
import { t } from "@/lib/i18n";
import { EntryForm } from "../_entry/EntryForm";
import { EntryShell } from "../_entry/EntryShell";
import { CountedFacts, Testimonials, type CountedFact } from "../_entry/Evidence";

/**
 * The supplier entry surface.
 *
 * A supplier arrives asking whether anybody is actually buying, so the numbers
 * are demand: enquiries in the last thirty days and how many separate buyers
 * sent them. Not supply — telling a supplier how many other suppliers are
 * listed is an argument against joining, and dressing it up as "join 218
 * others" is the enthusiastic version §08 rules out.
 *
 * The one supply number that stays is the verified count, because it is what
 * the subscription buys: a badge nobody can award themselves. That is the
 * pitch, and it is the one thing on this page a competitor cannot copy.
 *
 * No price. `/pricing` is board 1l and is not built; when it is, it links from
 * here. A number on this page would be a price on a public surface, which is
 * the first non-negotiable and is about products rather than plans — but the
 * plans live in the `Plan` table and belong on the page that reads it, not
 * hardcoded into this one.
 */
export const metadata: Metadata = {
  title: t("entry.suppliers_meta_title"),
  description:
    "Put your UAE trade licence in front of buyers who are already sending enquiries, and answer them faster than the supplier next door.",
  alternates: { canonical: "/list-your-business" },
};

/*
   Dynamic, and cached where it counts.

   A page-level `revalidate` would be inert here: reading `searchParams` opts
   the route out of static rendering, so there is no route cache for it to
   govern. What is cached is the *data* — `getSupplierFacts` and `publishedTestimonials`
   both hold for an hour under a tag the admin screen clears — which is the
   same arrangement, and the same reasoning, as the directory home page.
*/
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ListYourBusinessPage({ searchParams }: Props) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);

  const [facts, quotes] = await Promise.all([getSupplierFacts(), publishedTestimonials("supplier")]);

  // Zero is dropped rather than rendered. On a directory this young the demand
  // numbers are the ones most likely to be zero, and a page that says "0
  // enquiries" is more honest with the row absent than present.
  const rows: CountedFact[] = [
    {
      value: facts.enquiries,
      label: t("entry.supplier.fact_enquiries", { days: facts.windowDays }),
    },
    { value: facts.buyers, label: t("entry.supplier.fact_buyers", { days: facts.windowDays }) },
    { value: facts.verified, label: t("entry.supplier.fact_verified") },
  ].filter((row) => row.value > 0);

  return (
    <EntryShell
      title={t("entry.supplier.title")}
      lede={t("entry.supplier.lede")}
      form={
        <EntryForm
          audience="supplier"
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
