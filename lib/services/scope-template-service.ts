import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCanEditProduct } from "@/lib/auth/guards";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { allowance, type PlanCaps } from "@/lib/plan/entitlements";
import { PLAN_SELECT } from "./plan-select";
import { completeness, uniqueServiceSlug } from "./scope-sheet";
import { NAME_MAX, patchServiceField } from "./service";
import {
  TRAVELLING_FIELDS,
  cloneValues,
  isTravellingField,
  offersFor,
  templateFilled,
  travellingOnly,
  type Offer,
  type ServiceValues,
  type TemplateValues,
  type TravellingField,
} from "./scope-template";
import type { Actor } from "@/lib/auth/roles";

/**
 * Scope templates against a database — board `3h-s`.
 *
 * The capability is `product.edit`, the same one `3f-s`, `3g-s` and `8c-s` use:
 * board 7d granted "Edit products & specs" to the owner and the manager, and a
 * template is a thing that makes services. A new capability would be one the
 * permissions board never granted.
 *
 * ## A template edit never writes through — B4, AC3
 *
 * There is no code path in this module that changes a `Service` when a template
 * is saved. `saveTemplateValues` writes one row. What a seller sees afterwards
 * is `offersFor`, computed on read, and `acceptOffer` is the only thing that
 * touches a service — one field, one service, on a press.
 *
 * That is the board's rule and its reason: three services quoting different
 * clients cannot silently change shape because somebody tidied a template.
 */

export interface TemplateCard {
  id: string;
  name: string;
  slug: string;
  familyId: string;
  familyName: string;
  values: TemplateValues;
  filled: number;
  /** Live, from `Service.scopeTemplateId` — B6, AC6. */
  usedBy: number;
  /** The services themselves, named. The card lists them rather than a count alone. */
  services: { id: string; name: string; live: boolean }[];
  /** How many changes are waiting across those services. */
  openOffers: number;
}

export async function scopeTemplatesFor(businessId: string): Promise<TemplateCard[]> {
  const [templates, services, declines] = await Promise.all([
    prisma.scopeTemplate.findMany({
      where: { businessId },
      orderBy: [{ createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        familyId: true,
        values: true,
        family: { select: { name: true } },
      },
    }),
    prisma.service.findMany({
      where: { businessId, scopeTemplateId: { not: null } },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        status: true,
        scopeTemplateId: true,
        engagementType: true,
        feeBasis: true,
        deliveredWhere: true,
        deliverable: true,
        values: { select: { fieldKey: true, value: true } },
      },
    }),
    prisma.scopeTemplateDecline.findMany({
      where: { template: { businessId } },
      select: { serviceId: true, fieldKey: true, value: true },
    }),
  ]);

  const declinedBy = declineMap(declines);

  return templates.map((template) => {
    const values = travellingOnly(template.values as Record<string, unknown>);
    const mine = services.filter((service) => service.scopeTemplateId === template.id);

    return {
      id: template.id,
      name: template.name,
      slug: template.slug,
      familyId: template.familyId,
      familyName: template.family.name,
      values,
      filled: templateFilled(values),
      usedBy: mine.length,
      services: mine.map((service) => ({
        id: service.id,
        name: service.name,
        live: service.status === "live",
      })),
      openOffers: mine.reduce(
        (sum, service) =>
          sum + offersFor(values, flatten(service), declinedBy.get(service.id) ?? {}).length,
        0,
      ),
    };
  });
}

export interface TemplateOffers {
  serviceId: string;
  serviceName: string;
  live: boolean;
  offers: Offer[];
}

export interface TemplateDetail extends TemplateCard {
  /** One entry per service using the template, whether or not it has offers. */
  perService: TemplateOffers[];
  /** Every family, for the `New from a family` control and for provenance. */
  families: { id: string; name: string }[];
}

export async function templateDetailFor(
  businessId: string,
  slug: string,
): Promise<TemplateDetail | null> {
  const template = await prisma.scopeTemplate.findFirst({
    where: { businessId, slug },
    select: { id: true },
  });
  if (!template) return null;

  const [cards, services, declines, families] = await Promise.all([
    scopeTemplatesFor(businessId),
    prisma.service.findMany({
      where: { businessId, scopeTemplateId: template.id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        status: true,
        engagementType: true,
        feeBasis: true,
        deliveredWhere: true,
        deliverable: true,
        values: { select: { fieldKey: true, value: true } },
      },
    }),
    prisma.scopeTemplateDecline.findMany({
      where: { templateId: template.id },
      select: { serviceId: true, fieldKey: true, value: true },
    }),
  prisma.scopeSheetFamily.findMany({
      orderBy: [{ isDefault: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  const card = cards.find((row) => row.id === template.id);
  if (!card) return null;
  const declinedBy = declineMap(declines);

  return {
    ...card,
    families,
    perService: services.map((service) => ({
      serviceId: service.id,
      serviceName: service.name,
      live: service.status === "live",
      offers: offersFor(card.values, flatten(service), declinedBy.get(service.id) ?? {}),
    })),
  };
}

/* ── Writing ─────────────────────────────────────────────────────────────── */

export type TemplateResult =
  | { ok: true; id: string; slug: string }
  | { ok: false; reason: "not_found" | "unknown_family" | "name_required" };

/**
 * New from a family — B2, B9.
 *
 * The family decides which rows exist; the template pre-fills nothing until the
 * seller types it. Per business, never shared: `ScopeSheetFamily` is the
 * platform-level artefact and this is one firm's answer to four of its rows.
 */
export async function createTemplate(
  actor: Actor,
  businessId: string,
  familyId: string,
  name: string,
): Promise<TemplateResult> {
  assertCanEditProduct(actor);

  const trimmed = name.trim().slice(0, NAME_MAX);
  if (trimmed === "") return { ok: false, reason: "name_required" };

  const [family, existing] = await Promise.all([
    prisma.scopeSheetFamily.findUnique({ where: { id: familyId }, select: { id: true } }),
    prisma.scopeTemplate.findMany({ where: { businessId }, select: { slug: true } }),
  ]);
  if (!family) return { ok: false, reason: "unknown_family" };

  const created = await prisma.scopeTemplate.create({
    data: {
      businessId,
      familyId: family.id,
      name: trimmed,
      slug: uniqueServiceSlug(trimmed, existing.map((row) => row.slug)),
    },
    select: { id: true, slug: true },
  });
  return { ok: true, id: created.id, slug: created.slug };
}

export type SaveResult = { ok: true; slug: string } | { ok: false; reason: "not_found" | "name_required" };

/**
 * Rename and re-fill, in one write.
 *
 * `travellingOnly` is applied before the write and the CHECK stands behind it,
 * so there are two independent reasons a `scope` key cannot land in here — B3
 * asks for the model boundary and this is the layer above it, not instead of it.
 *
 * **The slug does not move on a rename.** It is a live URL for the seller's own
 * bookmarks and the offers they are part-way through reviewing; renaming a
 * template is a label change, and breaking the address for it would be the
 * `Service.slug` mistake one model over.
 */
export async function saveTemplate(
  actor: Actor,
  businessId: string,
  templateId: string,
  input: { name: string; values: Record<string, unknown> },
): Promise<SaveResult> {
  assertCanEditProduct(actor);

  const trimmed = input.name.trim().slice(0, NAME_MAX);
  if (trimmed === "") return { ok: false, reason: "name_required" };

  const template = await prisma.scopeTemplate.findFirst({
    where: { id: templateId, businessId },
    select: { id: true, slug: true },
  });
  if (!template) return { ok: false, reason: "not_found" };

  await prisma.scopeTemplate.update({
    where: { id: template.id },
    data: { name: trimmed, values: travellingOnly(input.values) },
  });

  /*
     And nothing else. No service is touched here, by design — what the seller
     sees next is `offersFor`, one row per change, accepted or declined per
     service. See the module docblock.
  */
  return { ok: true, slug: template.slug };
}

/**
 * Delete — B7, AC7.
 *
 * The services keep every value they hold and lose only the provenance link,
 * which the `SET NULL` foreign key does. Their declines go with the template,
 * which is right: a decline is a fact about an offer, and there is no longer
 * anything to offer.
 */
export async function deleteTemplate(
  actor: Actor,
  businessId: string,
  templateId: string,
): Promise<{ ok: boolean }> {
  assertCanEditProduct(actor);
  const { count } = await prisma.scopeTemplate.deleteMany({
    where: { id: templateId, businessId },
  });
  return { ok: count > 0 };
}

/* ── Cloning a service ───────────────────────────────────────────────────── */

export type CloneResult =
  | { ok: true; id: string; filled: number }
  | { ok: false; reason: "not_found" | "at_cap"; cap?: number; planName?: string };

/**
 * What a clone actually arrives at, which is not `CLONE_FILLS`.
 *
 * The board's arithmetic reads it as two steps — *template fills four, seller
 * names it, five* — and this screen collapses them: the name is typed in the
 * same press, because an unnamed service is the one thing `Service.name` exists
 * to prevent. So a clone lands at five and turnaround is the only field left,
 * and the copy says five rather than restating the board's intermediate figure.
 *
 * Computed rather than added to, so it stays true if a travelling field is ever
 * added or removed.
 */
function cloneLandsAt(values: TemplateValues, named: boolean): number {
  return (
    completeness({
      name: named ? "named" : null,
      engagementType: asEngagement(values.engagementType),
      feeBasis: values.feeBasis ?? null,
      turnaround: null,
      deliveredWhere: asDelivered(values.deliveredWhere),
      deliverable: values.deliverable ?? null,
    }).filled
  );
}

/**
 * A service from a template — B8, AC5.
 *
 * **A draft at `CLONE_FILLS` of six**, with scope and exclusions empty and the
 * name and turnaround left for the seller. Not published: the board is explicit,
 * and a screen that published on a press would put an unnamed service on the
 * directory.
 *
 * The name is the seller's from the start. A clone called "Copy of our marine
 * inspections" is a row nobody can pick out of a list of six, which is the same
 * reason `Service.name` is the one required field with no empty state.
 */
export async function cloneFromTemplate(
  actor: Actor,
  businessId: string,
  templateId: string,
  name: string,
): Promise<CloneResult> {
  assertCanEditProduct(actor);

  const [template, business, existing, caps] = await Promise.all([
    prisma.scopeTemplate.findFirst({
      where: { id: templateId, businessId },
      select: { id: true, values: true },
    }),
    prisma.business.findUnique({ where: { id: businessId }, select: { primaryCategoryId: true } }),
    prisma.service.findMany({ where: { businessId }, select: { slug: true, position: true } }),
    effectiveFor(businessId),
  ]);
  if (!template || !business) return { ok: false, reason: "not_found" };

  const plan =
    caps ??
    ((await prisma.plan.findUnique({ where: { id: "free" }, select: PLAN_SELECT })) as
      | PlanCaps
      | null);
  if (plan) {
    const room = allowance(plan, "services", existing.length);
    if (room.atCap) {
      return { ok: false, reason: "at_cap", cap: room.cap ?? 0, planName: plan.name };
    }
  }

  const values = cloneValues(travellingOnly(template.values as Record<string, unknown>));
  const trimmed = name.trim().slice(0, NAME_MAX);
  const label = trimmed === "" ? "Untitled service" : trimmed;

  const service = await prisma.service.create({
    data: {
      businessId,
      categoryId: business.primaryCategoryId,
      scopeTemplateId: template.id,
      name: label,
      slug: uniqueServiceSlug(label, existing.map((row) => row.slug)),
      position: existing.reduce((max, row) => Math.max(max, row.position), -1) + 1,
      engagementType: asEngagement(values.engagementType),
      feeBasis: values.feeBasis ?? null,
      deliveredWhere: asDelivered(values.deliveredWhere),
      deliverable: values.deliverable ?? null,
      // Draft. B8, and the board says so twice.
      ...(values.regulator
        ? { values: { create: { fieldKey: "regulator", value: values.regulator } } }
        : {}),
    },
    select: { id: true },
  });

  await prisma.serviceRevision.create({
    data: {
      serviceId: service.id,
      actorId: actor.id,
      field: "created",
      before: null,
      after: label,
    },
  });

  return { ok: true, id: service.id, filled: cloneLandsAt(values, trimmed !== "") };
}

/* ── Offers ──────────────────────────────────────────────────────────────── */

export type OfferResult = { ok: true } | { ok: false; reason: "not_found" | "unknown_field" };

/**
 * Take one change into one service — B4, AC3.
 *
 * Through `patchServiceField`, not a direct write: that is where `3g-s`'s
 * rules live — a fee basis is validated against the service's own family, and
 * every change writes a `ServiceRevision` so the seller's change log says a
 * person accepted this rather than the row mutating on its own.
 */
export async function acceptOffer(
  actor: Actor,
  businessId: string,
  serviceId: string,
  field: string,
): Promise<OfferResult> {
  assertCanEditProduct(actor);
  if (!isTravellingField(field)) return { ok: false, reason: "unknown_field" };

  const service = await prisma.service.findFirst({
    where: { id: serviceId, businessId, scopeTemplateId: { not: null } },
    select: { id: true, scopeTemplate: { select: { values: true } } },
  });
  if (!service?.scopeTemplate) return { ok: false, reason: "not_found" };

  const values = travellingOnly(service.scopeTemplate.values as Record<string, unknown>);
  const wanted = values[field];
  if (wanted === undefined) return { ok: false, reason: "not_found" };

  const saved = await patchServiceField(actor, businessId, serviceId, field, wanted);
  if (!saved.ok) return { ok: false, reason: "not_found" };

  // Accepting clears any earlier refusal of this field: the seller has changed
  // their mind, and a stale decline would suppress the next genuine offer.
  await prisma.scopeTemplateDecline.deleteMany({ where: { serviceId, fieldKey: field } });
  return { ok: true };
}

/**
 * Refuse one change, durably — AC4.
 *
 * The service keeps its values and **keeps its provenance**: the board's own
 * §States says declining retains the link, because the seller still wants to
 * know where the service came from and still wants the next offer.
 */
export async function declineOffer(
  actor: Actor,
  businessId: string,
  serviceId: string,
  field: string,
): Promise<OfferResult> {
  assertCanEditProduct(actor);
  if (!isTravellingField(field)) return { ok: false, reason: "unknown_field" };

  const service = await prisma.service.findFirst({
    where: { id: serviceId, businessId, scopeTemplateId: { not: null } },
    select: { id: true, scopeTemplateId: true, scopeTemplate: { select: { values: true } } },
  });
  if (!service?.scopeTemplateId || !service.scopeTemplate) {
    return { ok: false, reason: "not_found" };
  }

  const values = travellingOnly(service.scopeTemplate.values as Record<string, unknown>);
  const refused = values[field];
  if (refused === undefined) return { ok: false, reason: "not_found" };

  await prisma.scopeTemplateDecline.upsert({
    where: { serviceId_fieldKey: { serviceId, fieldKey: field } },
    create: { serviceId, templateId: service.scopeTemplateId, fieldKey: field, value: refused },
    update: { templateId: service.scopeTemplateId, value: refused },
  });
  return { ok: true };
}

/* ── Shapes ──────────────────────────────────────────────────────────────── */

interface ServiceRow {
  engagementType: string | null;
  feeBasis: string | null;
  deliveredWhere: string | null;
  deliverable: string | null;
  values: { fieldKey: string; value: string }[];
}

/**
 * One service's travelling five, flattened.
 *
 * `regulator` lives in `ScopeFieldValue` and the other four are columns, and
 * the rule in `scope-template.ts` is pure — so the difference between a column
 * and a row is resolved here, once, rather than inside the comparison.
 */
function flatten(service: ServiceRow): ServiceValues {
  return {
    engagementType: service.engagementType,
    feeBasis: service.feeBasis,
    deliveredWhere: service.deliveredWhere,
    deliverable: service.deliverable,
    regulator: service.values.find((row) => row.fieldKey === "regulator")?.value ?? null,
  };
}

function declineMap(
  rows: readonly { serviceId: string; fieldKey: string; value: string }[],
): Map<string, Partial<Record<TravellingField, string>>> {
  const map = new Map<string, Partial<Record<TravellingField, string>>>();
  for (const row of rows) {
    if (!isTravellingField(row.fieldKey)) continue;
    const entry = map.get(row.serviceId) ?? {};
    entry[row.fieldKey] = row.value;
    map.set(row.serviceId, entry);
  }
  return map;
}

/** The two enum columns. An unknown value is absent rather than a bad write. */
function asEngagement(value: string | undefined) {
  return value === "ongoing_contract" || value === "one_off_job" || value === "call_off"
    ? value
    : null;
}

function asDelivered(value: string | undefined) {
  return value === "remote" || value === "at_our_office" || value === "on_site" ? value : null;
}

export { TRAVELLING_FIELDS };
