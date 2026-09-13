import "server-only";
import { prisma } from "@/lib/db/client";
import { mayEditListing } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import type { DeliveredWhere, DeliveryMode, Emirate, SellsKind } from "@/lib/db/generated/enums";
import { EMIRATES } from "@/lib/uae";
import { chipKey, coverageStateFor, type CoverageState } from "@/lib/onboarding/coverage";
import type { CoverageScope } from "@/lib/locations/coverage";
import {
  DELIVERY_MODES,
  businessCoverage,
  coverageMarker,
  coverageTally,
  effectiveCoverage,
  isDeliveryMode,
  type CoverageMarker,
  type CoverageTally,
} from "@/lib/locations/service-coverage";
import {
  EMIRATE_ORDER,
  coversEveryEmirate,
  rowQualifiers,
  type PlaceView,
} from "@/lib/storefront/coverage-page";

/**
 * Board `3c-s` — the coverage manager, `/dashboard/coverage`.
 *
 * The seller-side half of everything `1f-s` publishes. `2d-s` collects a
 * business default once during onboarding; this is where that default is
 * maintained afterwards **and** where each service's own rows are seen side by
 * side for the first time. Until now a service could narrow itself only from
 * its own editor, one at a time, and nothing anywhere showed the set.
 *
 * ## Nothing here is stored that could be derived
 *
 * The markers (`inherited`, `same`, `narrowed`, `wider`), the header chip, the
 * public union and the blast radius of a default edit are all computed from the
 * rows on every read. That is B3 and B4, and the reason is concrete: the board
 * this screen was drawn from shipped a header reading `4 EMIRATES DEFAULT`
 * above a three-emirate default line. Two values that must agree, stored
 * separately, eventually do not.
 *
 * ## Every public string comes from the functions the public pages use
 *
 * `rowQualifiers` and `coversEveryEmirate` are `1f-s`'s own rules, imported
 * rather than restated, and the union is `businessCoverage` over live services
 * exactly as `publicCoverageFor` computes it for `1d-s`. The screen tells a
 * seller what buyers see; if it computed that separately it would be telling
 * them what a copy of the rule says.
 *
 * One consequence is worth naming. The board draws `DMCC, JAFZA` on the audit
 * row only. `1f-s` prints a free zone beside **every** row that reaches its
 * emirate, because a registration is a fact about the firm, not about one
 * service. This screen follows `1f-s`, since that is the page buyers read.
 */

/* ── What the screen reads ───────────────────────────────────────────────── */

export interface ManagerRow {
  serviceId: string;
  name: string;
  slug: string;
  status: "live" | "draft";
  marker: CoverageMarker;
  /** Effective coverage, worded, in federal order with areas after their emirate. */
  places: string[];
  /** `All 7 emirates` rather than seven names — `1f-s`'s own test. */
  everyEmirate: boolean;
  /** Free zones printed beside the row, by `1f-s`'s rule. */
  qualifiers: string[];
  /** The service's own rows that are one of the chips, for the editor. */
  ownKeys: string[];
  /** Its own rows narrower than the chips — listed, never silently dropped. */
  ownOther: string[];
  /** `3g-s` writes it; null is a real state and the screen names its cost (B7). */
  deliveredWhere: DeliveredWhere | null;
}

export interface CoverageManagerState {
  businessId: string;
  displayName: string;
  sellsKind: SellsKind;
  published: boolean;
  /** The 2d-s field set, read through the same function the onboarding step uses. */
  defaults: CoverageState;
  /** The default, worded. */
  defaultPlaces: string[];
  rows: ManagerRow[];
  tally: CoverageTally;
  /** B11 — how many services an edit to the default moves. */
  inheriting: { total: number; live: number };
  /** What the listing headline reads — the union over live services only (B5). */
  publicPlaces: string[];
  /**
   * Live services that resolve to no coverage at all. Only possible when the
   * default is empty and they inherit it; the screen says so rather than
   * rendering an empty cell as if it were an answer.
   */
  uncovered: number;
}

const EMIRATE_LABEL: Record<string, string> = Object.fromEntries(
  EMIRATES.map((row) => [row.value, row.label]),
);

export async function coverageManagerFor(businessId: string): Promise<CoverageManagerState | null> {
  const [defaults, business, services, rows] = await Promise.all([
    coverageStateFor(businessId),
    prisma.business.findUnique({
      where: { id: businessId },
      select: { publishedAt: true },
    }),
    /*
       Every service, drafts included — the board's *draft service* state lists
       them, marked, so a seller can see the coverage a draft will have before
       it goes live. They are kept out of the union and the tally's public
       meaning below, not out of the table.
    */
    prisma.service.findMany({
      where: { businessId },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true, slug: true, status: true, deliveredWhere: true },
    }),
    prisma.serviceCoverage.findMany({
      where: { businessId },
      select: {
        id: true,
        emirate: true,
        areaId: true,
        serviceId: true,
        area: { select: { name: true } },
      },
    }),
  ]);
  if (!defaults || !business) return null;

  const names = new Map(
    rows.flatMap((row) => (row.areaId && row.area ? [[row.areaId, row.area.name] as const] : [])),
  );
  for (const chip of defaults.chips) {
    if (chip.scope.areaId) names.set(chip.scope.areaId, chip.label);
  }

  const toScope = (row: { emirate: Emirate; areaId: string | null }): CoverageScope => ({
    emirate: row.emirate,
    areaId: row.areaId,
  });
  const defaultScopes = rows.filter((row) => row.serviceId === null).map(toScope);
  const ownBy = new Map<string, CoverageScope[]>();
  for (const row of rows) {
    if (row.serviceId === null) continue;
    const list = ownBy.get(row.serviceId) ?? [];
    list.push(toScope(row));
    ownBy.set(row.serviceId, list);
  }

  const chipKeys = new Set(defaults.chips.map((chip) => chip.key));
  const place = (scope: CoverageScope): PlaceView => ({
    emirate: scope.emirate,
    areaId: scope.areaId,
    label: scope.areaId ? (names.get(scope.areaId) ?? emirateLabel(scope.emirate)) : emirateLabel(scope.emirate),
  });

  const managerRows: ManagerRow[] = services.map((service) => {
    const own = ownBy.get(service.id) ?? [];
    const effective = ordered(effectiveCoverage(defaultScopes, own)).map(place);
    return {
      serviceId: service.id,
      name: service.name,
      slug: service.slug,
      status: service.status,
      marker: coverageMarker(defaultScopes, own),
      places: effective.map((row) => row.label),
      everyEmirate: coversEveryEmirate(effective),
      qualifiers: rowQualifiers(effective, defaults.registrations),
      ownKeys: own.filter((scope) => chipKeys.has(chipKey(scope))).map(chipKey),
      ownOther: own.filter((scope) => !chipKeys.has(chipKey(scope))).map((scope) => place(scope).label),
      deliveredWhere: service.deliveredWhere,
    };
  });

  const live = services.filter((service) => service.status === "live");
  const publicScopes = ordered(
    businessCoverage(
      defaultScopes,
      live.map((service) => ownBy.get(service.id) ?? []),
    ),
  ).map(place);

  return {
    businessId,
    displayName: defaults.displayName,
    sellsKind: defaults.sellsKind,
    published: business.publishedAt !== null,
    defaults,
    defaultPlaces: ordered(defaultScopes).map((scope) => place(scope).label),
    rows: managerRows,
    tally: coverageTally(
      defaultScopes,
      services.map((service) => ownBy.get(service.id) ?? []),
    ),
    inheriting: {
      total: services.filter((service) => !ownBy.has(service.id)).length,
      live: live.filter((service) => !ownBy.has(service.id)).length,
    },
    publicPlaces: publicScopes.map((row) => row.label),
    uncovered: live.filter(
      (service) => effectiveCoverage(defaultScopes, ownBy.get(service.id) ?? []).length === 0,
    ).length,
  };
}

function emirateLabel(emirate: string): string {
  return EMIRATE_LABEL[emirate] ?? emirate;
}

/** Federal order, whole emirate before its areas — the order `1f-s` prints. */
function ordered(scopes: readonly CoverageScope[]): CoverageScope[] {
  const rank = (emirate: string) => {
    const index = (EMIRATE_ORDER as readonly string[]).indexOf(emirate);
    return index === -1 ? EMIRATE_ORDER.length : index;
  };
  return [...scopes].sort(
    (a, b) =>
      rank(a.emirate) - rank(b.emirate) ||
      (a.areaId === null ? -1 : 0) - (b.areaId === null ? -1 : 0),
  );
}

/* ── The writes ──────────────────────────────────────────────────────────── */

export type ManagerRefusal =
  | "forbidden"
  | "not_found"
  | "unknown_area"
  | "unknown_mode"
  | "not_a_free_zone"
  /** A published listing cannot be left with no mode or no area — 2d-s B2, after publish. */
  | "live_needs_mode"
  | "live_needs_area";

export type ManagerWrite =
  | { ok: true; savedAt: Date; moved: number }
  | { ok: false; reason: ManagerRefusal };

/**
 * The business default, replaced from a staged edit — B11.
 *
 * Staged, and deliberately unlike the onboarding step, which saves each chip as
 * it is clicked. There a seller is filling in an empty listing; here every chip
 * changes the coverage of every inheriting service at once, and **the count of
 * those services is the blast radius** the screen names before this is called.
 * An autosaving chip would make the confirmation meaningless.
 *
 * ## Only the chips are replaced
 *
 * The screen offers eight places. A default row narrower than those — an area
 * a seller once set some other way — is not a chip, so a replace built from the
 * chips must not delete it: that would remove a claim the seller was never
 * shown. The same rule `setCoverageArea` follows one row at a time.
 *
 * ## The publish gate still holds after publish
 *
 * `2d-s` B2 refuses to publish a services listing with no delivery mode or no
 * area. A published listing emptying either here would reach the same state the
 * gate exists to prevent, through the back door — so it is refused with the
 * same reasons.
 */
export async function saveDefaultCoverage(
  actor: Actor,
  businessId: string,
  input: { areaKeys: readonly string[]; modes: readonly string[]; freeZoneIds: readonly string[] },
): Promise<ManagerWrite> {
  if (actor.businessId !== businessId || !mayEditListing(actor)) {
    return { ok: false, reason: "forbidden" };
  }

  const state = await coverageStateFor(businessId);
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { publishedAt: true },
  });
  if (!state || !business) return { ok: false, reason: "not_found" };

  if (!input.modes.every(isDeliveryMode)) return { ok: false, reason: "unknown_mode" };
  const modes = DELIVERY_MODES.filter((mode) => input.modes.includes(mode)) as DeliveryMode[];

  const chips = new Map(state.chips.map((chip) => [chip.key, chip.scope]));
  const wanted = [...new Set(input.areaKeys)];
  if (!wanted.every((key) => chips.has(key))) return { ok: false, reason: "unknown_area" };

  const zoneIds = [...new Set(input.freeZoneIds)];
  if (zoneIds.length > 0) {
    const zones = await prisma.area.findMany({
      where: { id: { in: zoneIds } },
      select: { id: true, isFreeZone: true },
    });
    if (zones.length !== zoneIds.length) return { ok: false, reason: "unknown_area" };
    if (zones.some((zone) => !zone.isFreeZone)) return { ok: false, reason: "not_a_free_zone" };
  }

  if (business.publishedAt) {
    if (modes.length === 0) return { ok: false, reason: "live_needs_mode" };
    // The finer rows that are not chips survive the replace, so they count.
    if (wanted.length === 0 && state.otherScopes.length === 0) {
      return { ok: false, reason: "live_needs_area" };
    }
  }

  const dropping = state.chips.filter((chip) => chip.on && !wanted.includes(chip.key));
  const adding = wanted.filter((key) => !state.chips.find((chip) => chip.key === key)?.on);

  await prisma.$transaction(async (tx) => {
    await tx.business.update({ where: { id: businessId }, data: { deliveryModes: modes } });

    for (const chip of dropping) {
      await tx.serviceCoverage.deleteMany({
        where: {
          businessId,
          serviceId: null,
          emirate: chip.scope.emirate,
          areaId: chip.scope.areaId,
        },
      });
    }
    if (adding.length > 0) {
      await tx.serviceCoverage.createMany({
        data: adding.map((key) => {
          const scope = chips.get(key)!;
          return { businessId, serviceId: null, emirate: scope.emirate, areaId: scope.areaId };
        }),
        skipDuplicates: true,
      });
    }

    await tx.freeZoneRegistration.deleteMany({
      where: { businessId, areaId: { notIn: zoneIds } },
    });
    if (zoneIds.length > 0) {
      await tx.freeZoneRegistration.createMany({
        data: zoneIds.map((areaId) => ({ businessId, areaId })),
        skipDuplicates: true,
      });
    }
  });

  const moved = await prisma.service.count({
    where: { businessId, coverage: { none: {} } },
  });
  return { ok: true, savedAt: new Date(), moved };
}

/**
 * One service's own coverage, replaced from a staged edit.
 *
 * An empty selection is the way back to inheriting — B2, and the board's *a row
 * is emptied* state — and nothing here ever copies the default into the rows.
 * As with the default, only rows that are chips are replaced; a finer own row
 * the editor does not offer is kept, and the screen lists it.
 */
export async function saveServiceCoverageSet(
  actor: Actor,
  businessId: string,
  serviceId: string,
  areaKeys: readonly string[],
): Promise<ManagerWrite> {
  if (actor.businessId !== businessId || !mayEditListing(actor)) {
    return { ok: false, reason: "forbidden" };
  }

  const [service, state] = await Promise.all([
    prisma.service.findFirst({ where: { id: serviceId, businessId }, select: { id: true } }),
    coverageStateFor(businessId),
  ]);
  if (!service || !state) return { ok: false, reason: "not_found" };

  const chips = new Map(state.chips.map((chip) => [chip.key, chip.scope]));
  const wanted = [...new Set(areaKeys)];
  if (!wanted.every((key) => chips.has(key))) return { ok: false, reason: "unknown_area" };

  const own = await prisma.serviceCoverage.findMany({
    where: { businessId, serviceId },
    select: { id: true, emirate: true, areaId: true },
  });
  const held = new Set(own.map((row) => chipKey(row)));
  const dropping = own.filter((row) => chips.has(chipKey(row)) && !wanted.includes(chipKey(row)));
  const adding = wanted.filter((key) => !held.has(key));

  await prisma.$transaction(async (tx) => {
    if (dropping.length > 0) {
      await tx.serviceCoverage.deleteMany({ where: { id: { in: dropping.map((row) => row.id) } } });
    }
    if (adding.length > 0) {
      await tx.serviceCoverage.createMany({
        data: adding.map((key) => {
          const scope = chips.get(key)!;
          return { businessId, serviceId, emirate: scope.emirate, areaId: scope.areaId };
        }),
        skipDuplicates: true,
      });
    }
  });

  return { ok: true, savedAt: new Date(), moved: 1 };
}
