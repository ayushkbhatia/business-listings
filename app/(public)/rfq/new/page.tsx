import { notFound } from "next/navigation";
import { PublicShell } from "@/components/structure";
import { prisma } from "@/lib/db/client";
import { getActor } from "@/lib/auth/session";
import { t } from "@/lib/i18n";
import { DirectoryNav } from "@/app/(public)/_chrome";
import { previewRecipients } from "../actions";
import { RfqComposer } from "../RfqComposer";
import type { RfqLine } from "../rfq-state";

/**
 * Board 1h — the RFQ fan-out. One route, three arrival states.
 *
 * The category decides who could answer, so it is required; everything else the
 * form asks for is optional and says so.
 *
 * ## The three arrivals
 *
 *   **Cold** from `1a`. Nothing seeded, so the page opens at step 1: a blank
 *   line with the cursor in it, the requirement fields dimmed and disabled, and
 *   the recipient card explaining that matching needs an item first.
 *
 *   **Query-seeded** from `1c`'s zero results — `?q=`. The failed query becomes
 *   a free-text line, so the page opens at step 2 with a notice saying why.
 *
 *   **Product-seeded** from `1g` — `?products=`. Each product becomes a matched
 *   line carrying its SKU and seller, and that seller is pinned first in the
 *   recipient list and pre-ticked.
 *
 * A warm arrival never opens at step 1 with an empty table the buyer has to
 * refill — that is the composer model's rule and the reason there is no
 * separate "add items" route to send them through.
 */
export const metadata = {
  title: "Request a quote",
  /*
     A composer has nothing to index and a crawler filling it wastes budget.
     `follow`, because the links out of it are worth crawling.
  */
  robots: { index: false, follow: true },
};
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

  /*
     The seeded lines, and the shape of the arrival.

     `?products=` from board 1g — each becomes a *matched* line carrying its SKU
     and its seller, which is what makes the row read `AW-VLV-BF-100 · FROM AL
     WAHA` rather than "not matched to a listing". Capped, because a URL is not
     a basket and twenty lines is the composer's own limit.

     `?q=` from board 1c's zero results becomes a single *free-text* line. It
     matched nothing by definition — that is why the buyer is here — and the
     page says so above the table rather than pretending otherwise.
  */
  /*
     Ids or slugs, because both are things a person may reasonably put here.

     Board 1g's crossover builds the link from ids it already holds. A slug is
     what anybody writing the URL by hand — or a test — would reach for, and it
     is readable in a way a cuid is not. Matching either costs one `OR`.

     Slugs are unique per business rather than globally, so a bare slug can in
     principle match two sellers' products. That is acceptable for a seed: the
     lines are a starting point the buyer edits, and the crossover that matters
     passes ids.
  */
  const productKeys = (one("products") ?? "").split(",").map((v) => v.trim()).filter(Boolean).slice(0, 20);
  const seededProducts = productKeys.length
    ? await prisma.product.findMany({
        where: {
          OR: [{ id: { in: productKeys } }, { slug: { in: productKeys } }],
          status: { not: "draft" },
        },
        select: {
          id: true,
          name: true,
          sku: true,
          minOrderQty: true,
          business: { select: { id: true, displayName: true, primaryCategoryId: true } },
        },
        take: 20,
      })
    : [];

  const seededQuery = (one("q") ?? "").trim().slice(0, 200);

  const initialLines: RfqLine[] = [
    ...seededProducts.map((product, i) => ({
      key: `seed-${i}`,
      description: product.name,
      qty: product.minOrderQty ?? 1,
      targetUnitPriceAed: "",
      productId: product.id,
      sku: product.sku,
      /* The display name, as everywhere. A legal name here would name one
         supplier on the line and another on the storefront it links to. */
      sellerName: product.business.displayName,
    })),
    ...(seededQuery && seededProducts.length === 0
      ? [
          {
            key: "seed-q",
            description: seededQuery,
            qty: 1,
            targetUnitPriceAed: "",
            productId: null,
            sku: null,
            sellerName: null,
          },
        ]
      : []),
  ];

  /*
     A seeded product pins its own seller. The buyer came from that page, so
     unticking them should be a decision rather than a default.
  */
  const seededSellerIds = [...new Set(seededProducts.map((p) => p.business.id))];
  const pinned = [...new Set([...pinnedIds, ...seededSellerIds])].slice(0, 8);

  /*
     Eight, not five. The picker shows the top five ticked and keeps the rest
     behind "Add all" — the footer's "3 more match your spec" is a real count of
     sellers already fetched, not a promise about a query nobody ran.
  */
  const recipients = await previewRecipients({
    categoryId: category.id,
    emirate: null,
    lineCount: Math.max(1, initialLines.length),
    fanoutTo: 8,
    ...(pinned.length ? { pinnedBusinessIds: pinned } : {}),
  });

  return (
    <PublicShell nav={<DirectoryNav />}>
      {/*
         No footer. A composer is a task surface, and the site footer would
         offer twelve ways to abandon it — the spec says so in as many words.
      */}
      <RfqComposer
        emirateName={t("emirate.dubai")}
        categoryId={category.id}
        emirates={EMIRATES}
        initialLines={initialLines}
        {...(seededQuery ? { initialRequirement: seededQuery } : {})}
        initialRecipients={recipients}
        {...(pinned.length ? { pinnedBusinessIds: pinned } : {})}
        askForContact={!actor}
        seeded={Boolean(seededQuery)}
      />
    </PublicShell>
  );
}
