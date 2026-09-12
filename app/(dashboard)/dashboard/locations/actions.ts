"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { assertCanEditListing } from "@/lib/auth/guards";
import { allowance, type PlanCaps } from "@/lib/plan/entitlements";
import { t, type MessageKey } from "@/lib/i18n";
import {
  addCoverage,
  clearPin,
  deleteBranch,
  hideConsequence,
  removeCoverage,
  setBranchVisibilityMany,
  setPin,
  type CoverageError,
  type HideConsequence,
} from "@/lib/locations/service";
import type { Emirate } from "@/lib/db/generated/enums";
import { getSellerSeat } from "../_shell";

/**
 * Board 3c's writes.
 *
 * The branch's own fields still save through `saveLocation` below, unchanged —
 * that is board 2d's form in steady state and the spec puts it out of scope.
 * What is new is everything the manager screen does *around* it: the two status
 * axes, the pin, and the coverage chips.
 *
 * Nothing here queues for moderation. An address, a phone number, a pin and a
 * delivery promise are things the supplier is simply the authority on; only
 * trade name, category and licence wait for a person.
 */

const TYPES = ["head_office", "warehouse", "trade_counter", "depot", "sales_office", "workshop"] as const;

/**
 * Every refusal carries its own way out.
 *
 * `Alert` refuses a `bad` notice with no `action` or `fix` — design-system
 * §05.1, and it says so at runtime rather than in review. That is the house
 * rule about errors made structural: *"errors say what is wrong and what
 * correct looks like"*. So a failed action returns two strings, and the screen
 * has both without inventing the second one.
 */
export interface ActionError {
  ok: false;
  error: string;
  fix: string;
}

export type LocationResult = { ok: true; id: string } | ActionError;

const PLAN_SELECT = {
  id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true, productLimit: true, serviceLimit: true,
  locationLimit: true, photoLimit: true, publicPhotoLimit: true,
  categoryLimit: true, storageMb: true, teamSeats: true, rankingMultiplier: true,
  customDomain: true, analytics: true, csvImport: true, sponsoredEligible: true,
  sortOrder: true,
} as const;

export async function saveLocation(formData: FormData): Promise<LocationResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title"), fix: t("dev.no_seat_body") };
  assertCanEditListing(seat.actor);

  const id = String(formData.get("id") ?? "").trim();
  const areaId = String(formData.get("areaId") ?? "").trim();
  const type = String(formData.get("type") ?? "head_office");
  const addressLine = String(formData.get("addressLine") ?? "").trim();

  if (areaId === "") return { ok: false, error: t("locations.needs_area"), fix: t("locations.needs_area_fix") };
  if (addressLine === "") return { ok: false, error: t("locations.needs_address"), fix: t("locations.needs_address_fix") };

  // The emirate comes from the area, never from the form. Two independent
  // fields that must agree is two fields that eventually will not.
  const area = await prisma.area.findUnique({
    where: { id: areaId },
    select: { emirate: true },
  });
  if (!area) return { ok: false, error: t("locations.coverage.unknown_area"), fix: t("locations.coverage.unknown_area_fix") };

  const radius = String(formData.get("serviceRadiusKm") ?? "").trim();
  /*
     `published` is deliberately not here any more.

     It used to be a toggle in this form, which meant the same column had two
     writers and only one of them could tell the seller what hiding costs. Board
     3c Q4 wants that said at the moment of hiding — which areas the listing
     drops off — and a checkbox halfway down an address form cannot. The table's
     status control owns it now, with `hideConsequence` in front of it.
  */
  const data = {
    type: ((TYPES as readonly string[]).includes(type) ? type : "head_office") as (typeof TYPES)[number],
    emirate: area.emirate,
    areaId,
    addressLine,
    phone: String(formData.get("phone") ?? "").trim() || null,
    whatsapp: String(formData.get("whatsapp") ?? "").trim() || null,
    serviceRadiusKm: radius === "" ? null : Math.max(0, Number(radius.replace(/[^0-9]/g, "")) || 0),
  };

  if (id !== "") {
    const { count } = await prisma.location.updateMany({
      where: { id, businessId: seat.businessId },
      data,
    });
    if (count === 0) return { ok: false, error: t("locations.not_found"), fix: t("locations.not_found_fix") };
    await prisma.listingRevision.create({
      data: { businessId: seat.businessId, actorId: seat.actor.id, field: "locations" },
    });
    revalidatePath("/dashboard/locations");
    return { ok: true, id };
  }

  // A new branch is where the plan cap bites, and it says which plan lifts it.
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: seat.businessId },
    select: { plan: { select: PLAN_SELECT } },
  });
  const plan: PlanCaps | null =
    business.plan ?? (await prisma.plan.findUnique({ where: { id: "free" }, select: PLAN_SELECT }));

  if (plan) {
    const used = await prisma.location.count({ where: { businessId: seat.businessId } });
    const left = allowance(plan, "locations", used);
    if (left.atCap) {
      const better = await prisma.plan.findFirst({
        where: { monthlyPriceAed: { gt: plan.monthlyPriceAed } },
        orderBy: { monthlyPriceAed: "asc" },
        select: { name: true },
      });
      const cap = String(left.cap ?? 0);
      return {
        ok: false,
        error:
          left.cap === 1
            ? t("locations.at_cap", { plan: plan.name, cap, next: better?.name ?? "Pro" })
            : t("locations.at_cap_plural", { plan: plan.name, cap, next: better?.name ?? "Pro" }),
        fix: t("locations.at_cap_fix", { next: better?.name ?? "Pro" }),
      };
    }
  }

  /*
     A new branch starts as a draft.

     It has no pin, probably no phone number yet, and publishing it the moment
     the seller names it would put a half-filled address on their storefront
     between two keystrokes. `publishedAt` stays null, which is what makes it a
     draft rather than a hidden branch — and board 3d leaves it out of the hours
     picker until it goes live, because until then it has made no claims.
  */
  const created = await prisma.location.create({
    data: { ...data, businessId: seat.businessId, hours: {}, published: false },
    select: { id: true },
  });

  await prisma.listingRevision.create({
    data: { businessId: seat.businessId, actorId: seat.actor.id, field: "locations" },
  });
  revalidatePath("/dashboard/locations");
  revalidatePath("/dashboard/hours");
  return { ok: true, id: created.id };
}

export type DeleteResult = { ok: true } | ActionError;

export async function deleteLocation(formData: FormData): Promise<DeleteResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title"), fix: t("dev.no_seat_body") };

  const result = await deleteBranch(
    seat.actor,
    seat.businessId,
    String(formData.get("id") ?? ""),
  );
  if (!result.ok) {
    return result.error === "last_published"
      ? {
          ok: false,
          error: t("locations.delete_last_published"),
          fix: t("locations.delete_last_published_fix"),
        }
      : { ok: false, error: t("locations.not_found"), fix: t("locations.not_found_fix") };
  }

  revalidatePath("/dashboard/locations");
  revalidatePath("/dashboard/hours");
  return { ok: true };
}

/* ── Status ──────────────────────────────────────────────────────────────── */

export type ConsequenceResult = { ok: true; consequence: HideConsequence } | ActionError;

/** What hiding these would cost, asked before the seller commits to it. */
export async function previewHide(formData: FormData): Promise<ConsequenceResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title"), fix: t("dev.no_seat_body") };
  assertCanEditListing(seat.actor);

  const ids = String(formData.get("ids") ?? "").split(",").filter(Boolean);
  return { ok: true, consequence: await hideConsequence(seat.businessId, ids) };
}

export type VisibilityActionResult = { ok: true; changed: number } | ActionError;

export async function setVisibility(formData: FormData): Promise<VisibilityActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title"), fix: t("dev.no_seat_body") };

  const ids = String(formData.get("ids") ?? "").split(",").filter(Boolean);
  const result = await setBranchVisibilityMany(
    seat.actor,
    seat.businessId,
    ids,
    formData.get("published") === "on",
  );

  revalidatePath("/dashboard/locations");
  // The picker on board 3d gains and loses rows with this. A draft never
  // appears there, so publishing one for the first time is what puts it in.
  revalidatePath("/dashboard/hours");
  return result;
}

/* ── The pin ─────────────────────────────────────────────────────────────── */

export type PinActionResult = { ok: true } | ActionError;

export async function savePin(formData: FormData): Promise<PinActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title"), fix: t("dev.no_seat_body") };

  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("lat") ?? "");
  const result =
    raw === ""
      ? await clearPin(seat.actor, seat.businessId, id)
      : await setPin(seat.actor, seat.businessId, id, {
          lat: Number(raw),
          lng: Number(formData.get("lng") ?? ""),
        });

  if (!result.ok) {
    return result.error === "outside_uae"
      ? { ok: false, error: t("locations.pin_outside_uae"), fix: t("locations.pin_outside_uae_fix") }
      : { ok: false, error: t("locations.not_found"), fix: t("locations.not_found_fix") };
  }

  revalidatePath("/dashboard/locations");
  return { ok: true };
}

/* ── Coverage ────────────────────────────────────────────────────────────── */

export type CoverageActionResult = { ok: true } | ActionError;

/** Each refusal, and the sentence that gets the seller out of it. */
const COVERAGE_MESSAGE: Record<CoverageError, { error: MessageKey; fix: MessageKey }> = {
  unknown_area: { error: "locations.coverage.unknown_area", fix: "locations.coverage.unknown_area_fix" },
  already_covered: { error: "locations.coverage.already", fix: "locations.coverage.already_fix" },
  bad_lead_time: { error: "locations.coverage.bad_lead_time", fix: "locations.coverage.bad_lead_time_fix" },
  not_found: { error: "locations.not_found", fix: "locations.not_found_fix" },
};

export async function saveCoverage(formData: FormData): Promise<CoverageActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title"), fix: t("dev.no_seat_body") };

  const areaId = String(formData.get("areaId") ?? "").trim();
  const result = await addCoverage(seat.actor, seat.businessId, {
    emirate: String(formData.get("emirate") ?? "") as Emirate,
    // The empty string is "the whole emirate", which is a scope rather than a
    // missing field — the select's first option, not its placeholder.
    areaId: areaId === "" ? null : areaId,
    leadTimeHours: Number(formData.get("leadTimeHours") ?? -1),
  });

  if (!result.ok) {
    const message = COVERAGE_MESSAGE[result.error];
    return { ok: false, error: t(message.error), fix: t(message.fix) };
  }
  revalidatePath("/dashboard/locations");
  return { ok: true };
}

export async function dropCoverage(formData: FormData): Promise<CoverageActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title"), fix: t("dev.no_seat_body") };

  const result = await removeCoverage(seat.actor, seat.businessId, String(formData.get("id") ?? ""));
  if (!result.ok) return { ok: false, error: t("locations.not_found"), fix: t("locations.not_found_fix") };
  revalidatePath("/dashboard/locations");
  return { ok: true };
}
