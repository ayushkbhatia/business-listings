import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { addRedirect, redirectList, removeRedirect } from "@/lib/content/redirects";
import { homeCandidates, setOnHome } from "@/lib/content/homepage";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Board 12g — redirects and homepage curation.
 *
 * Both are screens over columns that something already reads: `Redirect` by
 * `lib/listing/redirect.ts` and the template-page route, `showOnHome` by
 * `getHomeCategories` since handoff 1.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;

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
});

afterAll(async () => {
  await prisma.redirect.deleteMany({ where: { fromPath: { startsWith: "/redirect-test-" } } });
  await prisma.$disconnect();
});

describe("redirects", () => {
  it("takes a path pair and writes a 301", async () => {
    const result = await addRedirect({
      actor: actor(opsLeadId, "staff_ops_lead"),
      fromPath: "/redirect-test-a",
      toPath: "/redirect-test-b",
      reason: "The old address was printed on a van.",
    });
    expect(result.ok).toBe(true);

    const rows = await redirectList();
    const written = rows.find((row) => row.fromPath === "/redirect-test-a");
    expect(written?.toPath).toBe("/redirect-test-b");
    expect(written?.statusCode).toBe(301);
  }, 60_000);

  it("refuses anything that is not a path", async () => {
    for (const from of ["nope", "https://example.com/x", "/has space", ""]) {
      const result = await addRedirect({
        actor: actor(opsLeadId, "staff_ops_lead"),
        fromPath: from,
        toPath: "/redirect-test-b",
        reason: "Trying a bad path.",
      });
      expect(result, from).toMatchObject({ ok: false, error: "not_a_path" });
    }
  }, 60_000);

  it("refuses a loop and a duplicate", async () => {
    const loop = await addRedirect({
      actor: actor(opsLeadId, "staff_ops_lead"),
      fromPath: "/redirect-test-c",
      toPath: "/redirect-test-c",
      reason: "Trying a loop.",
    });
    expect(loop).toMatchObject({ ok: false, error: "same_path" });

    const duplicate = await addRedirect({
      actor: actor(opsLeadId, "staff_ops_lead"),
      fromPath: "/redirect-test-a",
      toPath: "/redirect-test-z",
      reason: "Trying a duplicate.",
    });
    expect(duplicate).toMatchObject({ ok: false, error: "already_exists" });
  }, 60_000);

  it("refuses a chain, and says where to point it instead", async () => {
    /*
     * A redirect whose destination is itself a redirect makes a visitor take
     * two hops and a crawler discount the second.
     */
    const result = await addRedirect({
      actor: actor(opsLeadId, "staff_ops_lead"),
      fromPath: "/redirect-test-d",
      toPath: "/redirect-test-a",
      reason: "Trying to chain onto an existing redirect.",
    });
    expect(result).toMatchObject({ ok: false, error: "would_chain" });
    if (result.ok) return;
    expect(result.message).toContain("one hop");
  }, 60_000);

  it("keeps the removal in the audit log, because the row will not be there", async () => {
    const created = await addRedirect({
      actor: actor(opsLeadId, "staff_ops_lead"),
      fromPath: "/redirect-test-gone",
      toPath: "/redirect-test-b",
      reason: "A redirect that will be removed.",
    });
    if (!created.ok) throw new Error("fixture failed");

    await removeRedirect(
      actor(opsLeadId, "staff_ops_lead"),
      created.id,
      "The old address was never printed anywhere after all.",
    );

    const row = await prisma.auditEvent.findFirstOrThrow({
      where: { subject: "Redirect:/redirect-test-gone" },
      orderBy: { createdAt: "desc" },
      select: { before: true, after: true },
    });
    const before = row.before as { fromPath: string; toPath: string };
    expect(before.fromPath).toBe("/redirect-test-gone");
    expect(row.after).toBeNull();
  }, 60_000);

  it("refuses a moderator", async () => {
    await expect(
      addRedirect({
        actor: actor(moderatorId, "staff_moderator"),
        fromPath: "/redirect-test-mod",
        toPath: "/redirect-test-b",
        reason: "Not my row.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  }, 60_000);
});

describe("homepage curation", () => {
  it("offers only top-level trades, with whether their own page publishes", async () => {
    const candidates = await homeCandidates();
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(typeof candidate.publishable).toBe("boolean");
    }
  }, 60_000);

  it("refuses a trade whose own landing page does not publish", async () => {
    /*
     * The home page is the most-linked page on the site. A link from it to a
     * thin page is the worst one to have — which is the page matrix from step
     * 7a doing a second job.
     */
    const candidates = await homeCandidates();
    const thin = candidates.find((candidate) => !candidate.publishable);
    if (!thin) return;

    const result = await setOnHome(
      actor(opsLeadId, "staff_ops_lead"),
      thin.id,
      true,
      "Trying to feature a trade with a thin page.",
    );
    expect(result).toMatchObject({ ok: false, error: "not_publishable" });
  }, 60_000);

  it("always allows taking one off, even a thin one", async () => {
    /*
     * Only the way in is gated. A trade that stopped publishing should be
     * removable without first fixing it.
     *
     * Picked from the trades that are both shown and publishable, because the
     * restore at the end goes back in through the gate. The first version of
     * this test took any shown trade, turned it off, and could not turn it back
     * on — which left a trade off the home page for good and broke
     * `home-compare.spec.ts` two suites later.
     */
    const candidates = await homeCandidates();
    const shown = candidates.find((candidate) => candidate.showOnHome && candidate.publishable);
    if (!shown) return;

    const off = await setOnHome(
      actor(opsLeadId, "staff_ops_lead"),
      shown.id,
      false,
      "Rotating this trade off the home page for the quarter.",
    );
    expect(off.ok).toBe(true);

    const back = await setOnHome(
      actor(opsLeadId, "staff_ops_lead"),
      shown.id,
      true,
      "Putting it back after the rotation test.",
    );
    // Asserted, not assumed. A restore that quietly fails is how the seed ends
    // up in a state nothing put it in on purpose.
    expect(back.ok).toBe(true);

    const after = await homeCandidates();
    expect(after.find((candidate) => candidate.id === shown.id)?.showOnHome).toBe(true);
  }, 120_000);

  it("refuses a subcategory", async () => {
    const child = await prisma.category.findFirstOrThrow({
      where: { parentId: { not: null } },
      select: { id: true },
    });
    const result = await setOnHome(
      actor(opsLeadId, "staff_ops_lead"),
      child.id,
      true,
      "Trying to feature a subcategory.",
    );
    expect(result).toMatchObject({ ok: false, error: "not_a_sector" });
  }, 60_000);
});
