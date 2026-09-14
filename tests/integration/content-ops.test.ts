import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { addRedirect, redirectList, removeRedirect } from "@/lib/content/redirects";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Board 12g — redirects.
 *
 * A screen over a table something already reads: `Redirect`, by
 * `lib/listing/redirect.ts` and the template-page route. Homepage curation,
 * which shared this file, is board 6h's and has its own
 * (`homepage-curation.test.ts`).
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;

beforeAll(async () => {
  opsLeadId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      // One of two seeded ops leads, and always the same one: board 6f
      // needs a second for dual control, and `findFirst` has no defined
      // order without this.
      orderBy: { id: "asc" as const },
      select: { id: true },
    })
  ).id;
  moderatorId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_moderator" } },
      orderBy: { id: "asc" },
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
