import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  emirateCategoryState,
  publishEmiratePage,
  saveEmirateIntro,
  unpublishEmiratePage,
  emirateMatrix,
  emiratePagePath,
  liveEmiratePages,
  MATRIX_EMIRATES,
} from "@/lib/seo/emirate";
import type { Actor } from "@/lib/auth/roles";
import { VERIFIED_TIER } from "@/lib/verification";
import { saveLandingFaq, scopeForEmirate } from "@/lib/seo/landing";

/**
 * Board 6a's fourth publish condition, as a fixture.
 *
 * Four questions with two of them answerable only about this scope. The
 * emirate pages publish on the same four conditions as the area pages — one
 * gate, one `landingState`, because two that agreed until somebody changed one
 * is how the sitemap ends up carrying a URL that 404s.
 */
const FAQ = [
  { question: "What is stocked here?", answer: "Most of it.", scopeSpecific: true },
  { question: "Who delivers same day?", answer: "Several.", scopeSpecific: true },
  { question: "Is a trade licence checked?", answer: "Against the issuing authority.", scopeSpecific: false },
  { question: "How fast do they reply?", answer: "It is measured.", scopeSpecific: false },
];

/**
 * Board 6c's load-bearing logic, against a real database.
 *
 * The threshold rule is the whole page: it decides whether a number is a link
 * or plain text, and whether a URL is in the sitemap. With the seeded data no
 * cell clears its floors — which is the honest cold-start state and exactly why
 * these tests build their own supply. A rule nothing exercises is a rule nobody
 * can trust, and "it renders no links today" is not evidence that it would
 * render the right ones tomorrow.
 */

const PREFIX = "cat-index-test-";
let seq = 0;

function stamp() {
  seq += 1;
  return `${Date.now().toString(36)}${seq}`;
}

/** An ops lead, for the service calls that write an audit row. */
async function opsLead(): Promise<Actor> {
  const user = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "staff_ops_lead" } },
    select: { id: true, roles: true },
  });
  return { id: user.id, roles: user.roles as Actor["roles"] };
}

async function removeFixtures() {
  await prisma.emiratePage.deleteMany({ where: { category: { slug: { startsWith: PREFIX } } } });
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.area.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

/**
 * An area in the given emirate, made if the seed has none there.
 *
 * The seed covers Dubai, Sharjah, Abu Dhabi and Ajman; the other three
 * emirates have no areas at all, which is itself the honest state of a young
 * directory. These tests need supply in the quiet ones precisely because that
 * is where the floors bite.
 */
async function areaIn(emirate: string): Promise<string> {
  const existing = await prisma.area.findFirst({
    where: { emirate: emirate as never },
    select: { id: true },
  });
  if (existing) return existing.id;

  const made = await prisma.area.create({
    data: {
      emirate: emirate as never,
      name: `${PREFIX}${emirate}`,
      slug: `${PREFIX}${emirate}`,
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  return made.id;
}

afterAll(removeFixtures);

/** Enough intro to clear the 250-word floor, without pretending to be copy. */
function intro(): string {
  return Array.from({ length: 260 }, (_, i) => `word${i}`).join(" ");
}

/**
 * A sector with `listings` suppliers in one emirate, `verified` of them
 * verified, and an intro long enough to clear the word floor.
 */
async function sectorWithSupply(options: {
  listings: number;
  verified: number;
  emirate: string;
  withIntro: boolean;
}) {
  const tag = stamp();
  const areaId = await areaIn(options.emirate);

  const category = await prisma.category.create({
    data: {
      slug: `${PREFIX}${tag}`,
      name: `Test sector ${tag}`,
      code: "TS",
      publishThreshold: 60,
      verifiedShareMin: 0.3,
    },
    select: { id: true, slug: true },
  });

  /*
     The paragraph belongs to this (emirate, sector) pair now, not to the
     sector. Written through the service so the fixture exercises the same
     path the admin screen does, audit row and all.
  */
  if (options.withIntro) {
    await saveEmirateIntro({
      actor: await opsLead(),
      emirate: options.emirate,
      categoryId: category.id,
      intro: intro(),
      reason: "Fixture for the category index tests.",
    });
    /*
       And the questions, which board 6a made the fourth publish condition and
       applied to both landing classes — the 84 emirate pages this matrix links
       included. `withIntro` now means "the copy is written", which is the two
       of them: a paragraph and four questions, two of them local.
    */
    const scope = await scopeForEmirate(options.emirate, category.id);
    if (scope) {
      await saveLandingFaq(
        await opsLead(),
        scope,
        FAQ,
        "Fixture for the category index tests.",
      );
    }
  }

  for (let i = 0; i < options.listings; i += 1) {
    await prisma.business.create({
      data: {
        tradeName: `${PREFIX}${tag}-${i}`,
        displayName: `${PREFIX}${tag}-${i}`,
        slug: `${PREFIX}${tag}-${i}`,
        licenceNumber: `DED-${tag}-${i}`,
        licenceAuthority: "DED",
        licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
        primaryCategoryId: category.id,
        verificationTier: i < options.verified ? VERIFIED_TIER : 0,
        publishedAt: new Date(),
        locations: {
          create: {
            type: "head_office",
            emirate: options.emirate as never,
            areaId,
            addressLine: "Unit 1",
            published: true,
          },
        },
      },
    });
  }

  return category;
}

describe("the threshold rule decides whether a cell is a link", () => {
  it("clears the floors on 60 listings, 30% verified and 250 words", async () => {
    const category = await sectorWithSupply({
      listings: 60,
      verified: 18,
      emirate: "sharjah",
      withIntro: true,
    });

    const state = await emirateCategoryState("sharjah", category.id);
    expect(state?.listings).toBe(60);
    expect(state?.verified).toBe(18);
    expect(state?.clearsFloors, JSON.stringify(state?.failing)).toBe(true);
    // Clearing the floors is permission, not publication. Nobody has said yes.
    expect(state?.live).toBe(false);
  });

  it("goes live only once staff publish it as well", async () => {
    const category = await sectorWithSupply({
      listings: 60,
      verified: 18,
      emirate: "sharjah",
      withIntro: true,
    });

    const published = await publishEmiratePage(
      await opsLead(),
      "sharjah",
      category.id,
      "Supply and copy are both there.",
    );
    expect(published.ok).toBe(true);
    expect((await emirateCategoryState("sharjah", category.id))?.live).toBe(true);

    // And back out again, which is always allowed.
    const pulled = await unpublishEmiratePage(
      await opsLead(),
      "sharjah",
      category.id,
      "Taking it back for a rewrite.",
    );
    expect(pulled.ok).toBe(true);
    expect((await emirateCategoryState("sharjah", category.id))?.live).toBe(false);
  });

  it("refuses to publish a page below the floors, in the service", async () => {
    // The screen disables the button; this is the rule that actually holds,
    // because an API call would come through here too.
    const category = await sectorWithSupply({
      listings: 10,
      verified: 10,
      emirate: "ajman",
      withIntro: true,
    });
    const result = await publishEmiratePage(
      await opsLead(),
      "ajman",
      category.id,
      "Trying it on.",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("below_floors");
      // The refusal says the numbers, not "not eligible".
      expect(result.message).toMatch(/\d+ listings, and it publishes at 60/);
    }
  });

  it("holds a cell back on listings alone", async () => {
    const category = await sectorWithSupply({
      listings: 59,
      verified: 59,
      emirate: "ajman",
      withIntro: true,
    });
    const state = await emirateCategoryState("ajman", category.id);
    expect(state?.clearsFloors).toBe(false);
    expect(state?.failing.map((f) => f.reason)).toContain("listings");
  });

  it("holds a cell back on verified share alone", async () => {
    // Plenty of supply, almost none of it checked. This is the case the floor
    // exists for: a page full of listings nobody has verified is the thin
    // page wearing a bigger number.
    const category = await sectorWithSupply({
      listings: 60,
      verified: 2,
      emirate: "fujairah",
      withIntro: true,
    });
    const state = await emirateCategoryState("fujairah", category.id);
    expect(state?.clearsFloors).toBe(false);
    expect(state?.failing.map((f) => f.reason)).toContain("verified_share");
  });

  it("holds a cell back on intro copy alone", async () => {
    const category = await sectorWithSupply({
      listings: 60,
      verified: 30,
      emirate: "umm_al_quwain",
      withIntro: false,
    });
    const state = await emirateCategoryState("umm_al_quwain", category.id);
    expect(state?.clearsFloors).toBe(false);
    expect(state?.failing.map((f) => f.reason)).toContain("intro_words");
  });
});

describe("criterion 5 — every sector is a matrix row", () => {
  it("renders all twelve, never truncating to five", async () => {
    const [matrix, sectors] = await Promise.all([
      emirateMatrix(),
      prisma.category.count({ where: { parentId: null } }),
    ]);
    expect(matrix).toHaveLength(sectors);
    // A truncated matrix orphans the pages it hides, which is the one thing
    // this page exists not to do.
    expect(matrix.length).toBeGreaterThanOrEqual(12);
  });

  it("gives every row all seven emirates, including the empty ones", async () => {
    for (const row of await emirateMatrix()) {
      expect(row.cells.map((cell) => cell.emirate)).toEqual([...MATRIX_EMIRATES]);
    }
  });

  it("counts a supplier once per emirate however many locations it has", async () => {
    const category = await sectorWithSupply({
      listings: 3,
      verified: 0,
      emirate: "ras_al_khaimah",
      withIntro: false,
    });
    const business = await prisma.business.findFirstOrThrow({
      where: { primaryCategoryId: category.id },
      select: { id: true },
    });
    const areaId = await areaIn("ras_al_khaimah");
    // A second published location in the same emirate. One supplier, still.
    await prisma.location.create({
      data: {
        businessId: business.id,
        type: "warehouse",
        emirate: "ras_al_khaimah" as never,
        areaId,
        addressLine: "Unit 2",
        published: true,
      },
    });

    const row = (await emirateMatrix()).find((candidate) => candidate.id === category.id);
    const cell = row?.cells.find((candidate) => candidate.emirate === "ras_al_khaimah");
    expect(cell?.listings).toBe(3);
  });
});

describe("criterion 4 — the page's links and the sitemap agree", () => {
  it("lists exactly the cells the matrix calls live", async () => {
    const category = await sectorWithSupply({
      listings: 60,
      verified: 20,
      emirate: "sharjah",
      withIntro: true,
    });
    await publishEmiratePage(await opsLead(), "sharjah", category.id, "Ready.");

    const matrix = await emirateMatrix();
    const fromMatrix = matrix
      .flatMap((row) => row.cells.map((cell) => ({ row, cell })))
      .filter(({ cell }) => cell.live)
      .map(({ row, cell }) => emiratePagePath(cell.emirate, row.slug))
      .sort();

    const fromSitemap = (await liveEmiratePages())
      .map((page) => emiratePagePath(page.emirate, page.categorySlug))
      .sort();

    /*
       A set comparison, as criterion 4 asks — not a spot check. The two are
       one function apart on purpose: a link on the page that is not in the
       sitemap is a page we ask nobody to index and point at anyway, and a URL
       in the sitemap with nothing linking to it is an orphan.
    */
    expect(fromSitemap).toEqual(fromMatrix);
    expect(fromMatrix.length).toBeGreaterThan(0);
  });

  it("drops a cell from both the moment its supply falls", async () => {
    const category = await sectorWithSupply({
      listings: 60,
      verified: 20,
      emirate: "sharjah",
      withIntro: true,
    });
    await publishEmiratePage(await opsLead(), "sharjah", category.id, "Ready.");

    const path = emiratePagePath("sharjah", category.slug);
    expect((await liveEmiratePages()).map((p) => emiratePagePath(p.emirate, p.categorySlug)))
      .toContain(path);

    // One supplier suspended, and the cell is under the floor again.
    const doomed = await prisma.business.findFirstOrThrow({
      where: { primaryCategoryId: category.id },
      select: { id: true },
    });
    await prisma.business.update({
      where: { id: doomed.id },
      data: { suspendedAt: new Date() },
    });

    /*
       Criterion 8: reverts to text and leaves the sitemap in the same pass.
       Nothing is cached between the two reads, and note that `publishedAt` is
       untouched — staff intent survives; it is the supply that failed, and it
       is re-checked on every read rather than trusted to a job having run.
    */
    const state = await emirateCategoryState("sharjah", category.id);
    expect(state?.publishedAt).not.toBeNull();
    expect(state?.clearsFloors).toBe(false);
    expect(state?.live).toBe(false);
    expect((await liveEmiratePages()).map((p) => emiratePagePath(p.emirate, p.categorySlug)))
      .not.toContain(path);
  });
});
