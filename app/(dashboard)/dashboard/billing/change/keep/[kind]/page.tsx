import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { mayChangePlan } from "@/lib/auth/guards";
import { pendingChangeFor } from "@/lib/billing/schedule";
import { KEEP_ORDER } from "@/lib/billing/plan-caps";
import { capFor, type Metered } from "@/lib/plan/entitlements";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../../../_shell";
import { KeepChooser, type KeepOption } from "./KeepChooser";

/**
 * Board 11f — *"you choose what stays live"*.
 *
 * The plan the seller is moving to holds less than they have, so the screen
 * hands over which items survive rather than picking for them. **Nothing is
 * deleted**: a product that does not make the list goes to `draft`, which every
 * public surface already excludes, and comes back on the way up.
 *
 * ## Why it is a route and not a modal
 *
 * Choosing a hundred products out of twelve hundred is a session, not a
 * decision. It has to survive a reload, a phone call and the back button, and a
 * modal that loses a partly-made selection is worse than one that was never
 * offered.
 *
 * ## Why it needs a scheduled change first
 *
 * The choice belongs to the change — withdraw the change and the choice goes
 * with it — so there is nowhere to record one until the change exists. The rail
 * on `11f` does not offer `Choose` before then, and this refuses for the same
 * reason rather than saving into nothing and reporting success.
 */
export const metadata = { title: t("keep.title") };
export const dynamic = "force-dynamic";

const KINDS = ["products", "locations", "seats"] as const;
type Kind = (typeof KINDS)[number];

/** Which cap on the target plan bounds each kind. */
const METER: Record<Kind, Metered> = {
  products: "products",
  locations: "locations",
  seats: "seats",
};

export default async function KeepPage({ params }: { params: Promise<{ kind: string }> }) {
  const seat = await requireSellerSeat();
  if (!mayChangePlan(seat.actor)) notFound();

  const { kind } = await params;
  if (!KINDS.includes(kind as Kind)) notFound();
  const which = kind as Kind;

  const pending = await pendingChangeFor(seat.businessId);
  // No scheduled change, nothing to choose for. A 404 rather than an empty
  // screen: this URL is reachable only from a rail that hides the link.
  if (!pending) notFound();

  const [badges, toPlan] = await Promise.all([
    getNavBadges(seat.businessId),
    prisma.plan.findUniqueOrThrow({
      where: { id: pending.toPlan.id },
      select: {
        id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true, productLimit: true,
        locationLimit: true, photoLimit: true, categoryLimit: true, storageMb: true,
        teamSeats: true, rankingMultiplier: true, customDomain: true, analytics: true,
        csvImport: true, sponsoredEligible: true, sortOrder: true,
      },
    }),
  ]);

  const cap = capFor(
    { ...toPlan, monthlyPriceAed: Number(toPlan.monthlyPriceAed), rankingMultiplier: Number(toPlan.rankingMultiplier) },
    METER[which],
  );

  const options = await optionsFor(which, seat.businessId);
  const already =
    which === "products"
      ? pending.keepProductIds
      : which === "locations"
        ? pending.keepLocationIds
        : pending.keepSeatIds;

  /*
     What is ticked when nothing has been chosen yet.

     The oldest, up to the cap — the same rule `hideOverPlanCap` applies, so the
     screen opens on the answer the platform would have given and the seller
     changes it rather than starting from an empty list they have to fill.
     Seats are the exception and open with everybody ticked: the owner cannot be
     removed at all, and there is no defensible automatic answer for the rest.
  */
  const preselected =
    already ??
    (which === "seats"
      ? options.map((option) => option.id)
      : options.slice(0, cap ?? options.length).map((option) => option.id));

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/billing"
      eyebrow={t("keep.eyebrow")}
      title={t("keep.title")}
      breadcrumb={
        /*
           Back to where the choice was offered from.

           A cancellation reaches this screen too — same picker, same columns —
           but it is offered from the banner on `3m`, not from the comparison
           grid. Sending somebody back to a plan-change screen they never opened
           is the two-labels-for-one-destination defect `11h` corrected, seen
           from the other end.
        */
        <Link
          href={pending.kind === "cancellation" ? "/dashboard/billing" : "/dashboard/billing/change"}
          className="rounded-tag text-caption font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {pending.kind === "cancellation" ? t("cancel.back.billing") : t("change.title")}
        </Link>
      }
    >
      <KeepChooser
        kind={which}
        planName={toPlan.name}
        cap={cap}
        options={options}
        preselected={preselected}
        intro={introFor(which, toPlan.name, cap, pending.effectiveAt)}
        labels={{
          save: t("keep.save"),
          over: t("keep.over", { over: "{over}" }),
          counter: t("keep.counter", { chosen: "{chosen}", cap: cap === null ? "—" : formatCount(cap) }),
          saved: t("keep.saved", { count: "{count}", when: formatDate(pending.effectiveAt) }),
          /*
             Per kind, because the two locked rows are locked for different
             reasons and one sentence cannot say both. A branch row reading
             "the owner keeps their seat" is the wrong noun on the wrong screen.
          */
          lockedNote: which === "seats" ? t("keep.owner_kept") : t("keep.head_office_kept"),
          colName: t("keep.col.name"),
          colDetail: which === "seats" ? t("keep.col.role") : t("keep.col.branch"),
          colKeeps: t("keep.col.keeps"),
        }}
      />
    </SellerPage>
  );
}

function introFor(kind: Kind, planName: string, cap: number | null, effectiveAt: Date): string {
  const capLabel = cap === null ? "" : formatCount(cap);
  if (kind === "products") return t("keep.intro_products", { plan: planName, cap: capLabel });
  if (kind === "locations") return t("keep.intro_locations", { plan: planName, cap: capLabel });
  return t("keep.intro_seats", {
    plan: planName,
    cap: capLabel,
    when: formatDate(effectiveAt),
  });
}

/**
 * The rows to pick between, oldest first.
 *
 * Oldest first because that is the order the automatic answer keeps: a seller
 * who scrolls and ticks nothing ends up where `hideOverPlanCap` would have put
 * them, and the ten products at the top are the catalogue their listing was
 * built on rather than the ten they added last.
 *
 * Only what is currently live or published. A plan change must never unhide
 * something the seller hid themselves — criterion 11, and board 11f's fifth
 * correction: `Branches published · All 4` states the cap, not the state, and on
 * board 3c one of those branches is `Hidden` by the seller's own choice.
 */
async function optionsFor(kind: Kind, businessId: string): Promise<KeepOption[]> {
  if (kind === "products") {
    /*
       `KEEP_ORDER`, not a second copy of it. The preselect below slices this
       list at the cap and calls the result what happens if the seller touches
       nothing — so it has to be the order `hideOverPlanCap` will actually
       apply, down to the tiebreak. `createdAt` alone does not settle it: an
       import gives every one of its products the same timestamp.
    */
    const products = await prisma.product.findMany({
      where: { businessId, status: "live" },
      orderBy: KEEP_ORDER,
      select: { id: true, name: true, sku: true },
    });
    return products.map((product) => ({
      id: product.id,
      name: product.name,
      detail: product.sku ?? "",
      locked: false,
    }));
  }

  if (kind === "locations") {
    const locations = await prisma.location.findMany({
      where: { businessId, published: true },
      // Same tiebreak, same reason: branches added together tie on `createdAt`,
      // and a preselect that reshuffles between two loads of one screen is not
      // a default the seller can reason about.
      orderBy: [{ type: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, type: true, addressLine: true, area: { select: { name: true } } },
    });
    return locations.map((location) => ({
      id: location.id,
      name: location.area.name,
      detail: location.addressLine,
      /*
         The head office is not a branch the seller can drop.

         Every plan publishes at least one location and the head office is the
         one the listing resolves to — deselecting it would take the address off
         a live storefront, which is not what "choose what stays live" is
         offering.
      */
      locked: location.type === "head_office",
    }));
  }

  const seats = await prisma.user.findMany({
    where: { businessId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, fullName: true, email: true, roles: true },
  });
  return seats.map((person) => ({
    id: person.id,
    name: person.fullName ?? person.email ?? "",
    detail: person.roles
      .filter((role) => role.startsWith("seller_"))
      .map((role) => t(`team.role.${role}` as "team.role.seller_owner"))
      .join(", "),
    // The owner keeps their seat. `removeSeat` refuses one anyway, so a
    // deselectable owner would be a tick that reports a failure it could have
    // predicted.
    locked: person.roles.includes("seller_owner"),
  }));
}
