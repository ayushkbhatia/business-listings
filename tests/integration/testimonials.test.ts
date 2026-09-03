import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";
import {
  deleteTestimonial,
  TESTIMONIAL_MIN_WORDS,
  testimonialRows,
  testimonialWords,
  saveTestimonial,
  setTestimonialPublished,
} from "@/lib/content/testimonials";

/**
 * The quotes on `/for-buyers` and `/list-your-business`.
 *
 * Three rules carry this, and all three are negatives — the kind that pass by
 * accident when nobody asserts them from both sides:
 *
 *   1. A quote with no attribution does not publish.
 *   2. A quote under the word floor does not publish.
 *   3. Only an ops lead writes one, and every write leaves an audit row with
 *      the reason a person typed.
 *
 * So each is asserted twice: the refusal, and the same call succeeding once the
 * thing it complained about is fixed.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;

/** What this file wrote, so it can take it away again. */
const PREFIX = "proof-test-";

function attribution(name: string): string {
  return `${PREFIX}${name}`;
}

/**
 * A body over the floor, built rather than pasted: the floor is a number in
 * the service, and a fixture that met it by literal prose would stop meeting
 * it silently the day that number moves.
 */
function longBody(): string {
  return Array.from({ length: TESTIMONIAL_MIN_WORDS + 4 }, (_, i) => `word${i}`).join(" ");
}

function shortBody(): string {
  return "Great service.";
}

async function removeFixtures() {
  await prisma.testimonial.deleteMany({ where: { attribution: { startsWith: PREFIX } } });
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
  // and a published fixture is on a public page for every later test.
  await removeFixtures();
});

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

const lead = () => actor(opsLeadId, "staff_ops_lead");

describe("the fixtures straddle the floor", () => {
  it("has one body over it and one under, so the floor is what is measured", () => {
    expect(testimonialWords(longBody())).toBeGreaterThanOrEqual(TESTIMONIAL_MIN_WORDS);
    expect(testimonialWords(shortBody())).toBeLessThan(TESTIMONIAL_MIN_WORDS);
  });
});

describe("saving", () => {
  it("writes a quote and an audit row carrying the reason", async () => {
    const result = await saveTestimonial(
      lead(),
      {
        audience: "buyer",
        body: longBody(),
        attribution: attribution("rashid"),
        context: "Procurement Manager, Harbour Contracting LLC",
      },
      "First buyer quote for the entry page.",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const audit = await prisma.auditEvent.findFirst({
      where: { subject: "Testimonial:new" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.reason).toBe("First buyer quote for the entry page.");

    const rows = await testimonialRows();
    const written = rows.find((row) => row.id === result.id);
    expect(written?.attribution).toBe(attribution("rashid"));
    expect(written?.published).toBe(false);
  });

  it("refuses a quote nobody is willing to sign", async () => {
    const result = await saveTestimonial(
      lead(),
      { audience: "buyer", body: longBody(), attribution: "   " },
      "Trying it without a name.",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("no_attribution");
  });

  it("saves a thin draft, because a half-written quote is still worth keeping", async () => {
    const result = await saveTestimonial(
      lead(),
      { audience: "supplier", body: shortBody(), attribution: attribution("draft") },
      "Wording not final.",
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a moderator, and writes nothing", async () => {
    const before = await prisma.testimonial.count();
    await expect(
      saveTestimonial(
        actor(moderatorId, "staff_moderator"),
        { audience: "buyer", body: longBody(), attribution: attribution("nope") },
        "Should not land.",
      ),
    ).rejects.toBeInstanceOf(PermissionError);
    expect(await prisma.testimonial.count()).toBe(before);
  });

  it("refuses a write with no reason", async () => {
    await expect(
      saveTestimonial(
        lead(),
        { audience: "buyer", body: longBody(), attribution: attribution("noreason") },
        "",
      ),
    ).rejects.toThrow();
  });
});

describe("publishing", () => {
  it("refuses a quote under the floor and names the number", async () => {
    const draft = await saveTestimonial(
      lead(),
      { audience: "buyer", body: shortBody(), attribution: attribution("thin") },
      "Draft to test the floor.",
    );
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    const result = await setTestimonialPublished(lead(), draft.id, true, "Trying to publish it thin.");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("too_thin");
    expect(result.have).toBe(testimonialWords(shortBody()));
    expect(result.need).toBe(TESTIMONIAL_MIN_WORDS);
    expect(result.message).toContain(String(TESTIMONIAL_MIN_WORDS));
  });

  it("publishes the same quote once it clears the floor", async () => {
    const draft = await saveTestimonial(
      lead(),
      { audience: "buyer", body: shortBody(), attribution: attribution("fixed") },
      "Draft, wording to follow.",
    );
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    const filled = await saveTestimonial(
      lead(),
      {
        id: draft.id,
        audience: "buyer",
        body: longBody(),
        attribution: attribution("fixed"),
      },
      "Final wording, confirmed with them.",
    );
    expect(filled.ok).toBe(true);

    const result = await setTestimonialPublished(lead(), draft.id, true, "Approved for the buyer page.");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shown).toBeGreaterThan(0);
  });

  it("always allows unpublishing, including a quote that no longer clears the floor", async () => {
    const draft = await saveTestimonial(
      lead(),
      { audience: "supplier", body: longBody(), attribution: attribution("pulled") },
      "Supplier quote.",
    );
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    expect((await setTestimonialPublished(lead(), draft.id, true, "Live.")).ok).toBe(true);

    // Straight at the row: the service refuses to shorten a published quote,
    // which is the guard this test needs to get behind to prove the other one.
    await prisma.testimonial.update({
      where: { id: draft.id },
      data: { body: shortBody() },
    });

    const result = await setTestimonialPublished(lead(), draft.id, false, "Pulling it.");
    expect(result.ok).toBe(true);
  });

  it("refuses to shorten a published quote below the floor", async () => {
    const draft = await saveTestimonial(
      lead(),
      { audience: "buyer", body: longBody(), attribution: attribution("shorten") },
      "Buyer quote.",
    );
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect((await setTestimonialPublished(lead(), draft.id, true, "Live.")).ok).toBe(true);

    const result = await saveTestimonial(
      lead(),
      {
        id: draft.id,
        audience: "buyer",
        body: shortBody(),
        attribution: attribution("shorten"),
      },
      "Trimming it.",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("too_thin");
  });
});

describe("deleting", () => {
  it("removes the row and leaves the audit row behind", async () => {
    const draft = await saveTestimonial(
      lead(),
      { audience: "buyer", body: longBody(), attribution: attribution("gone") },
      "Quote to be removed.",
    );
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    const result = await deleteTestimonial(lead(), draft.id, "They asked us to take it down.");
    expect(result.ok).toBe(true);

    expect(await prisma.testimonial.findUnique({ where: { id: draft.id } })).toBeNull();
    const audit = await prisma.auditEvent.findFirst({
      where: { subject: `Testimonial:${draft.id}` },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.reason).toBe("They asked us to take it down.");
  });

  it("refuses a quote that is not here", async () => {
    const result = await deleteTestimonial(lead(), "does-not-exist", "Nothing to remove.");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("not_found");
  });
});
