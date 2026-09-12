import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  chooseScopeSheet,
  seedFromCommonServices,
  setupServicesStateFor,
} from "@/lib/services/setup";
import { COUNTING_BAR } from "@/lib/services/setup-sheet";
import { familyFor, publicServiceFor } from "@/lib/services/service";
import { setupHubState } from "@/lib/setup/service";
import { readEnquiryLift } from "@/lib/metrics/enquiry-lift";
import { SERVICES_TARGET } from "@/lib/metrics/profile-strength";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Board `8c-s` — the scope sheet and the first services, against a database.
 *
 * What a unit test cannot reach: that the sheet a seller picks beats the
 * category walk, that step 2 refuses on the server and not only in the markup,
 * that the seeded rows arrive as drafts with nothing but a name, that
 * `used by N firms` counts sellers of work rather than the whole directory, and
 * that the hub's task 2 now measures the counting rule rather than live rows.
 */

const PREFIX = "svc-8cs-";

let categoryId: string;
const made: string[] = [];

let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

/**
 * A real seat, because `ServiceRevision.actorId` is a `uuid` with a foreign key
 * to `user` — the change log records decisions and a decision has an author.
 */
let ownerId: string;
const owner = () => actor(ownerId, "seller_owner");
const hubFor = (businessId: string) => setupHubState(businessId, readEnquiryLift);

async function makeSeller(fields?: {
  sellsKind?: "goods" | "services" | "both";
  published?: boolean;
  offers?: string[];
  sheet?: string | null;
}): Promise<string> {
  const mark = stamp();
  const business = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-S${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      sellsKind: fields?.sellsKind ?? "services",
      publishedAt: fields?.published === false ? null : new Date(),
      servicesOffered: fields?.offers ?? [],
      scopeSheetFamilyId: fields?.sheet ?? null,
    },
    select: { id: true },
  });
  made.push(business.id);
  return business.id;
}

/** A service at exactly `filled` of the six required fields. */
async function addService(
  businessId: string,
  filled: number,
  over?: { live?: boolean; name?: string },
): Promise<string> {
  const mark = stamp();
  const name = over?.name ?? `${PREFIX}${mark}`;
  const service = await prisma.service.create({
    data: {
      businessId,
      categoryId,
      name,
      slug: `${PREFIX}${mark}`,
      status: over?.live === false ? "draft" : "live",
      ...(filled >= 2 ? { engagementType: "one_off_job" as const } : {}),
      ...(filled >= 3 ? { feeBasis: "fixed_fee" } : {}),
      ...(filled >= 4 ? { turnaround: "2 weeks" } : {}),
      ...(filled >= 5 ? { deliveredWhere: "remote" as const } : {}),
      ...(filled >= 6 ? { deliverable: "A report" } : {}),
    },
    select: { id: true },
  });
  return service.id;
}

beforeAll(async () => {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } });
  categoryId = category.id;

  const seat = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "seller_owner" } },
    select: { id: true },
  });
  ownerId = seat.id;
});

afterAll(async () => {
  await prisma.service.deleteMany({ where: { businessId: { in: made } } });
  await prisma.business.deleteMany({ where: { id: { in: made } } });
});

describe("step 1 gates step 2 — B1, AC1", () => {
  it("starts with no sheet, and the seed list refuses until one is picked", async () => {
    const id = await makeSeller();
    const before = await setupServicesStateFor(id);
    expect(before!.chosenFamilyId).toBeNull();

    const refused = await seedFromCommonServices(owner(), id);
    expect(refused).toEqual({ ok: false, reason: "no_sheet" });
    expect(await prisma.service.count({ where: { businessId: id } })).toBe(0);
  });

  it("refuses a sheet that is not a sheet", async () => {
    const id = await makeSeller();
    expect(await chooseScopeSheet(owner(), id, "not-a-family")).toEqual({
      ok: false,
      reason: "unknown_sheet",
    });
  });
});

describe("the chosen sheet beats the category walk", () => {
  it("hands the seller their own sheet's fee bases, not the trade's", async () => {
    const id = await makeSeller();

    /*
       Every one of the 440 category rows is null today, so without the business
       column this resolves to the seeded default for everybody — which is the
       whole reason `Business.scopeSheetFamilyId` had to exist for step 1 to
       mean anything at all.
    */
    const inherited = await familyFor(categoryId, null);

    const chosen = await chooseScopeSheet(owner(), id, "facilities-management");
    expect(chosen.ok).toBe(true);

    const mine = await familyFor(categoryId, "facilities-management");
    expect(mine.id).toBe("facilities-management");
    expect(mine.id).not.toBe(inherited.id);
    // And the fee bases travel with it — `3g-s` B2, never a global list.
    expect(mine.feeBases.map((row) => row.key)).not.toEqual(
      inherited.feeBases.map((row) => row.key),
    );
  });

  it("falls back to the walk when the chosen family has gone", async () => {
    // Reachable only mid-delete, because the foreign key is SET NULL. A
    // fee-basis control with no options is worse than the trade's own sheet.
    const family = await familyFor(categoryId, "deleted-family-id");
    expect(family.id).toBeTruthy();
    expect(family.feeBases.length).toBeGreaterThan(0);
  });
});

describe("the seed list — B8, AC8", () => {
  it("arrives as drafts carrying a name and nothing else", async () => {
    const id = await makeSeller({ sheet: "audit-and-assurance" });
    const seeded = await seedFromCommonServices(owner(), id);
    expect(seeded.ok).toBe(true);
    expect(seeded.ok && seeded.created).toBeGreaterThan(0);

    const rows = await prisma.service.findMany({
      where: { businessId: id },
      select: {
        name: true,
        status: true,
        scope: true,
        excluded: true,
        engagementType: true,
        turnaround: true,
        feeBasis: true,
      },
    });

    for (const row of rows) {
      expect(row.status).toBe("draft");
      expect(row.name.length).toBeGreaterThan(0);
      /*
         `3g-s` B6 and `3h-s` both refuse to template scope and exclusions,
         because a pre-filled exclusions line is the one that ends up in a
         dispute. An engagement type or a turnaround would be the same mistake
         one field over — both are claims about how *this* firm works.
      */
      expect(row.scope).toBeNull();
      expect(row.excluded).toBeNull();
      expect(row.engagementType).toBeNull();
      expect(row.turnaround).toBeNull();
      expect(row.feeBasis).toBeNull();
    }
  });

  it("is a no-op the second time rather than six more rows", async () => {
    const id = await makeSeller({ sheet: "audit-and-assurance" });
    const first = await seedFromCommonServices(owner(), id);
    expect(first.ok).toBe(true);
    const count = await prisma.service.count({ where: { businessId: id } });

    const again = await seedFromCommonServices(owner(), id);
    expect(again.ok).toBe(true);
    expect(again.ok && again.created).toBe(0);
    expect(await prisma.service.count({ where: { businessId: id } })).toBe(count);
  });

  it("stops at the plan cap rather than refusing the lot", async () => {
    /*
       A seller with no subscription falls back to Free, which `3g-s` set at
       three services — and three is exactly this task's bar, which is `8c-s`
       Q3's answer landing: the list fills the plan to its limit and the task
       closes there rather than leaving a seller one short of a hub that will
       not shut. The audit family offers six, so the cap is what stops it.
    */
    const id = await makeSeller({ sheet: "audit-and-assurance" });
    const seeded = await seedFromCommonServices(owner(), id);

    const free = await prisma.plan.findUniqueOrThrow({
      where: { id: "free" },
      select: { serviceLimit: true },
    });
    expect(seeded.ok && seeded.created).toBe(free.serviceLimit);
    expect(seeded.ok && seeded.skipped).toBeGreaterThan(0);
  });
});

describe("publishing is not counting — B4, AC3, AC4", () => {
  it("counts a live service at the bar and excludes the one below it", async () => {
    const id = await makeSeller({ sheet: "audit-and-assurance" });
    await addService(id, COUNTING_BAR);
    await addService(id, COUNTING_BAR - 1, { name: `${PREFIX}thin` });

    const state = await setupServicesStateFor(id);
    expect(state!.task.live).toBe(2);
    expect(state!.task.counting).toBe(1);
    expect(state!.task.thin).toHaveLength(1);
    // And the callout names the fields rather than saying "incomplete" — B6.
    expect(state!.task.thin[0]!.missing.length).toBeGreaterThan(0);
  });

  it("closes the hub's task 2 on three counting services, not three live ones", async () => {
    const id = await makeSeller({ sheet: "audit-and-assurance" });
    for (let i = 0; i < SERVICES_TARGET; i += 1) {
      await addService(id, COUNTING_BAR - 1);
    }

    const thin = await hubFor(id);
    expect(thin!.tasks.find((task) => task.id === "services")!.done).toBe(false);

    for (let i = 0; i < SERVICES_TARGET; i += 1) {
      await addService(id, COUNTING_BAR);
    }

    const full = await hubFor(id);
    const task = full!.tasks.find((row) => row.id === "services")!;
    expect(task.done).toBe(true);
    expect(task.lever).toBe("services");
  });

  it("pays 7, 13 and 20 points at one, two and three — B5, AC6", async () => {
    const id = await makeSeller({ sheet: "audit-and-assurance" });
    const earned = async () =>
      (await hubFor(id))!.levers.find((lever) => lever.key === "services")!.earned;

    expect(await earned()).toBe(0);
    await addService(id, COUNTING_BAR);
    expect(await earned()).toBe(7);
    await addService(id, COUNTING_BAR);
    expect(await earned()).toBe(13);
    await addService(id, COUNTING_BAR);
    expect(await earned()).toBe(20);
    // The sixth scores nothing — `8c-s` Q3, and the screen says so.
    await addService(id, COUNTING_BAR);
    expect(await earned()).toBe(20);
  });

  it("ignores a draft however complete it is", async () => {
    const id = await makeSeller({ sheet: "audit-and-assurance" });
    await addService(id, 6, { live: false });

    const state = await setupServicesStateFor(id);
    expect(state!.task.counting).toBe(0);
    expect(state!.task.live).toBe(0);
    // A draft is unfinished on purpose, not thin. No callout about one.
    expect(state!.task.thin).toEqual([]);
  });
});

describe("`used by N firms` is a live count — B3, AC2", () => {
  it("counts sellers of work and leaves the goods directory out of it", async () => {
    const before = await setupServicesStateFor(await makeSeller());
    const blank = before!.sheets.find((sheet) => sheet.isDefault)!;

    /*
       Counting every listing put 176 valve traders on the blank sheet, because
       an unclassified category resolves to the default. Arithmetically true,
       and an answer to a question nobody asked: "which sheet are my peers on"
       means firms that sell work.
    */
    await makeSeller({ sellsKind: "goods" });
    await makeSeller({ sellsKind: "goods" });

    const after = await setupServicesStateFor(await makeSeller());
    const stillBlank = after!.sheets.find((sheet) => sheet.isDefault)!;
    // Two goods sellers added, and the count moved by the one services seller.
    expect(stillBlank.shape.usedBy - blank.shape.usedBy).toBeLessThanOrEqual(2);
  });

  it("counts a firm that chose the sheet and one that inherited it", async () => {
    const seed = await setupServicesStateFor(await makeSeller());
    const fm = seed!.sheets.find((sheet) => sheet.id === "facilities-management")!;

    await makeSeller({ sheet: "facilities-management" });

    const after = await setupServicesStateFor(await makeSeller());
    const afterFm = after!.sheets.find((sheet) => sheet.id === "facilities-management")!;
    expect(afterFm.shape.usedBy).toBe(fm.shape.usedBy + 1);
  });

  it("counts the rows off the family rather than claiming a number", async () => {
    const state = await setupServicesStateFor(await makeSeller());
    for (const sheet of state!.sheets) {
      const rows = await prisma.scopeSheetRow.count({ where: { familyId: sheet.id } });
      const filterable = await prisma.scopeSheetRow.count({
        where: { familyId: sheet.id, filterable: true },
      });
      expect(sheet.shape.rows).toBe(rows);
      expect(sheet.shape.filterable).toBe(filterable);
    }
  });
});

describe("matching badges — B2, AC2", () => {
  it("badges the sheet whose services the seller named on `2c-s`", async () => {
    const id = await makeSeller({
      offers: ["Statutory audit", "Corporate tax registration"],
    });
    const state = await setupServicesStateFor(id);
    const audit = state!.sheets.find((sheet) => sheet.id === "audit-and-assurance")!;
    expect(audit.matchRank).toBe(0);
  });

  it("badges nothing when the seller named nothing", async () => {
    const state = await setupServicesStateFor(await makeSeller({ offers: [] }));
    expect(state!.sheets.every((sheet) => sheet.matchRank === null)).toBe(true);
  });
});

describe("no fee amount is collected or displayed — B7, AC7", () => {
  it("keeps `indicativeFee` off the state this screen renders", async () => {
    const id = await makeSeller({ sheet: "audit-and-assurance" });
    const serviceId = await addService(id, 6);
    await prisma.service.update({
      where: { id: serviceId },
      data: { indicativeFee: "From AED 14,000" },
    });

    const state = await setupServicesStateFor(id);
    expect(JSON.stringify(state)).not.toContain("14,000");
    expect(JSON.stringify(state)).not.toContain("indicativeFee");
  });

  it("keeps it off the live preview's own loader too — B11, AC9", async () => {
    const id = await makeSeller({ sheet: "audit-and-assurance" });
    const serviceId = await addService(id, 6);
    await prisma.service.update({
      where: { id: serviceId },
      data: { indicativeFee: "From AED 14,000" },
    });

    const business = await prisma.business.findUniqueOrThrow({
      where: { id },
      select: { slug: true },
    });
    const service = await prisma.service.findUniqueOrThrow({
      where: { id: serviceId },
      select: { slug: true },
    });

    /*
       The preview is fed by the public loader, so it is not merely the same
       markup as `1g-s` but the same data path — `indicativeFee` is not in that
       select and therefore cannot reach the pane any more than it can reach
       the page.
    */
    const shown = await publicServiceFor(business.slug, service.slug);
    expect(shown).not.toBeNull();
    expect(JSON.stringify(shown)).not.toContain("14,000");
  });
});
