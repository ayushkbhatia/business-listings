import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { GUIDE_MIN_WORDS, type GuideBlock } from "@/lib/guides/blocks";
import { guideBySlug, publishedGuides } from "@/lib/guides/queries";
import {
  deleteGuide,
  guideById,
  guideList,
  overdueGuides,
  publishGuide,
  recordRegulatoryCheck,
  saveGuide,
  unpublishGuide,
} from "@/lib/guides/service";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Boards 10b and 6d — guide authoring.
 *
 * Two rules carry the step, and both are negatives, which pass by accident:
 *
 *   1. A published slug does not move.
 *   2. A guide under the word floor does not publish.
 *
 * So each is asserted from both sides — the refusal, and the same call
 * succeeding once the thing it complained about is fixed.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;

/** Fixtures this file made, so it can take them away again. */
const PREFIX = "guide-test-";
let seq = 0;

function slug(name: string) {
  seq += 1;
  return `${PREFIX}${name}-${Date.now().toString(36)}${seq}`;
}

/**
 * A body over the floor, whatever the floor is.
 *
 * Built rather than pasted, and the paragraph count is **derived** from
 * `GUIDE_MIN_WORDS` rather than written down. The previous version looped a
 * literal 30 times against a 250-word floor, with a comment warning that it
 * "silently stops meeting the floor if the number ever changes" — and then
 * board 6d moved the floor to 1,200 and six tests failed on the fixture rather
 * than on the thing they were testing. The comment was right and the code did
 * not act on it.
 *
 * It also carries a link into the directory, because publishing needs one:
 * acceptance 10 refuses a guide that keeps all its earned authority in its own
 * footer.
 */
function longBody(): GuideBlock[] {
  const sentence = "A trade licence check is not a guarantee of price or delivery.";
  const perParagraph = sentence.split(/\s+/).length;
  const paragraphs: GuideBlock[] = [
    {
      id: "link",
      kind: "text",
      values: { body: "Start from the [directory](/categories) if you would rather not." },
    },
  ];
  // One more than the floor needs, so a fixture is never exactly at the edge.
  const wanted = Math.ceil(GUIDE_MIN_WORDS / perParagraph) + 1;
  for (let i = 0; i < wanted; i += 1) {
    paragraphs.push({ id: `p${i}`, kind: "text", values: { body: sentence } });
  }
  return paragraphs;
}

function shortBody(): GuideBlock[] {
  return [{ id: "p0", kind: "text", values: { body: "Three words only." } }];
}

async function removeFixtures() {
  await prisma.guide.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  opsLeadId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      select: { id: true },
    })
  ).id;
  moderatorId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_moderator" } },
      select: { id: true },
    })
  ).id;
  // Before as well as after: a crashed run leaves a published fixture behind,
  // and a published fixture is in `publishedGuides()` for every later test.
  await removeFixtures();
});

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

const lead = () => actor(opsLeadId, "staff_ops_lead");

/**
 * A draft that clears every gate but the one under test.
 *
 * Module scope rather than inside one `describe`: the two-dates suite needs the
 * same fixture, and a second copy of it is a second place for the publish gates
 * to be satisfied differently.
 */
async function draft(name: string, blocks: GuideBlock[]) {
  const address = slug(name);
  const result = await saveGuide({
    actor: lead(),
    slug: address,
    title: "What verification proves",
    summary: "Four rungs and what each one checks against.",
    byline: null,
    ctaCategoryId: null,
    blocks,
    reason: "Drafting.",
  });
  if (!result.ok) throw new Error(`fixture failed: ${result.message}`);
  return { id: result.id, slug: address };
}


describe("the fixture body is over the floor", () => {
  it("has enough words that the floor is what the test is measuring", async () => {
    const { guideWords } = await import("@/lib/guides/blocks");
    expect(guideWords(longBody())).toBeGreaterThanOrEqual(GUIDE_MIN_WORDS);
    expect(guideWords(shortBody())).toBeLessThan(GUIDE_MIN_WORDS);
  });
});

describe("saving", () => {
  it("writes a guide and an audit row with the reason", async () => {
    const address = slug("first");
    const result = await saveGuide({
      actor: lead(),
      slug: address,
      title: "What verification proves",
      summary: "Five rungs and what each one checks against.",
      byline: null,
      ctaCategoryId: null,
      blocks: longBody(),
      reason: "First article in the verification set.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = await guideById(result.id);
    expect(written?.slug).toBe(address);
    expect(written?.words).toBeGreaterThanOrEqual(GUIDE_MIN_WORDS);

    const audit = await prisma.auditEvent.findFirst({
      where: { subject: `Guide:${address}` },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.reason).toBe("First article in the verification set.");
    expect(audit?.actorId).toBe(opsLeadId);
  }, 60_000);

  it("refuses a slug that is not one", async () => {
    for (const bad of ["Not A Slug", "trailing-", "has_underscore", "", "has/slash"]) {
      const result = await saveGuide({
        actor: lead(),
        slug: bad,
        title: "Title here",
        summary: "A summary long enough to pass the length check.",
        byline: null,
        ctaCategoryId: null,
        blocks: [],
        reason: "Trying a bad address.",
      });
      expect(result, bad).toMatchObject({ ok: false, error: "not_a_slug" });
    }
  }, 60_000);

  it("refuses a summary too short to be a meta description", async () => {
    const result = await saveGuide({
      actor: lead(),
      slug: slug("thin-summary"),
      title: "Title here",
      summary: "Too short.",
      byline: null,
      ctaCategoryId: null,
      blocks: [],
      reason: "Trying a short summary.",
    });
    expect(result).toMatchObject({ ok: false, error: "no_summary" });
  }, 60_000);

  it("drops a block kind that is not in the vocabulary", async () => {
    const result = await saveGuide({
      actor: lead(),
      slug: slug("unknown-kind"),
      title: "Title here",
      summary: "A summary long enough to pass the length check.",
      byline: null,
      ctaCategoryId: null,
      blocks: [
        { id: "a", kind: "text", values: { body: "Kept." } },
        { id: "b", kind: "carousel" as never, values: {} },
      ],
      reason: "Checking the vocabulary fence.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const written = await guideById(result.id);
    expect(written?.blocks.map((block) => block.kind)).toEqual(["text"]);
  }, 60_000);

  it("refuses a slug another guide already has", async () => {
    const address = slug("taken");
    const first = await saveGuide({
      actor: lead(),
      slug: address,
      title: "First",
      summary: "A summary long enough to pass the length check.",
      byline: null,
      ctaCategoryId: null,
      blocks: [],
      reason: "The first one.",
    });
    expect(first.ok).toBe(true);

    const second = await saveGuide({
      actor: lead(),
      slug: address,
      title: "Second",
      summary: "A summary long enough to pass the length check.",
      byline: null,
      ctaCategoryId: null,
      blocks: [],
      reason: "The second one.",
    });
    expect(second).toMatchObject({ ok: false, error: "slug_taken" });
  }, 60_000);

  it("refuses a staff member without taxonomy.write", async () => {
    await expect(
      saveGuide({
        actor: actor(moderatorId, "staff_moderator"),
        slug: slug("not-yours"),
        title: "Title here",
        summary: "A summary long enough to pass the length check.",
        byline: null,
        ctaCategoryId: null,
        blocks: [],
        reason: "A moderator trying to write an article.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  }, 60_000);
});

describe("publishing", () => {
  it("refuses below the word floor and says the number", async () => {
    const guide = await draft("thin", shortBody());
    const result = await publishGuide(lead(), guide.id, "Publishing the thin one.");
    expect(result).toMatchObject({ ok: false, error: "too_thin" });
    if (result.ok) return;
    expect(result.need).toBe(GUIDE_MIN_WORDS);
    expect(result.message).toContain(String(GUIDE_MIN_WORDS));
    // Still invisible to the public reads.
    expect(await guideBySlug(guide.slug)).toBeNull();
  }, 60_000);

  it("publishes above the floor and the public reads pick it up", async () => {
    const guide = await draft("thick", longBody());
    const result = await publishGuide(lead(), guide.id, "Checked by the ops lead.");
    expect(result.ok).toBe(true);

    const article = await guideBySlug(guide.slug);
    expect(article?.title).toBe("What verification proves");
    expect((await publishedGuides()).some((card) => card.slug === guide.slug)).toBe(true);
  }, 60_000);

  it("keeps the original date when a published guide is published again", async () => {
    /*
       `lastmod` is meant to say when the content changed. Moving `publishedAt`
       on every save would tell a crawler the article is new each time somebody
       fixes a typo, which is the fastest way to have none of them believed.
    */
    const guide = await draft("republish", longBody());
    const first = await publishGuide(lead(), guide.id, "First publish.");
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const again = await publishGuide(lead(), guide.id, "Fixed a typo.");
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.publishedAt.getTime()).toBe(first.publishedAt.getTime());
  }, 60_000);

  it("freezes the slug once published, and releases it on unpublish", async () => {
    const guide = await draft("frozen", longBody());
    expect((await publishGuide(lead(), guide.id, "Publishing.")).ok).toBe(true);

    const moved = await saveGuide({
      actor: lead(),
      id: guide.id,
      slug: slug("moved"),
      title: "What verification proves",
      summary: "Five rungs and what each one checks against.",
      byline: null,
      ctaCategoryId: null,
      blocks: longBody(),
      reason: "Trying to move a published address.",
    });
    expect(moved).toMatchObject({ ok: false, error: "slug_frozen" });

    // Editing everything else while published is fine — it is the address that
    // is fixed, not the article.
    const edited = await saveGuide({
      actor: lead(),
      id: guide.id,
      slug: guide.slug,
      title: "What supplier verification proves",
      summary: "Five rungs and what each one checks against.",
      byline: "Ops",
      ctaCategoryId: null,
      blocks: longBody(),
      reason: "Sharpening the title.",
    });
    expect(edited.ok).toBe(true);

    expect((await unpublishGuide(lead(), guide.id, "Pulling it back to rewrite.")).ok).toBe(true);
    expect(await guideBySlug(guide.slug)).toBeNull();

    const newAddress = slug("released");
    const afterUnpublish = await saveGuide({
      actor: lead(),
      id: guide.id,
      slug: newAddress,
      title: "What supplier verification proves",
      summary: "Five rungs and what each one checks against.",
      byline: null,
      ctaCategoryId: null,
      blocks: longBody(),
      reason: "Moving it now it is a draft again.",
    });
    expect(afterUnpublish.ok).toBe(true);
    expect((await guideById(guide.id))?.slug).toBe(newAddress);
  }, 60_000);
});

describe("deleting", () => {
  it("refuses while published, and allows it once unpublished", async () => {
    const address = slug("delete-me");
    const created = await saveGuide({
      actor: lead(),
      slug: address,
      title: "Draft to delete",
      summary: "A summary long enough to pass the length check.",
      byline: null,
      ctaCategoryId: null,
      blocks: longBody(),
      reason: "Drafting something to delete.",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect((await publishGuide(lead(), created.id, "Publishing.")).ok).toBe(true);
    expect(await deleteGuide(lead(), created.id, "Removing it.")).toMatchObject({
      ok: false,
      error: "still_published",
    });

    expect((await unpublishGuide(lead(), created.id, "Withdrawing it.")).ok).toBe(true);
    expect((await deleteGuide(lead(), created.id, "Withdrawn and not coming back.")).ok).toBe(true);
    expect(await guideById(created.id)).toBeNull();

    // The row is gone; the audit row is the only record it existed.
    const audit = await prisma.auditEvent.findFirst({
      where: { subject: `Guide:${address}`, reason: "Withdrawn and not coming back." },
    });
    expect(audit).not.toBeNull();
  }, 60_000);
});

describe("the list", () => {
  it("puts drafts before published guides", async () => {
    /*
       Drafts first, because they are the work. A published article is finished
       and the screen is for writing, not for admiring — the same reason every
       queue in the console leads with what is still pending.
    */
    const rows = await guideList();
    const lastDraft = rows.map((row) => row.publishedAt === null).lastIndexOf(true);
    const firstPublished = rows.findIndex((row) => row.publishedAt !== null);
    if (lastDraft !== -1 && firstPublished !== -1) {
      expect(lastDraft).toBeLessThan(firstPublished);
    }
  }, 60_000);
});


/**
 * Board 6d §Evergreen — the two dates, and the difference from a curated list.
 *
 * Acceptance 6: *"`published_at` never changes after publication.
 * `regulatory_checked_at` changes only on an editor re-check — not on rebuild,
 * deploy or copy fix. Tested both directions."*
 */
describe("the two dates", () => {
  it("moves the check date only on a re-check, and never the publication date", async () => {
    const guide = await draft("dates", longBody());
    const published = await publishGuide(lead(), guide.id, "Checked and ready.");
    expect(published.ok, JSON.stringify(published)).toBe(true);

    const after = await prisma.guide.findUniqueOrThrow({
      where: { id: guide.id },
      select: { publishedAt: true, regulatoryCheckedAt: true },
    });
    expect(after.publishedAt).not.toBeNull();

    /*
       A copy fix. It moves `updatedAt`, which is what that column is for, and
       it must not move either of the dates the article publishes — a crawler
       told the content changed with nothing to show for it discounts the next
       signal, on a page whose subject is trustworthiness.
    */
    await saveGuide({
      actor: lead(),
      id: guide.id,
      slug: guide.slug,
      title: "A typo fixed",
      summary: "The same article with one word corrected, which is not a re-check.",
      byline: null,
      ctaCategoryId: null,
      blocks: longBody(),
      reason: "Fixing a typo.",
    });

    const afterEdit = await prisma.guide.findUniqueOrThrow({
      where: { id: guide.id },
      select: { publishedAt: true, regulatoryCheckedAt: true },
    });
    expect(afterEdit.publishedAt?.getTime()).toBe(after.publishedAt?.getTime());
    expect(afterEdit.regulatoryCheckedAt?.getTime()).toBe(after.regulatoryCheckedAt?.getTime());

    // And a re-check moves one of them, and only one.
    const checkedAt = new Date(Date.UTC(2027, 0, 15));
    const recheck = await recordRegulatoryCheck(lead(), guide.id, "Read the DED page again.", checkedAt);
    expect(recheck.ok).toBe(true);

    const afterCheck = await prisma.guide.findUniqueOrThrow({
      where: { id: guide.id },
      select: { publishedAt: true, regulatoryCheckedAt: true },
    });
    expect(afterCheck.regulatoryCheckedAt?.getTime()).toBe(checkedAt.getTime());
    expect(afterCheck.publishedAt?.getTime()).toBe(after.publishedAt?.getTime());
  }, 120_000);

  it("queues an article past its cadence, and leaves it published", async () => {
    const guide = await draft("overdue", longBody());
    const published = await publishGuide(lead(), guide.id, "Published.");
    expect(published.ok, JSON.stringify(published)).toBe(true);
    await prisma.guide.update({
      where: { id: guide.id },
      data: {
        reviewCadenceMonths: 6,
        regulatoryCheckedAt: new Date(Date.UTC(2020, 0, 1)),
      },
    });

    const overdue = await overdueGuides();
    expect(overdue.some((row) => row.id === guide.id)).toBe(true);

    /*
       The deliberate difference from board 6b: a stale curated list
       misrepresents named sellers and comes down; a stale guide is merely old
       and stays up. Overdue is a queue, not a takedown.
    */
    expect(
      (await prisma.guide.findUniqueOrThrow({
        where: { id: guide.id },
        select: { publishedAt: true },
      })).publishedAt,
    ).not.toBeNull();
  }, 120_000);

  it("does not queue an article that makes no claim about the world", async () => {
    // No cadence: a guide about how to write a good RFQ names no authority and
    // no tax rate, so there is nothing to go out of date.
    const guide = await draft("evergreen", longBody());
    expect((await publishGuide(lead(), guide.id, "Published.")).ok).toBe(true);
    await prisma.guide.update({
      where: { id: guide.id },
      data: { reviewCadenceMonths: null, regulatoryCheckedAt: new Date(Date.UTC(2019, 0, 1)) },
    });
    expect((await overdueGuides()).some((row) => row.id === guide.id)).toBe(false);
  }, 120_000);
});
