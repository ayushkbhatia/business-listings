import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { recordContactReveal } from "@/lib/audit/contact-reveal";

/**
 * A reveal is only worth masking a number for if it is written down.
 *
 * `lib/audit/contact-reveal.ts` says why in its own header: "when a seller asks
 * what the subscription bought, the answer is a count of reveals and enquiries,
 * and that answer only exists if the reveal was written down."
 *
 * `recordContactReveal` no-ops when no writer is registered — deliberately, so a
 * counter that is down never costs a buyer the number they asked for. The cost
 * of that design is that forgetting to register one fails silently, and both
 * public reveal actions had forgotten: `app/(public)/_results/reveal-actions.ts`
 * and `app/(public)/b/[slug]/actions.ts` imported neither the writer nor
 * anything that pulls it in, so a server action ran with `writer === null` and
 * every reveal on the site was discarded without a trace.
 *
 * These import the action modules the way the app does and assert a row lands.
 * A unit test with an injected writer would have passed throughout.
 */

const PREFIX = "REVEAL-FIXTURE";

let businessId: string;

beforeAll(async () => {
  businessId = (
    await prisma.business.findFirstOrThrow({
      where: { claimStatus: "claimed" },
      orderBy: { slug: "asc" },
      select: { id: true },
    })
  ).id;
});

afterEach(async () => {
  await prisma.contactReveal.deleteMany({ where: { businessId, actorId: null } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the writer both public actions depend on", () => {
  it("is registered by importing the results action, and a reveal lands", async () => {
    /*
       The import is the test. Loading the module the way the app loads it is
       what registers the writer, and nothing else in this file does — so if the
       side-effect import is ever dropped from that file, the write below finds
       no writer and silently does nothing.
    */
    await import("@/app/(public)/_results/reveal-actions");

    await recordContactReveal({
      actor: null,
      businessId,
      channel: "whatsapp",
      surface: "search_results",
    });

    const rows = await prisma.contactReveal.findMany({
      where: { businessId, actorId: null, surface: "search_results", channel: "whatsapp" },
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("writes a storefront reveal too", async () => {
    /*
       Not an independent guard on that file's own import, and it cannot be:
       the writer is a module-level global, so the import in the case above has
       already registered one by the time this runs. What this pins is the other
       half — that a storefront reveal reaches the table with the right surface
       and channel. If `b/[slug]/actions.ts` loses its side-effect import, the
       case above still passes and this one still passes, and only the browser
       shows it. Ordering-independent coverage would need a worker per file.
    */
    await import("@/app/(public)/b/[slug]/actions");

    await recordContactReveal({
      actor: null,
      businessId,
      channel: "phone",
      surface: "storefront",
    });

    expect(
      await prisma.contactReveal.count({
        where: { businessId, actorId: null, surface: "storefront", channel: "phone" },
      }),
    ).toBeGreaterThan(0);
  });

  it("writes only closed-set surfaces from here on", async () => {
    /*
       Scoped to what this file just wrote, not to the whole table.

       The first version swept every row and failed on
       `/b/al-marwan-industrial-supplies-llc` — a row written by the end-to-end
       suite before this fix existed. That is not a defect it can do anything
       about: `RevealSurface` governs new writes, and no type change rewrites
       history. Any database that ever ran the old code holds paths for ever,
       production included, so a whole-table audit is a test that fails on the
       real world rather than on a regression.

       The column was typed `String` with a doc comment naming two examples, and
       both call sites had drifted into paths — the same defect
       `lib/telemetry/events.ts` cites as the reason its own event names are a
       closed set. A path is now a type error at every call site; this pins that
       the rows actually landing are the union's members.
    */
    await import("@/app/(public)/_results/reveal-actions");
    for (const surface of ["storefront", "search_results", "category"] as const) {
      await recordContactReveal({ actor: null, businessId, channel: "phone", surface });
    }

    const written = await prisma.contactReveal.findMany({
      where: { businessId, actorId: null },
      select: { surface: true },
    });
    expect(written.length).toBeGreaterThan(0);
    for (const { surface } of written) {
      expect(surface, `${surface} looks like a path`).not.toMatch(/^\//);
      expect(["storefront", "search_results", "category"]).toContain(surface);
    }
  });
});
