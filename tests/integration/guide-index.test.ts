import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor, Role } from "@/lib/auth/roles";
import { guideIndex } from "@/lib/guides/queries";
import { saveGuide, saveGuideSubject, setFeaturedGuide } from "@/lib/guides/service";
import { guideSlugCollision } from "@/lib/guides/subjects";

/**
 * Board 10b — the guide index.
 *
 * A hub has one structural obligation: link to everything it is the hub for.
 * The board linked to seven of twenty-two, so what is asserted here is that the
 * query behind the page cannot leave a published guide out — including one
 * nobody has filed under a subject, which is the case that would silently drop
 * an article from its own index.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });
const PREFIX = "gidx-test-";

let opsLeadId: string;
let subjectId: string;
let unfiledId: string;
let filedId: string;

/** A body over the 1,200-word floor, with the directory link publish requires. */
function body(): { id: string; kind: "text" | "cta"; values: Record<string, unknown> }[] {
  return [
    { id: "p1", kind: "text", values: { body: Array.from({ length: 1_300 }, () => "word").join(" ") } },
    { id: "c1", kind: "cta", values: { body: "Browse the directory at /categories.", label: "Browse" } },
  ];
}

beforeAll(async () => {
  opsLeadId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      orderBy: { id: "asc" as const },
      select: { id: true },
    })
  ).id;

  const subject = await saveGuideSubject({
    actor: actor(opsLeadId, "staff_ops_lead"),
    slug: `${PREFIX}shelf`,
    name: "Index test shelf",
    blurb: null,
    sortOrder: 90,
    reason: "Fixture for the guide index tests.",
  });
  if (!subject.ok) throw new Error(subject.message);
  subjectId = subject.id;

  for (const [key, filed] of [
    ["filed", true],
    ["unfiled", false],
  ] as const) {
    const saved = await saveGuide({
      actor: actor(opsLeadId, "staff_ops_lead"),
      slug: `${PREFIX}${key}`,
      title: `Index test ${key}`,
      summary: "A summary long enough to satisfy the twenty-character floor.",
      byline: null,
      ctaCategoryId: null,
      blocks: body(),
      subjectId: filed ? subjectId : null,
      reviewCadenceMonths: 6,
      reason: "Fixture for the guide index tests.",
    });
    if (!saved.ok) throw new Error(saved.message);
    if (filed) filedId = saved.id;
    else unfiledId = saved.id;

    await prisma.guide.update({
      where: { id: saved.id },
      data: {
        publishedAt: new Date("2026-01-01T00:00:00.000Z"),
        // Nine months ago against a six-month window: overdue, and the reader
        // is told so. Nothing in the seed is overdue, so without a fixture the
        // one state the board added dates for would never render in a test.
        regulatoryCheckedAt: new Date("2025-12-01T00:00:00.000Z"),
      },
    });
  }
});

afterAll(async () => {
  await prisma.guide.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.guideSubject.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe("criterion 1 — the hub links to everything it is a hub for", () => {
  it("carries every published guide, filed or not", async () => {
    const index = await guideIndex();
    const slugs = index.all.map((card) => card.slug);

    const published = await prisma.guide.count({ where: { publishedAt: { not: null } } });
    expect(index.all.length, "the index is the whole published set").toBe(published);

    expect(slugs).toContain(`${PREFIX}filed`);
    /*
       The case that would quietly lose an article. A guide nobody has filed has
       no subject to group under, and an index built by walking subjects would
       drop it — reachable only by search, which is the fifteen-articles defect
       this board exists to remove.
    */
    expect(slugs, "an unfiled guide is still on its own index").toContain(`${PREFIX}unfiled`);

    // And the shelves account for the same set, once each.
    const onShelves = index.shelves.flatMap((shelf) => shelf.guides.map((card) => card.slug));
    expect(onShelves.sort()).toEqual([...slugs].sort());
  }, 120_000);

  it("gives an unfiled guide a shelf that says so rather than no shelf", async () => {
    const index = await guideIndex();
    const unfiled = index.shelves.find((shelf) => shelf.slug === null);
    expect(unfiled, "there is a shelf for guides nobody has filed").toBeTruthy();
    expect(unfiled?.guides.map((card) => card.slug)).toContain(`${PREFIX}unfiled`);
  }, 60_000);
});

describe("criterion 3 — the counts are one query", () => {
  it("the total and the shelf counts are the same number, split up", async () => {
    const index = await guideIndex();
    const summed = index.shelves.reduce((total, shelf) => total + shelf.guides.length, 0);
    expect(summed).toBe(index.all.length);
  }, 60_000);
});

describe("criteria 5 and 6 — the dates, and saying overdue out loud", () => {
  it("computes overdue from the article's own window", async () => {
    const index = await guideIndex(new Date("2026-09-06T00:00:00.000Z"));
    const card = index.all.find((row) => row.slug === `${PREFIX}filed`);
    expect(card?.freshness.checkedAt).toEqual(new Date("2025-12-01T00:00:00.000Z"));
    expect(card?.freshness.overdue, "nine months against a six-month window").toBe(true);
  }, 60_000);

  it("never calls a guide with no window overdue, however old the check", async () => {
    await prisma.guide.update({
      where: { id: unfiledId },
      data: { reviewCadenceMonths: null },
    });
    const index = await guideIndex(new Date("2026-09-06T00:00:00.000Z"));
    const card = index.all.find((row) => row.slug === `${PREFIX}unfiled`);
    expect(card?.freshness.overdue).toBe(false);
    // The date still renders. Not overdue is not the same as not dated.
    expect(card?.freshness.checkedAt).not.toBeNull();
  }, 60_000);
});

describe("criterion 4 — the featured slot is one at a time", () => {
  it("moves the slot rather than adding a second", async () => {
    const lead = actor(opsLeadId, "staff_ops_lead");

    const first = await setFeaturedGuide(lead, filedId, "Fixture: taking the slot.", "Because.");
    expect(first.ok).toBe(true);
    expect(await prisma.guide.count({ where: { featuredAt: { not: null } } })).toBe(1);

    const second = await setFeaturedGuide(lead, unfiledId, "Fixture: moving the slot.", "Because.");
    expect(second.ok).toBe(true);
    // Still one. The database refuses a second with a unique index, so a move
    // that added rather than replaced would throw rather than pass quietly.
    expect(await prisma.guide.count({ where: { featuredAt: { not: null } } })).toBe(1);

    const index = await guideIndex();
    expect(index.featured?.slug).toBe(`${PREFIX}unfiled`);

    /*
       The note travels with the slot. A sentence saying why an article is first
       is false the moment a different article is, which is the frozen-claim
       failure §Ordering exists to prevent.
    */
    const vacated = await prisma.guide.findUniqueOrThrow({
      where: { id: filedId },
      select: { featuredNote: true },
    });
    expect(vacated.featuredNote).toBeNull();
  }, 120_000);

  it("refuses a draft, because the hero would be a link to a 404", async () => {
    const draft = await saveGuide({
      actor: actor(opsLeadId, "staff_ops_lead"),
      slug: `${PREFIX}draft`,
      title: "Index test draft",
      summary: "A summary long enough to satisfy the twenty-character floor.",
      byline: null,
      ctaCategoryId: null,
      blocks: body(),
      reason: "Fixture for the guide index tests.",
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    expect(
      await setFeaturedGuide(actor(opsLeadId, "staff_ops_lead"), draft.id, "Fixture."),
    ).toMatchObject({ ok: false, error: "not_published" });
  }, 60_000);

  it("clears the slot, and the page then renders no hero", async () => {
    expect(
      await setFeaturedGuide(actor(opsLeadId, "staff_ops_lead"), null, "Fixture: clearing."),
    ).toMatchObject({ ok: true });
    expect((await guideIndex()).featured).toBeNull();
  }, 60_000);
});

describe("criterion 9 — one namespace under /guides/", () => {
  it("refuses a subject that takes a guide's address", async () => {
    const clash = await saveGuideSubject({
      actor: actor(opsLeadId, "staff_ops_lead"),
      slug: `${PREFIX}filed`,
      name: "Clashing shelf",
      blurb: null,
      sortOrder: 91,
      reason: "Fixture: this must be refused.",
    });
    expect(clash).toMatchObject({ ok: false, error: "slug_taken" });
  }, 60_000);

  it("refuses a guide that takes a subject's address", async () => {
    const clash = await saveGuide({
      actor: actor(opsLeadId, "staff_ops_lead"),
      slug: `${PREFIX}shelf`,
      title: "Clashing guide",
      summary: "A summary long enough to satisfy the twenty-character floor.",
      byline: null,
      ctaCategoryId: null,
      blocks: body(),
      reason: "Fixture: this must be refused.",
    });
    expect(clash).toMatchObject({ ok: false, error: "subject_holds_slug" });
  }, 60_000);

  it("refuses a guide on a fixed route, which would have no URL at all", async () => {
    // A static segment answers before the dynamic one, so a guide minted at
    // `how-we-check` would not be confusing — it would be unreachable.
    const reserved = await saveGuide({
      actor: actor(opsLeadId, "staff_ops_lead"),
      slug: "how-we-check",
      title: "Reserved slug guide",
      summary: "A summary long enough to satisfy the twenty-character floor.",
      byline: null,
      ctaCategoryId: null,
      blocks: body(),
      reason: "Fixture: this must be refused.",
    });
    expect(reserved).toMatchObject({ ok: false, error: "slug_reserved" });
  }, 60_000);

  it("does not call a slug a collision with itself", async () => {
    expect(await guideSlugCollision(`${PREFIX}shelf`, "subject", { id: subjectId })).toBeNull();
  }, 60_000);
});
