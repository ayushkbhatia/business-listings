"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { assertCanEditListing } from "@/lib/auth/guards";
import { allowance, type PlanCaps } from "@/lib/plan/entitlements";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

/**
 * Locations — instant, every field.
 *
 * Nothing here queues. An address, a phone number and a delivery radius are
 * things the supplier is simply the authority on, and criterion 8 says so:
 * only trade name, category and licence wait for a person.
 */

const TYPES = ["head_office", "warehouse", "trade_counter", "depot", "sales_office", "workshop"] as const;

export type LocationResult = { ok: true; id: string } | { ok: false; error: string };

const PLAN_SELECT = {
  id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true, productLimit: true,
  locationLimit: true, photoLimit: true,
  categoryLimit: true, storageMb: true, teamSeats: true, rankingMultiplier: true,
  customDomain: true, sortOrder: true,
} as const;

export async function saveLocation(formData: FormData): Promise<LocationResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditListing(seat.actor);

  const id = String(formData.get("id") ?? "").trim();
  const areaId = String(formData.get("areaId") ?? "").trim();
  const type = String(formData.get("type") ?? "head_office");
  const addressLine = String(formData.get("addressLine") ?? "").trim();

  if (areaId === "") return { ok: false, error: t("locations.area_placeholder") };
  if (addressLine === "") return { ok: false, error: t("locations.address_hint") };

  // The emirate comes from the area, never from the form. Two independent
  // fields that must agree is two fields that eventually will not.
  const area = await prisma.area.findUnique({
    where: { id: areaId },
    select: { emirate: true },
  });
  if (!area) return { ok: false, error: t("locations.no_areas") };

  const radius = String(formData.get("serviceRadiusKm") ?? "").trim();
  const data = {
    type: ((TYPES as readonly string[]).includes(type) ? type : "head_office") as (typeof TYPES)[number],
    emirate: area.emirate,
    areaId,
    addressLine,
    phone: String(formData.get("phone") ?? "").trim() || null,
    whatsapp: String(formData.get("whatsapp") ?? "").trim() || null,
    serviceRadiusKm: radius === "" ? null : Math.max(0, Number(radius.replace(/[^0-9]/g, "")) || 0),
    published: formData.get("published") === "on",
  };

  if (id !== "") {
    const { count } = await prisma.location.updateMany({
      where: { id, businessId: seat.businessId },
      data,
    });
    if (count === 0) return { ok: false, error: t("locations.no_areas") };
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
      };
    }
  }

  const created = await prisma.location.create({
    data: { ...data, businessId: seat.businessId, hours: {} },
    select: { id: true },
  });

  revalidatePath("/dashboard/locations");
  revalidatePath("/dashboard/hours");
  return { ok: true, id: created.id };
}

export type DeleteResult = { ok: true } | { ok: false; error: string };

export async function deleteLocation(formData: FormData): Promise<DeleteResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCanEditListing(seat.actor);

  const { count } = await prisma.location.deleteMany({
    where: { id: String(formData.get("id") ?? ""), businessId: seat.businessId },
  });
  if (count === 0) return { ok: false, error: t("locations.no_areas") };

  revalidatePath("/dashboard/locations");
  revalidatePath("/dashboard/hours");
  return { ok: true };
}
