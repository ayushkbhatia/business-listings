import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  acceptOffer,
  cloneFromTemplate,
  createTemplate,
  declineOffer,
  deleteTemplate,
  saveTemplate,
  scopeTemplatesFor,
  templateDetailFor,
} from "@/lib/services/scope-template-service";
import { BLANK_FIELDS, CLONE_FILLS } from "@/lib/services/scope-template";
import { completeness } from "@/lib/services/scope-sheet";
import { COUNTING_BAR } from "@/lib/services/setup-sheet";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Board `3h-s` — scope templates, against a database.
 *
 * What a unit test cannot reach: that the CHECK refuses scope and exclusions
 * whatever writes them, that a template edit leaves every live service exactly
 * as it was, that a decline survives a reload while an accept clears it, that a
 * clone lands on `8c-s`'s counting bar, and that deleting a template takes the
 * provenance and nothing else.
 */

const PREFIX = "tpl-3hs-";

let categoryId: string;
let ownerId: string;
const made: string[] = [];

let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });
const owner = () => actor(ownerId, "seller_owner");

async function makeSeller(): Promise<string> {
  const mark = stamp();
  const business = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-T${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      sellsKind: "services",
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  made.push(business.id);
  return business.id;
}

async function makeService(
  businessId: string,
  over?: { live?: boolean; engagementType?: "ongoing_contract" | "one_off_job" | "call_off" },
): Promise<string> {
  const mark = stamp();
  const service = await prisma.service.create({
    data: {
      businessId,
      categoryId,
      name: `${PREFIX}${mark}`,
      slug: `${PREFIX}${mark}`,
      status: over?.live === false ? "draft" : "live",
      engagementType: over?.engagementType ?? "one_off_job",
      turnaround: "2 weeks",
    },
    select: { id: true },
  });
  return service.id;
}

beforeAll(async () => {
  categoryId = (await prisma.category.findFirstOrThrow({ select: { id: true } })).id;
  ownerId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "seller_owner" } },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await prisma.service.deleteMany({ where: { businessId: { in: made } } });
  await prisma.scopeTemplate.deleteMany({ where: { businessId: { in: made } } });
  await prisma.business.deleteMany({ where: { id: { in: made } } });
});

describe("scope and exclusions are never templated — B3, AC2", () => {
  it("refuses them at the model boundary, not only in the form", async () => {
    const id = await makeSeller();
    const made = await createTemplate(owner(), id, "audit-and-assurance", "Compliance");
    expect(made.ok).toBe(true);

    /*
       B3 is explicit that UI-only avoidance will not survive the first import
       script, so the constraint is a CHECK and this is the proof: a direct
       write is refused, whatever wrote it.
    */
    for (const field of BLANK_FIELDS) {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE scope_template SET "values" = $1::jsonb WHERE id = $2`,
          JSON.stringify({ [field]: "something" }),
          made.ok ? made.id : "",
        ),
      ).rejects.toThrow(/travelling_keys_only/);
    }
  });

  it("strips them from a save rather than failing on one", async () => {
    const id = await makeSeller();
    const made = await createTemplate(owner(), id, "audit-and-assurance", "Compliance");
    expect(made.ok).toBe(true);

    const saved = await saveTemplate(owner(), id, made.ok ? made.id : "", {
      name: "Compliance",
      values: {
        feeBasis: "retainer",
        scope: "everything",
        excluded: "nothing",
        turnaround: "a week",
        name: "no",
      },
    });
    expect(saved.ok).toBe(true);

    const [card] = await scopeTemplatesFor(id);
    expect(card!.values).toEqual({ feeBasis: "retainer" });
  });
});

describe("an edit never writes through — B4, AC3", () => {
  it("leaves every service exactly as it was, and offers the change instead", async () => {
    const id = await makeSeller();
    const made = await createTemplate(owner(), id, "audit-and-assurance", "Compliance");
    const templateId = made.ok ? made.id : "";
    const serviceId = await makeService(id, { engagementType: "one_off_job" });
    await prisma.service.update({ where: { id: serviceId }, data: { scopeTemplateId: templateId } });

    const before = await prisma.service.findUniqueOrThrow({
      where: { id: serviceId },
      select: { engagementType: true, feeBasis: true, deliverable: true, updatedAt: true },
    });

    await saveTemplate(owner(), id, templateId, {
      name: "Compliance",
      values: { engagementType: "ongoing_contract", deliverable: "A filed return" },
    });

    const after = await prisma.service.findUniqueOrThrow({
      where: { id: serviceId },
      select: { engagementType: true, feeBasis: true, deliverable: true, updatedAt: true },
    });
    expect(after).toEqual(before);

    const detail = await templateDetailFor(id, made.ok ? made.slug : "");
    const offers = detail!.perService[0]!.offers;
    expect(offers.map((offer) => offer.field).sort()).toEqual(["deliverable", "engagementType"]);
    expect(offers.find((offer) => offer.field === "engagementType")).toMatchObject({
      before: "one_off_job",
      after: "ongoing_contract",
    });
  });
});

describe("accepting and declining — AC3, AC4", () => {
  it("takes one field into one service and leaves the rest alone", async () => {
    const id = await makeSeller();
    const made = await createTemplate(owner(), id, "audit-and-assurance", "Compliance");
    const templateId = made.ok ? made.id : "";
    await saveTemplate(owner(), id, templateId, {
      name: "Compliance",
      values: { engagementType: "ongoing_contract", deliverable: "A filed return" },
    });

    const [mine, other] = await Promise.all([makeService(id), makeService(id)]);
    await prisma.service.updateMany({
      where: { id: { in: [mine, other] } },
      data: { scopeTemplateId: templateId },
    });

    expect(await acceptOffer(owner(), id, mine, "engagementType")).toEqual({ ok: true });

    const taken = await prisma.service.findUniqueOrThrow({
      where: { id: mine },
      select: { engagementType: true, deliverable: true },
    });
    expect(taken.engagementType).toBe("ongoing_contract");
    // One field, one service. The deliverable is still on offer, not applied.
    expect(taken.deliverable).toBeNull();

    const untouched = await prisma.service.findUniqueOrThrow({
      where: { id: other },
      select: { engagementType: true },
    });
    expect(untouched.engagementType).toBe("one_off_job");
  });

  it("writes a revision, so the change log says a person accepted it", async () => {
    const id = await makeSeller();
    const made = await createTemplate(owner(), id, "audit-and-assurance", "Compliance");
    const templateId = made.ok ? made.id : "";
    await saveTemplate(owner(), id, templateId, {
      name: "Compliance",
      values: { engagementType: "ongoing_contract" },
    });
    const serviceId = await makeService(id);
    await prisma.service.update({ where: { id: serviceId }, data: { scopeTemplateId: templateId } });

    await acceptOffer(owner(), id, serviceId, "engagementType");

    const revisions = await prisma.serviceRevision.findMany({
      where: { serviceId, field: "engagementType" },
      select: { before: true, after: true },
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ before: "one_off_job", after: "ongoing_contract" });
  });

  it("stops offering a declined value and keeps the provenance", async () => {
    const id = await makeSeller();
    const made = await createTemplate(owner(), id, "audit-and-assurance", "Compliance");
    const templateId = made.ok ? made.id : "";
    await saveTemplate(owner(), id, templateId, {
      name: "Compliance",
      values: { engagementType: "ongoing_contract" },
    });
    const serviceId = await makeService(id);
    await prisma.service.update({ where: { id: serviceId }, data: { scopeTemplateId: templateId } });

    expect(await declineOffer(owner(), id, serviceId, "engagementType")).toEqual({ ok: true });

    const detail = await templateDetailFor(id, made.ok ? made.slug : "");
    expect(detail!.perService[0]!.offers).toEqual([]);
    // The service keeps its values and its link — the board's §States.
    const service = await prisma.service.findUniqueOrThrow({
      where: { id: serviceId },
      select: { engagementType: true, scopeTemplateId: true },
    });
    expect(service.engagementType).toBe("one_off_job");
    expect(service.scopeTemplateId).toBe(templateId);
  });

  it("offers again when the template moves to a different value", async () => {
    const id = await makeSeller();
    const made = await createTemplate(owner(), id, "audit-and-assurance", "Compliance");
    const templateId = made.ok ? made.id : "";
    await saveTemplate(owner(), id, templateId, {
      name: "Compliance",
      values: { engagementType: "ongoing_contract" },
    });
    const serviceId = await makeService(id);
    await prisma.service.update({ where: { id: serviceId }, data: { scopeTemplateId: templateId } });
    await declineOffer(owner(), id, serviceId, "engagementType");

    /*
       The decline stores the refused value rather than a flag, so "no" means no
       to *that*. A template edited to something else is a new proposal.
    */
    await saveTemplate(owner(), id, templateId, {
      name: "Compliance",
      values: { engagementType: "call_off" },
    });

    const detail = await templateDetailFor(id, made.ok ? made.slug : "");
    expect(detail!.perService[0]!.offers.map((offer) => offer.after)).toEqual(["call_off"]);
  });

  it("clears a decline when the seller changes their mind", async () => {
    const id = await makeSeller();
    const made = await createTemplate(owner(), id, "audit-and-assurance", "Compliance");
    const templateId = made.ok ? made.id : "";
    await saveTemplate(owner(), id, templateId, {
      name: "Compliance",
      values: { engagementType: "ongoing_contract" },
    });
    const serviceId = await makeService(id);
    await prisma.service.update({ where: { id: serviceId }, data: { scopeTemplateId: templateId } });

    await declineOffer(owner(), id, serviceId, "engagementType");
    await acceptOffer(owner(), id, serviceId, "engagementType");

    // A stale decline would suppress the next genuine offer.
    expect(
      await prisma.scopeTemplateDecline.count({ where: { serviceId, fieldKey: "engagementType" } }),
    ).toBe(0);
  });
});

describe("a clone lands on the counting bar — B8, AC5", () => {
  it("arrives as a draft with the template's four and nothing else", async () => {
    const id = await makeSeller();
    const made = await createTemplate(owner(), id, "audit-and-assurance", "Compliance");
    await saveTemplate(owner(), id, made.ok ? made.id : "", {
      name: "Compliance",
      values: {
        engagementType: "ongoing_contract",
        feeBasis: "retainer",
        deliveredWhere: "remote",
        deliverable: "A filed return",
        regulator: "Federal Tax Authority",
      },
    });

    const clone = await cloneFromTemplate(owner(), id, made.ok ? made.id : "", "Excise return");
    expect(clone.ok).toBe(true);

    const service = await prisma.service.findUniqueOrThrow({
      where: { id: clone.ok ? clone.id : "" },
      select: {
        status: true,
        name: true,
        engagementType: true,
        feeBasis: true,
        deliveredWhere: true,
        deliverable: true,
        turnaround: true,
        scope: true,
        excluded: true,
        scopeTemplateId: true,
        values: { select: { fieldKey: true, value: true } },
      },
    });

    // Draft. B8 says so, and a screen that published would put a service with
    // no turnaround on the directory.
    expect(service.status).toBe("draft");
    expect(service.scope).toBeNull();
    expect(service.excluded).toBeNull();
    expect(service.turnaround).toBeNull();
    expect(service.values).toEqual([
      { fieldKey: "regulator", value: "Federal Tax Authority" },
    ]);
    expect(service.scopeTemplateId).toBe(made.ok ? made.id : "");

    /*
       The template fills four; the name typed on the same press is the fifth,
       so turnaround is genuinely the only field left. Four is the `8c-s`
       counting bar, which is what makes the template worth having.
     */
    expect(CLONE_FILLS).toBe(COUNTING_BAR);
    const score = completeness(service);
    expect(score.filled).toBe(CLONE_FILLS + 1);
    expect(score.missing).toEqual(["turnaround"]);
  });

  it("counts toward `8c-s`'s three the moment it is named", async () => {
    const id = await makeSeller();
    const made = await createTemplate(owner(), id, "audit-and-assurance", "Compliance");
    await saveTemplate(owner(), id, made.ok ? made.id : "", {
      name: "Compliance",
      values: {
        engagementType: "ongoing_contract",
        feeBasis: "retainer",
        deliveredWhere: "remote",
        deliverable: "A filed return",
      },
    });
    const clone = await cloneFromTemplate(owner(), id, made.ok ? made.id : "", "Excise return");

    const service = await prisma.service.findUniqueOrThrow({
      where: { id: clone.ok ? clone.id : "" },
      select: {
        name: true,
        engagementType: true,
        feeBasis: true,
        turnaround: true,
        deliveredWhere: true,
        deliverable: true,
      },
    });
    expect(completeness(service).filled).toBeGreaterThanOrEqual(COUNTING_BAR);
  });
});

describe("usage, deletion and tenancy — B6, B7, B9, AC6, AC7, AC8", () => {
  it("counts and names the services using a template", async () => {
    const id = await makeSeller();
    const made = await createTemplate(owner(), id, "audit-and-assurance", "Compliance");
    const templateId = made.ok ? made.id : "";
    const [one, two] = await Promise.all([makeService(id), makeService(id)]);
    await makeService(id); // not on the template
    await prisma.service.updateMany({
      where: { id: { in: [one, two] } },
      data: { scopeTemplateId: templateId },
    });

    const [card] = await scopeTemplatesFor(id);
    expect(card!.usedBy).toBe(2);
    expect(card!.services).toHaveLength(2);
    expect(card!.services.map((row) => row.id).sort()).toEqual([one, two].sort());
  });

  it("leaves a service's values intact when the template goes", async () => {
    const id = await makeSeller();
    const made = await createTemplate(owner(), id, "audit-and-assurance", "Compliance");
    const templateId = made.ok ? made.id : "";
    await saveTemplate(owner(), id, templateId, {
      name: "Compliance",
      values: { engagementType: "ongoing_contract" },
    });
    const clone = await cloneFromTemplate(owner(), id, templateId, "Excise return");
    const serviceId = clone.ok ? clone.id : "";

    expect(await deleteTemplate(owner(), id, templateId)).toEqual({ ok: true });

    const service = await prisma.service.findUniqueOrThrow({
      where: { id: serviceId },
      select: { engagementType: true, scopeTemplateId: true },
    });
    // Keeps everything, loses only the link — B7, AC7.
    expect(service.engagementType).toBe("ongoing_contract");
    expect(service.scopeTemplateId).toBeNull();
  });

  it("keeps templates to their own business — B9, AC8", async () => {
    const [mine, theirs] = await Promise.all([makeSeller(), makeSeller()]);
    const made = await createTemplate(owner(), mine, "audit-and-assurance", "Compliance");
    const templateId = made.ok ? made.id : "";

    expect(await scopeTemplatesFor(theirs)).toEqual([]);
    expect(await templateDetailFor(theirs, made.ok ? made.slug : "")).toBeNull();
    expect(await deleteTemplate(owner(), theirs, templateId)).toEqual({ ok: false });
    expect(await scopeTemplatesFor(mine)).toHaveLength(1);
  });

  it("refuses a family that is not a family", async () => {
    const id = await makeSeller();
    expect(await createTemplate(owner(), id, "not-a-family", "Compliance")).toEqual({
      ok: false,
      reason: "unknown_family",
    });
  });

  it("refuses a template with no name", async () => {
    const id = await makeSeller();
    expect(await createTemplate(owner(), id, "audit-and-assurance", "   ")).toEqual({
      ok: false,
      reason: "name_required",
    });
  });
});
