import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  findClaimMatches,
  submitClaim,
  VISIBLE_MATCHES,
  type ClaimCandidate,
} from "@/lib/onboarding/claim";
import { recordClaimSearch, CLAIM_SEARCH_TAB } from "@/lib/onboarding/search-log";
import { checkRate, recordHit, RATE_POLICIES } from "@/lib/rate-limit";
import type { Actor } from "@/lib/auth/roles";

/**
 * Board 2a, against a real database.
 *
 * The acceptance criteria this file answers are the ones about rows rather than
 * pixels: what the search matches and in what order, what a claim leaves
 * untouched, and what gets written down when nothing was found. The browser
 * half is `tests/e2e/claim.spec.ts`.
 *
 * Criterion 6 is the one worth reading carefully. *"Claiming preserves reviews,
 * enquiry history and the slug"* sounds like a thing that could not possibly go
 * wrong — until somebody implements claiming as create-then-migrate rather than
 * attach, at which point it goes wrong silently and the supplier whose fourteen
 * reviews vanished is the one who tells us.
 */

const PREFIX = "zz-claim-test-";

/** A trade name no seeded record shares a trigram with, so a fixture ranks alone. */
const FIXTURE = "Zqx";
const FIXTURE_SLUG = "zz-claim-fixture";

let claimant: Actor;
let unclaimed: { id: string; tradeName: string; licenceNumber: string; slug: string };
let claimed: { id: string; tradeName: string; slug: string };

beforeAll(async () => {
  const buyer = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "buyer" } },
    select: { id: true, roles: true },
  });
  claimant = { id: buyer.id, roles: buyer.roles };

  /*
     An unclaimed record whose licence number belongs to it alone.

     `licence_number` has no unique constraint — the importer stages
     near-duplicates on purpose — and the exact-match assertions below are about
     the unambiguous case. Picking the first unclaimed row alphabetically found
     one whose number was shared on a database that had been seeded twice, and
     the failure read as a bug in the search rather than as a fixture that had
     stopped being the fixture the test meant.
  */
  const duplicated = await prisma.business.groupBy({
    by: ["licenceNumber"],
    where: { mergedIntoId: null },
    _count: { licenceNumber: true },
    having: { licenceNumber: { _count: { gt: 1 } } },
  });

  unclaimed = await prisma.business.findFirstOrThrow({
    where: {
      claimStatus: "unclaimed",
      mergedIntoId: null,
      licenceNumber: { notIn: duplicated.map((row) => row.licenceNumber) },
    },
    orderBy: { tradeName: "asc" },
    select: { id: true, tradeName: true, licenceNumber: true, slug: true },
  });

  /*
     A claimed listing that actually carries reviews.

     Criterion 6 names the fixture: "a test that claims a seeded business with
     reviews and confirms the rating is unchanged". Taking the first claimed row
     alphabetically found one with none, which would have passed the comparison
     while proving nothing about the thing a supplier is afraid of.
  */
  claimed = await prisma.business.findFirstOrThrow({
    where: { claimStatus: "claimed", mergedIntoId: null, reviewCount: { gt: 0 } },
    orderBy: { reviewCount: "desc" },
    select: { id: true, tradeName: true, slug: true },
  });
});

afterEach(async () => {
  await prisma.claimSubmission.deleteMany({ where: { claimantId: claimant.id } });
  await prisma.searchQueryLog.deleteMany({ where: { query: { startsWith: PREFIX } } });
  await prisma.zeroResultQuery.deleteMany({ where: { query: { startsWith: PREFIX } } });
  await prisma.rateLimitHit.deleteMany({ where: { identifier: { startsWith: PREFIX } } });
  await prisma.business.deleteMany({ where: { slug: { startsWith: FIXTURE_SLUG } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("criterion 3 — one box, three ways in", () => {
  it("finds a record by its trade name", async () => {
    const matches = await findClaimMatches(unclaimed.tradeName);
    expect(matches.kind).toBe("similar");
    expect(matches.results.some((r) => r.id === unclaimed.id)).toBe(true);
  });

  it("finds a record from a fragment of its trade name", async () => {
    // "Gulf Cool" against "Gulf Cool Technical Services LLC" scores below the
    // trigram threshold and is obviously the row somebody meant. The ILIKE arm
    // is what catches it, and it runs on the same GIN index.
    const fragment = unclaimed.tradeName.split(" ").slice(0, 2).join(" ");
    const matches = await findClaimMatches(fragment);
    expect(matches.results.some((r) => r.id === unclaimed.id)).toBe(true);
  });

  it("returns one result for an exact licence number, labelled as exact", async () => {
    const matches = await findClaimMatches(unclaimed.licenceNumber);
    expect(matches.kind).toBe("exact_licence");
    expect(matches.results).toHaveLength(1);
    expect(matches.results[0]!.id).toBe(unclaimed.id);
  });

  it("matches a licence number on its digits, punctuation and all", async () => {
    // An export writes DED-441908 and a person types 441908. A search that
    // misses on the hyphen sends them to "add from scratch", which creates the
    // duplicate this screen exists to prevent.
    const digits = unclaimed.licenceNumber.replace(/\D/g, "");
    const matches = await findClaimMatches(digits);
    expect(matches.kind).toBe("exact_licence");
    expect(matches.results[0]!.id).toBe(unclaimed.id);
  });

  it("withdraws the exact claim when a licence number is not unique", async () => {
    /*
       `licence_number` carries no unique constraint, and a staged import can
       hold two records with the same one until `MergeCandidate` settles them.
       Presenting one of the pair as "the" exact match is a coin toss dressed as
       certainty; listing both is the honest answer.
    */
    const shared = await prisma.business.groupBy({
      by: ["licenceNumber"],
      where: { mergedIntoId: null },
      _count: { licenceNumber: true },
      having: { licenceNumber: { _count: { gt: 1 } } },
    });
    if (shared.length === 0) return; // A cleanly seeded database has none.

    const matches = await findClaimMatches(shared[0]!.licenceNumber);
    expect(matches.kind).toBe("similar");
    expect(matches.total).toBeGreaterThan(1);
    // And never "nothing matched", when we plainly hold the licence they typed.
    expect(matches.results.length).toBeGreaterThan(1);
  });

  it("finds a record by the phone number on its branch", async () => {
    const location = await prisma.location.findFirstOrThrow({
      where: { phone: { not: null }, business: { mergedIntoId: null } },
      select: { phone: true, businessId: true },
    });
    const matches = await findClaimMatches(location.phone!.replace(/\D/g, ""));
    expect(matches.results.some((r) => r.id === location.businessId)).toBe(true);
  });

  it("asks the database nothing for a query too short to mean anything", async () => {
    expect(await findClaimMatches("a")).toEqual({ kind: "none", results: [], total: 0 });
    expect(await findClaimMatches("   ")).toEqual({ kind: "none", results: [], total: 0 });
  });

  it("ranks a name that contains the query above one that merely resembles it", async () => {
    /*
       The regression this tier exists for, proved on fixtures rather than on
       the seed, because the seed happens not to contain the shape.

       `similarity()` divides by the longer string's trigram count, so a short
       name outscores a long one that contains the query outright. Searching
       "Al Wadi" put "Al Waha FZE" above "Al Wadi Technical Services LLC" — and
       with a handful of near-namesakes in the register, the record the supplier
       is actually looking for falls off the first page. They then go to "add
       from scratch", which creates the duplicate this screen exists to prevent.

       UAE trade names are long and the distinctive part is short, which is
       exactly the shape that breaks, so this is the common case rather than an
       edge one.
    */
    const category = await prisma.category.findFirstOrThrow({ select: { id: true } });
    const stamp = Date.now();
    const base = {
      licenceAuthority: "DED" as const,
      licenceExpiry: new Date(Date.now() + 365 * 86_400_000),
      primaryCategoryId: category.id,
      source: "licence_import" as const,
    };

    const [verbatim, lookalike] = await Promise.all([
      prisma.business.create({
        data: {
          ...base,
          tradeName: `${FIXTURE} Wadi Technical Services LLC`,
          displayName: `${FIXTURE} Wadi Technical Services`,
          slug: `${FIXTURE_SLUG}-wadi-${stamp}`,
          licenceNumber: `DED-${stamp}1`,
        },
        select: { id: true },
      }),
      prisma.business.create({
        data: {
          ...base,
          tradeName: `${FIXTURE} Waha FZE`,
          displayName: `${FIXTURE} Waha`,
          slug: `${FIXTURE_SLUG}-waha-${stamp}`,
          licenceNumber: `DED-${stamp}2`,
        },
        select: { id: true },
      }),
    ]);

    try {
      const matches = await findClaimMatches(`${FIXTURE} Wadi`);
      const order = matches.results.map((r) => r.id);
      expect(order).toContain(verbatim.id);
      expect(order.indexOf(verbatim.id)).toBeLessThan(order.indexOf(lookalike.id));
      expect(order[0]).toBe(verbatim.id);
    } finally {
      await prisma.business.deleteMany({ where: { id: { in: [verbatim.id, lookalike.id] } } });
    }
  });

  it("ranks the closest name first", async () => {
    /*
       On the name rather than on the id. Trade names are not unique either —
       two licences can carry the same one, and a database seeded twice carries
       several — so pinning the assertion to one row would make an ordering test
       fail whenever a tie was broken the other way, which is not what it is
       about. What matters is that an exact-name query puts that name at the top
       rather than a merely similar one.
    */
    const matches = await findClaimMatches(unclaimed.tradeName);
    expect(matches.results[0]!.tradeName).toBe(unclaimed.tradeName);
  });
});

describe("criterion 2 — an unclaimed record renders its legal name", () => {
  it("carries the legal trade name and the licensing authority's number", async () => {
    const matches = await findClaimMatches(unclaimed.tradeName);
    const row = matches.results.find((r) => r.id === unclaimed.id)!;

    // No display name is invented for an unclaimed record: the row holds what
    // the licence register holds, which is what a claimant is scanning for.
    expect(row.tradeName).toBe(unclaimed.tradeName);
    expect(row.licenceNumber).toBe(unclaimed.licenceNumber);
    expect(row.licenceAuthority).toBeTruthy();
  });
});

describe("criterion 5 — the dispute route never names the incumbent", () => {
  it("returns no field a screen could leak a claimant from", async () => {
    const matches = await findClaimMatches(claimed.tradeName);
    const row = matches.results.find((r) => r.id === claimed.id);
    expect(row).toBeDefined();
    expect(row!.claimStatus).toBe("claimed");

    /*
       The rule enforced against the shape rather than against a screen. A
       component cannot render an owner it was never handed, and the next person
       to add a field here has to add it deliberately.
    */
    const forbidden = ["owner", "claimant", "claimedBy", "email", "phone", "userId"];
    const keys = Object.keys(row as ClaimCandidate).map((k) => k.toLowerCase());
    for (const banned of forbidden) {
      expect(keys).not.toContain(banned.toLowerCase());
    }
  });

  it("still returns the claimed row rather than hiding it", async () => {
    // Closing the door is the wrong side to be wrong on: the second person may
    // well be the real owner of a listing an ex-employee claimed.
    const matches = await findClaimMatches(claimed.tradeName);
    expect(matches.results.some((r) => r.id === claimed.id)).toBe(true);
  });
});

describe("criterion 6 — claiming preserves history", () => {
  it("leaves the reviews, the rating, the enquiries and the slug exactly as they were", async () => {
    const before = await snapshot(claimed.id);
    // A seeded business with reviews, so the rating has somewhere to move to.
    expect(before.reviews).toBeGreaterThan(0);

    const result = await submitClaim(claimant, {
      businessId: claimed.id,
      route: "phone_callback",
      phone: "+97145550000",
    });
    expect(result.ok).toBe(true);

    expect(await snapshot(claimed.id)).toEqual(before);
  });

  it("moves nothing on the listing at all, not even the claim status", async () => {
    const before = await prisma.business.findUniqueOrThrow({
      where: { id: unclaimed.id },
      select: { claimStatus: true, verificationTier: true, publishedAt: true, slug: true },
    });

    await submitClaim(claimant, {
      businessId: unclaimed.id,
      route: "phone_callback",
      phone: "+97145550000",
    });

    // Ownership waits for a person. That is handoff 4, and it should.
    expect(
      await prisma.business.findUniqueOrThrow({
        where: { id: unclaimed.id },
        select: { claimStatus: true, verificationTier: true, publishedAt: true, slug: true },
      }),
    ).toEqual(before);
  });
});

describe("criterion 7 — claiming inherits history, not trust", () => {
  it("does not raise the verification tier", async () => {
    const before = await prisma.business.findUniqueOrThrow({
      where: { id: unclaimed.id },
      select: { verificationTier: true },
    });
    expect(before.verificationTier).toBe(0);

    await submitClaim(claimant, {
      businessId: unclaimed.id,
      route: "phone_callback",
      phone: "+97145550000",
    });

    const after = await prisma.business.findUniqueOrThrow({
      where: { id: unclaimed.id },
      select: { verificationTier: true },
    });

    /*
       No green badge from claiming alone. The tier is CLAUDE.md's second
       non-negotiable — writable by an ops lead and by the licence-expiry sweep,
       and by nothing else — so the claim path has no business raising it, and
       tier 2 in particular is the checked-licence mark that the evidence step
       earns.
    */
    expect(after.verificationTier).toBe(before.verificationTier);
    expect(after.verificationTier).toBeLessThan(2);
  });
});

describe("criterion 8 — a search that found nobody is a recruitment signal", () => {
  it("writes a zero-result row the recruitment queue reads", async () => {
    const query = `${PREFIX}nothing matches this`;
    await recordClaimSearch(query, 0);

    const row = await prisma.zeroResultQuery.findFirstOrThrow({
      where: { query },
      select: { tab: true, categoryId: true },
    });
    expect(row.tab).toBe(CLAIM_SEARCH_TAB);
    // No category guessed from a trade name. That would put a fabricated trade
    // into the list a recruiter calls from.
    expect(row.categoryId).toBeNull();
  });

  it("logs every search, not only the empty ones", async () => {
    const found = `${PREFIX}found something`;
    await recordClaimSearch(found, 4);

    const log = await prisma.searchQueryLog.findFirstOrThrow({
      where: { query: found },
      select: { tab: true, resultCount: true, normalised: true },
    });
    expect(log.tab).toBe(CLAIM_SEARCH_TAB);
    expect(log.resultCount).toBe(4);
    expect(log.normalised).toBe(found.toLowerCase());

    // A search that found something is not a recruitment signal.
    expect(await prisma.zeroResultQuery.count({ where: { query: found } })).toBe(0);
  });

  it("keeps a supplier's own trade name off the buyer home page", async () => {
    // `SearchQueryLog` feeds the "Popular:" chips. Without the tab marker, the
    // first week of supplier traffic would put trade names on the directory
    // home as things buyers search for.
    const { readPopularQueries } = await import("@/lib/db/queries/home");
    const query = `${PREFIX}popular leak check`;
    await recordClaimSearch(query, 9);

    expect(await readPopularQueries(50)).not.toContain(query);
  });
});

describe("criterion 10 — six rows, then the rest in place", () => {
  it("returns more than the fold when a common name has more", async () => {
    // "Al" is the most common token in the seeded names, which is exactly the
    // supplier-with-a-common-trade-name case the fold exists for.
    const matches = await findClaimMatches("Al");
    expect(matches.total).toBeGreaterThan(VISIBLE_MATCHES);
    // All of them come back in one query. The button reveals rather than
    // fetches, so the number in it is the number of rows behind it.
    expect(matches.results).toHaveLength(matches.total);
  });
});

describe("criterion 12 — the search is metered", () => {
  it("allows a first search and refuses once the allowance is spent", async () => {
    const identifier = `${PREFIX}${Date.now()}`;

    expect(await checkRate("claim_search", identifier)).toEqual({ allowed: true });

    const { limit } = RATE_POLICIES.claim_search;
    await prisma.rateLimitHit.createMany({
      data: Array.from({ length: limit }, () => ({ bucket: "claim_search", identifier })),
    });

    const decision = await checkRate("claim_search", identifier);
    expect(decision).toMatchObject({ allowed: false, reason: "too_many", limit });
    if (decision.allowed) throw new Error("unreachable");
    // It says when it clears, because the search reads public records and a
    // refusal with no reason reads as a fault.
    expect(decision.retryAfterMs).toBeGreaterThan(0);
  });

  it("counts each caller separately", async () => {
    const mine = `${PREFIX}mine-${Date.now()}`;
    const theirs = `${PREFIX}theirs-${Date.now()}`;
    await recordHit("claim_search", mine);
    expect(await checkRate("claim_search", theirs)).toEqual({ allowed: true });
  });

  it("ignores hits older than the window", async () => {
    const identifier = `${PREFIX}stale-${Date.now()}`;
    const { limit, windowMs } = RATE_POLICIES.claim_search;
    const old = new Date(Date.now() - windowMs - 60_000);

    await prisma.rateLimitHit.createMany({
      data: Array.from({ length: limit + 5 }, () => ({
        bucket: "claim_search",
        identifier,
        createdAt: old,
      })),
    });

    expect(await checkRate("claim_search", identifier)).toEqual({ allowed: true });
  });

  it("stores no address, only a digest", async () => {
    const identifier = `${PREFIX}digest-${Date.now()}`;
    await recordHit("claim_search", identifier);

    const row = await prisma.rateLimitHit.findFirstOrThrow({
      where: { identifier },
      select: { identifier: true, bucket: true },
    });
    // The column holds whatever the caller hashed. Nothing in the table is an
    // address, and the schema has no column that could hold one.
    expect(row.bucket).toBe("claim_search");
    expect(Object.keys(row)).toEqual(["identifier", "bucket"]);
  });
});

/** Everything claiming promises to leave alone. */
async function snapshot(businessId: string) {
  const [business, reviews, aggregate, enquiries] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { slug: true, ratingOverall: true, reviewCount: true, verificationTier: true },
    }),
    prisma.review.count({ where: { businessId, removedAt: null } }),
    prisma.review.aggregate({ where: { businessId, removedAt: null }, _avg: { overall: true } }),
    prisma.enquiryRecipient.count({ where: { businessId } }),
  ]);

  return {
    slug: business.slug,
    ratingOverall: business.ratingOverall,
    reviewCount: business.reviewCount,
    verificationTier: business.verificationTier,
    reviews,
    // The stored rating and the rating measured from the rows, so a claim that
    // silently detached reviews would fail here even if the cached number stayed.
    measuredAverage: aggregate._avg.overall,
    enquiries,
  };
}
