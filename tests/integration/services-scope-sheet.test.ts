import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  createService,
  deleteService,
  familyFor,
  patchServiceField,
  publicServiceFor,
  publicServicesFor,
  reorderServices,
  serviceForEditor,
  servicesBoardFor,
  setServiceStatus,
} from "@/lib/services/service";
import type { Actor } from "@/lib/auth/roles";

/**
 * Boards `3g-s`, `3f-s`, `1g-s` — the scope sheet against a database.
 *
 * What a unit test cannot reach: that the fee basis is validated against **this
 * service's family** rather than a global list, that `indicativeFee` is not in
 * the public loader's `select` at all, that an incomplete sheet publishes, and
 * that every field change writes a revision with the value it replaced.
 */

const PREFIX = "svc-sheet-";
const owner: Actor = { id: "00000000-0000-4000-8000-0000000000aa", roles: ["seller_owner"] };
const sales: Actor = { id: "00000000-0000-4000-8000-0000000000bb", roles: ["seller_sales"] };

let businessId: string;
let categoryId: string;
let auditCategoryId: string;
const made: string[] = [];

let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

async function makeBusiness(): Promise<string> {
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
      sellsKind: "services",
      publishedAt: new Date(),
      // Pro, so the plan cap is not what these tests are about.
      planId: "pro",
    },
    select: { id: true },
  });
  made.push(business.id);
  return business.id;
}

beforeAll(async () => {
  for (const actor of [owner, sales]) {
    await prisma.user.upsert({
      where: { id: actor.id },
      create: { id: actor.id, email: `${actor.id}@example.test`, roles: [...actor.roles] },
      update: {},
    });
  }

  const plain = await prisma.category.create({
    data: { slug: `${PREFIX}plain`, code: "SS", name: "Scope sheet — no family" },
    select: { id: true },
  });
  categoryId = plain.id;

  const audit = await prisma.category.create({
    data: {
      slug: `${PREFIX}audit`,
      code: "SS",
      name: "Scope sheet — audit",
      scopeFamilyId: "audit-and-assurance",
    },
    select: { id: true },
  });
  auditCategoryId = audit.id;

  businessId = await makeBusiness();
});

afterAll(async () => {
  await prisma.service.deleteMany({ where: { businessId: { in: made } } });
  await prisma.serviceCoverage.deleteMany({ where: { businessId: { in: made } } });
  await prisma.business.deleteMany({ where: { id: { in: made } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { in: [owner.id, sales.id] } } });
});

describe("the family — B2", () => {
  it("falls back to the seeded default where no category names one", async () => {
    /*
       Which is every category in production. The fallback is not a global list:
       it is what an unclassified trade resolves to, the same way an unset
       `tradeKind` resolves to `goods`.
    */
    const family = await familyFor(categoryId);
    expect(family.id).toBe("general");
    expect(family.feeBases.length).toBeGreaterThan(0);
  });

  it("gives a category with a family its own fee bases and its own labels", async () => {
    const general = await familyFor(categoryId);
    const audit = await familyFor(auditCategoryId);

    expect(audit.id).toBe("audit-and-assurance");
    expect(audit.feeBases.map((row) => row.key)).not.toEqual(general.feeBases.map((r) => r.key));
    // The label is what makes a family a family: the same key reads differently.
    expect(audit.rows.find((row) => row.key === "sectors")?.label).toBe("Sectors most audited");
    expect(general.rows.find((row) => row.key === "sectors")?.label).toBe("Sectors served");
  });

  it("marks five rows filterable, and turnaround is not one of them", async () => {
    // The board's own rule: a row is filterable when its values are enumerable
    // across the family, and a turnaround is never that.
    const family = await familyFor(auditCategoryId);
    expect(family.rows.filter((row) => row.filterable)).toHaveLength(5);
    expect(family.rows.find((row) => row.key === "turnaround")?.filterable).toBe(false);
  });

  it("orders the rows the same way for every firm in a family", async () => {
    const first = await familyFor(auditCategoryId);
    const second = await familyFor(auditCategoryId);
    expect(first.rows.map((row) => row.key)).toEqual(second.rows.map((row) => row.key));
  });
});

describe("creating and editing", () => {
  it("creates a draft with a slug derived from the name", async () => {
    const result = await createService(owner, businessId, "Statutory audit");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.slug).toBe("statutory-audit");

    const state = await serviceForEditor(businessId, result.id);
    expect(state?.status).toBe("draft");
    expect(state?.completeness.filled).toBe(1);
  });

  it("de-duplicates a second service with the same name", async () => {
    const again = await createService(owner, businessId, "Statutory audit");
    expect(again.ok).toBe(true);
    if (!again.ok) throw new Error("unreachable");
    expect(again.slug).toBe("statutory-audit-2");
  });

  it("refuses a seat that may not edit the catalogue", async () => {
    // Board 7d gives "edit products & specs" to the owner and the manager. A
    // service is what a product is for a firm that sells work, so it is the
    // same grant rather than a capability no board ever issued.
    await expect(createService(sales, businessId, "Nope")).rejects.toThrow();
  });

  it("writes a revision with the value it replaced — B9, criterion 7", async () => {
    const created = await createService(owner, businessId, "Fire safety inspection");
    if (!created.ok) throw new Error("unreachable");

    await patchServiceField(owner, businessId, created.id, "turnaround", "Within 48h");
    await patchServiceField(owner, businessId, created.id, "turnaround", "Same day");

    const rows = await prisma.serviceRevision.findMany({
      where: { serviceId: created.id, field: "turnaround" },
      orderBy: { createdAt: "asc" },
      select: { before: true, after: true, actorId: true },
    });
    expect(rows).toEqual([
      { before: null, after: "Within 48h", actorId: owner.id },
      { before: "Within 48h", after: "Same day", actorId: owner.id },
    ]);
  });

  it("logs nothing when a field is saved unchanged", async () => {
    // A seller who clicks into a field and out again has changed nothing, and
    // a log full of those is a log nobody reads.
    const created = await createService(owner, businessId, "No-op test");
    if (!created.ok) throw new Error("unreachable");

    await patchServiceField(owner, businessId, created.id, "deliverable", "A report");
    await patchServiceField(owner, businessId, created.id, "deliverable", "A report");

    const count = await prisma.serviceRevision.count({
      where: { serviceId: created.id, field: "deliverable" },
    });
    expect(count).toBe(1);
  });

  it("refuses a fee basis from another family — B2, criterion 2", async () => {
    /*
       The single most important check on the editor. `per_sqft_yr` is a real
       key in the facilities-management family and is not offered by the
       default one; saving it here would render a raw key on the firm's own
       public page and a facet that matches nothing.
    */
    const created = await createService(owner, businessId, "Foreign basis");
    if (!created.ok) throw new Error("unreachable");

    const refused = await patchServiceField(
      owner,
      businessId,
      created.id,
      "feeBasis",
      "per_sqft_yr",
    );
    expect(refused).toEqual({ ok: false, reason: "foreign_fee_basis" });

    const accepted = await patchServiceField(owner, businessId, created.id, "feeBasis", "fixed_fee");
    expect(accepted.ok).toBe(true);
  });

  it("flags a fee basis the family stopped offering rather than guessing a mapping", async () => {
    /*
       `3g-s` §States, the category-move case. `per_visit` exists in the default
       family and not in audit, and it would map cleanly onto `per_hour` — which
       is exactly why guessing is refused. The next pair would not.
    */
    const created = await createService(owner, businessId, "Moved trade");
    if (!created.ok) throw new Error("unreachable");
    await patchServiceField(owner, businessId, created.id, "feeBasis", "per_visit");
    await prisma.service.update({
      where: { id: created.id },
      data: { categoryId: auditCategoryId },
    });

    const state = await serviceForEditor(businessId, created.id);
    expect(state?.feeBasisStale).toBe(true);
    // And the value is still on the record — flagged, not cleared behind their back.
    expect(state?.feeBasis).toBe("per_visit");
  });

  it("refuses to clear the name, which is a live URL and a row in a list", async () => {
    const created = await createService(owner, businessId, "Named");
    if (!created.ok) throw new Error("unreachable");
    expect(await patchServiceField(owner, businessId, created.id, "name", "  ")).toEqual({
      ok: false,
      reason: "name_required",
    });
  });

  it("writes an optional field as a row, and clears it by deleting one", async () => {
    const created = await createService(owner, businessId, "Optional test");
    if (!created.ok) throw new Error("unreachable");

    await patchServiceField(owner, businessId, created.id, "regulator", "ISO 41001");
    expect(
      await prisma.scopeFieldValue.count({ where: { serviceId: created.id } }),
    ).toBe(1);

    await patchServiceField(owner, businessId, created.id, "regulator", "");
    expect(
      await prisma.scopeFieldValue.count({ where: { serviceId: created.id } }),
    ).toBe(0);
  });

  it("will not touch another business's service", async () => {
    const other = await makeBusiness();
    const created = await createService(owner, other, "Theirs");
    if (!created.ok) throw new Error("unreachable");

    expect(
      await patchServiceField(owner, businessId, created.id, "turnaround", "Mine now"),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("publishing — B4, criterion 4", () => {
  it("publishes a sheet at any completeness", async () => {
    /*
       Six required fields make a sheet complete, not publishable. Gate
       publishing on the score and sellers type "TBC" into six fields to clear
       it, which destroys the comparison the fields exist to create.
    */
    const created = await createService(owner, businessId, "Four of six");
    if (!created.ok) throw new Error("unreachable");
    await patchServiceField(owner, businessId, created.id, "engagementType", "one_off_job");
    await patchServiceField(owner, businessId, created.id, "turnaround", "Within 48h");
    await patchServiceField(owner, businessId, created.id, "feeBasis", "on_assessment");

    const state = await serviceForEditor(businessId, created.id);
    expect(state?.completeness.filled).toBe(4);

    const result = await setServiceStatus(owner, businessId, [created.id], "live");
    expect(result).toEqual({ ok: true, changed: 1 });

    const row = await prisma.service.findUniqueOrThrow({
      where: { id: created.id },
      select: { status: true, publishedAt: true },
    });
    expect(row.status).toBe("live");
    expect(row.publishedAt).not.toBeNull();
  });

  it("keeps the first publish date through an unpublish and a republish", async () => {
    // The rule `Location.publishedAt` follows: a service that has been live
    // once has made a claim to buyers, and unpublishing does not un-make it.
    const created = await createService(owner, businessId, "Date keeper");
    if (!created.ok) throw new Error("unreachable");

    await setServiceStatus(owner, businessId, [created.id], "live");
    const first = await prisma.service.findUniqueOrThrow({
      where: { id: created.id },
      select: { publishedAt: true },
    });

    await setServiceStatus(owner, businessId, [created.id], "draft");
    await setServiceStatus(owner, businessId, [created.id], "live");

    const after = await prisma.service.findUniqueOrThrow({
      where: { id: created.id },
      select: { publishedAt: true },
    });
    expect(after.publishedAt?.getTime()).toBe(first.publishedAt?.getTime());
  });

  it("publishes several at once and logs each", async () => {
    const a = await createService(owner, businessId, "Bulk one");
    const b = await createService(owner, businessId, "Bulk two");
    if (!a.ok || !b.ok) throw new Error("unreachable");

    const result = await setServiceStatus(owner, businessId, [a.id, b.id], "live");
    expect(result).toEqual({ ok: true, changed: 2 });
    expect(
      await prisma.serviceRevision.count({
        where: { serviceId: { in: [a.id, b.id] }, field: "status" },
      }),
    ).toBe(2);
  });

  it("counts nothing when the rows are already in that state", async () => {
    const created = await createService(owner, businessId, "Already draft");
    if (!created.ok) throw new Error("unreachable");
    expect(await setServiceStatus(owner, businessId, [created.id], "draft")).toEqual({
      ok: true,
      changed: 0,
    });
  });
});

describe("the list — `3f-s`", () => {
  it("counts live and draft from the rows it renders", async () => {
    const fresh = await makeBusiness();
    const a = await createService(owner, fresh, "One");
    const b = await createService(owner, fresh, "Two");
    if (!a.ok || !b.ok) throw new Error("unreachable");
    await setServiceStatus(owner, fresh, [a.id], "live");

    const board = await servicesBoardFor(fresh);
    expect(board.live).toBe(1);
    expect(board.draft).toBe(1);
    expect(board.rows).toHaveLength(2);
  });

  it("names the lowest live row for the line under the table — Q1", async () => {
    const fresh = await makeBusiness();
    const full = await createService(owner, fresh, "Complete one");
    const thin = await createService(owner, fresh, "Thin one");
    if (!full.ok || !thin.ok) throw new Error("unreachable");

    for (const [field, value] of [
      ["engagementType", "one_off_job"],
      ["feeBasis", "fixed_fee"],
      ["turnaround", "A week"],
      ["deliveredWhere", "remote"],
      ["deliverable", "A report"],
    ] as const) {
      await patchServiceField(owner, fresh, full.id, field, value);
    }
    await setServiceStatus(owner, fresh, [full.id, thin.id], "live");

    const board = await servicesBoardFor(fresh);
    expect(board.worst?.name).toBe("Thin one");
    expect(board.worst?.completeness.filled).toBe(1);
  });

  it("says nothing when every live sheet is complete", async () => {
    const fresh = await makeBusiness();
    const board = await servicesBoardFor(fresh);
    expect(board.worst).toBeNull();
  });

  it("renders the family's label for a stored fee-basis key, never the key", async () => {
    const fresh = await makeBusiness();
    const created = await createService(owner, fresh, "Labelled");
    if (!created.ok) throw new Error("unreachable");
    await patchServiceField(owner, fresh, created.id, "feeBasis", "per_month");

    const board = await servicesBoardFor(fresh);
    expect(board.rows[0]?.feeBasisLabel).toBe("Per month");
  });

  it("meters services against the plan — board `2e-s`", async () => {
    /*
       The eighth number. A cap that does not exist is not a generous cap: it is
       `productLimit` quietly not applying to half the directory.
    */
    const fresh = await makeBusiness();
    await prisma.business.update({ where: { id: fresh }, data: { planId: "free" } });

    const board = await servicesBoardFor(fresh);
    expect(board.allowance.cap).toBe(3);

    for (const name of ["One", "Two", "Three"]) {
      expect((await createService(owner, fresh, name)).ok).toBe(true);
    }
    const refused = await createService(owner, fresh, "Four");
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("unreachable");
    expect(refused).toMatchObject({ reason: "at_cap", cap: 3, planName: "Free" });
  });

  it("persists the seller's order — B5", async () => {
    const fresh = await makeBusiness();
    const a = await createService(owner, fresh, "First");
    const b = await createService(owner, fresh, "Second");
    if (!a.ok || !b.ok) throw new Error("unreachable");

    await reorderServices(owner, fresh, [b.id, a.id]);
    const board = await servicesBoardFor(fresh);
    expect(board.rows.map((row) => row.name)).toEqual(["Second", "First"]);
  });

  it("leaves rows a stale tab did not know about at the end rather than reshuffling them", async () => {
    const fresh = await makeBusiness();
    const a = await createService(owner, fresh, "Known");
    const b = await createService(owner, fresh, "Unknown to the tab");
    if (!a.ok || !b.ok) throw new Error("unreachable");

    await reorderServices(owner, fresh, [a.id]);
    const board = await servicesBoardFor(fresh);
    expect(board.rows.map((row) => row.name)).toEqual(["Known", "Unknown to the tab"]);
  });

  it("removes one service, and only from its own business", async () => {
    const fresh = await makeBusiness();
    const created = await createService(owner, fresh, "Doomed");
    if (!created.ok) throw new Error("unreachable");

    expect(await deleteService(owner, businessId, created.id)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await deleteService(owner, fresh, created.id)).toEqual({ ok: true });
  });
});

describe("the public page — `1g-s`", () => {
  let publicBusiness: string;
  let publicSlug: string;

  beforeAll(async () => {
    publicBusiness = await makeBusiness();
    const row = await prisma.business.findUniqueOrThrow({
      where: { id: publicBusiness },
      select: { slug: true },
    });
    publicSlug = row.slug;

    const created = await createService(owner, publicBusiness, "Statutory audit");
    if (!created.ok) throw new Error("unreachable");
    for (const [field, value] of [
      ["engagementType", "ongoing_contract"],
      ["feeBasis", "fixed_fee"],
      ["turnaround", "3–4 weeks from complete records"],
      ["deliveredWhere", "remote"],
      ["deliverable", "Signed audit report"],
      ["scope", "Planning, testing, the report."],
      ["excluded", "Bookkeeping. Group consolidation."],
      ["indicativeFee", "From AED 14,000"],
      ["regulator", "IFRS"],
    ] as const) {
      await patchServiceField(owner, publicBusiness, created.id, field, value);
    }
    await setServiceStatus(owner, publicBusiness, [created.id], "live");
  });

  it("never carries the indicative fee — B5, B3, criterion 3", async () => {
    /*
       The one field where a leak is a commercial problem rather than a bug. It
       is excluded from the loader's `select`, not filtered out of a template,
       so a later contributor spreading the record into a serialiser cannot leak
       what was never fetched.
    */
    const service = await publicServiceFor(publicSlug, "statutory-audit");
    expect(service).not.toBeNull();
    expect(JSON.stringify(service)).not.toContain("14,000");
    expect(Object.keys(service!)).not.toContain("indicativeFee");
  });

  it("returns unfilled rows rather than dropping them", async () => {
    /*
       The one place this build diverges from a build note, and it is stated in
       `docs/services-build-plan.md` §4g: `CLAUDE.md` § Interface honesty says
       unfilled rows stay visible because what is unanswered is what makes an
       enquiry high-intent, and the board's own render prints the count of
       unfilled rows anyway.
    */
    const service = await publicServiceFor(publicSlug, "statutory-audit");
    expect(service!.rows).toHaveLength(9);
    expect(service!.rows.find((row) => row.key === "languages")?.value).toBeNull();
    // Six of the nine: the five enum-and-text required rows plus `regulator`.
    // `scope` and `excluded` are not rows — they are the panel above the table.
    expect(service!.filled).toBe(6);
    expect(service!.total).toBe(9);
  });

  it("renders the fee basis as the family's label rather than the stored key", async () => {
    const service = await publicServiceFor(publicSlug, "statutory-audit");
    expect(service!.rows.find((row) => row.key === "fee_basis")?.value).toBe("Fixed fee");
  });

  it("gives three chips and no availability chip — D11", async () => {
    // The fourth chip in the design render is "Accepting new clients". A listed
    // business is taking work, and a stale flag is worse than no flag.
    const service = await publicServiceFor(publicSlug, "statutory-audit");
    expect(service!.chips.map((chip) => chip.key)).toEqual([
      "engagement_type",
      "turnaround",
      "fee_basis",
    ]);
  });

  it("does not resolve a draft", async () => {
    const draft = await createService(owner, publicBusiness, "Not yet");
    if (!draft.ok) throw new Error("unreachable");
    expect(await publicServiceFor(publicSlug, draft.slug)).toBeNull();
  });

  it("does not resolve a service on an unpublished listing", async () => {
    await prisma.business.update({ where: { id: publicBusiness }, data: { publishedAt: null } });
    expect(await publicServiceFor(publicSlug, "statutory-audit")).toBeNull();
    await prisma.business.update({
      where: { id: publicBusiness },
      data: { publishedAt: new Date() },
    });
  });

  it("lists only the live ones, in the seller's order", async () => {
    const rows = await publicServicesFor(publicBusiness);
    expect(rows.map((row) => row.name)).toEqual(["Statutory audit"]);
  });
});
