import { notFound } from "next/navigation";
import { Card, PublicShell } from "@/components/structure";
import { prisma } from "@/lib/db/client";
import { getActor } from "@/lib/auth/session";
import { DEFAULT_FANOUT } from "@/lib/enquiry/fanout";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { previewRecipients } from "../actions";
import { RfqForm } from "../RfqForm";

/**
 * Board 1h — the RFQ fan-out, in three steps.
 *
 * A buyer can reach this from a category, a search or the home page. The
 * category decides who could answer, so it is required; everything else the
 * form asks for is optional and says so.
 */
export const metadata = { title: "Send an enquiry" };
export const dynamic = "force-dynamic";

const EMIRATES = [
  { value: "dubai", label: "Dubai" },
  { value: "abu_dhabi", label: "Abu Dhabi" },
  { value: "sharjah", label: "Sharjah" },
  { value: "ajman", label: "Ajman" },
  { value: "ras_al_khaimah", label: "Ras Al Khaimah" },
  { value: "fujairah", label: "Fujairah" },
  { value: "umm_al_quwain", label: "Umm Al Quwain" },
] as const;

export default async function RfqNewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);

  const actor = await getActor();

  /*
     `?to=slug` from a storefront, `?to=a,b,c` from the comparison tray.

     Resolved before the category, because it decides what the category is when
     the link does not say. `claimStatus` is matched to `findFanoutCandidates`
     deliberately: filtering only on published-and-not-suspended used to admit
     an unclaimed listing, which then inflated the fan-out count and was absent
     from the result — a slot spent on nobody.
  */
  const pinnedSlugs = (one("to") ?? "").split(",").map((v) => v.trim()).filter(Boolean).slice(0, 8);
  const pinnedBusinesses = pinnedSlugs.length
    ? await prisma.business.findMany({
        where: {
          slug: { in: pinnedSlugs },
          suspendedAt: null,
          publishedAt: { not: null },
          claimStatus: "claimed",
        },
        select: { id: true, primaryCategoryId: true },
      })
    : [];
  const pinnedIds = pinnedBusinesses.map((b) => b.id);

  /*
     The category, in order of how much it is actually known:

       1. `?category=` — the buyer came from a category or search page.
       2. The first pinned supplier's own primary category. Every `?to=` link
          in the app omits `?category=`, so without this the page fell through
          to (3) and labelled a valve enquiry "HVAC and ventilation" — and,
          before `findFanoutCandidates` learned about pinned suppliers, sent it
          to five HVAC firms and not to the supplier the buyer clicked.
       3. The first category on the home page. Only right for a bare
          `/rfq/new`, where nothing has been said at all.

     A tray holding four suppliers from four trades still names one of them
     here. That is a labelling choice, not a routing one — every pinned
     supplier is a recipient regardless of which category this resolves to.
  */
  const categorySlug = one("category");
  const category = categorySlug
    ? await prisma.category.findFirst({ where: { slug: categorySlug }, select: { id: true, name: true } })
    : ((pinnedBusinesses[0]?.primaryCategoryId
        ? await prisma.category.findUnique({
            where: { id: pinnedBusinesses[0].primaryCategoryId },
            select: { id: true, name: true },
          })
        : null) ??
      (await prisma.category.findFirst({
        where: { showOnHome: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true },
      })));
  if (!category) notFound();

  const recipients = await previewRecipients({
    categoryId: category.id,
    emirate: null,
    lineCount: 1,
    fanoutTo: Math.max(DEFAULT_FANOUT, pinnedIds.length),
    ...(pinnedIds.length ? { pinnedBusinessIds: pinnedIds } : {}),
  });

  return (
    <PublicShell nav={<DirectoryNav />} footer={<DirectoryFooter />}>
      <div className="mx-auto w-full max-w-[46rem] px-[var(--section-pad)] py-8">
      <p className="font-mono text-eyebrow uppercase text-faint">{category.name}</p>
      <h1 className="mt-2 font-serif text-h1-serif text-ink">{t("rfq.title")}</h1>
      <p className="mt-2 max-w-[var(--measure-prose)] text-prose text-prose">{t("rfq.lede")}</p>

      <div className="mt-6">
        <Card padded>
          <RfqForm
            shape="wizard"
            categoryId={category.id}
            emirates={EMIRATES}
            initialRecipients={recipients}
            askForContact={!actor}
            defaultFanout={Math.max(DEFAULT_FANOUT, pinnedIds.length)}
            {...(pinnedIds.length ? { pinnedBusinessIds: pinnedIds } : {})}
          />
        </Card>
      </div>
      </div>
    </PublicShell>
  );
}
