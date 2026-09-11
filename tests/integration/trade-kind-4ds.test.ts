import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { AuditReasonError } from "@/lib/auth/errors";
import type { Actor } from "@/lib/auth/roles";
import {
  loadTradeKindBoard,
  loadTradeKinds,
  setTradeKindBulk,
  tradeKindBulkImpact,
} from "@/lib/taxonomy/service";
import { resolveTradeKind } from "@/lib/taxonomy/trade-kind";

/**
 * Board `4d-s` — the ops half of the fork, against a database.
 *
 * `lib/taxonomy/trade-kind.test.ts` proves the inheritance rule against
 * hand-written rows. This file exists for the half only a database can answer:
 * whether the column round-trips, whether the impact count matches what the
 * write actually does, and whether the change is audited with a reason — which
 * is a non-negotiable for every staff mutation and the easiest one to leave off
 * a new screen.
 */

const PREFIX = "trade-kind-test-";

let sector: string;
let goodsChild: string;
let serviceChild: string;
let grandchild: string;
let actor: Actor;

async function removeFixtures() {
  await prisma.auditEvent.deleteMany({ where: { subject: { startsWith: "Category:" }, reason: { startsWith: PREFIX } } });
  // Children first: `parentId` is `onDelete: Restrict`.
  await prisma.category.deleteMany({ where: { slug: { startsWith: `${PREFIX}g` } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await removeFixtures();

  const root = await prisma.category.create({
    data: { slug: `${PREFIX}sector`, code: "TK", name: "Trade kind test — sector" },
  });
  sector = root.id;

  const [a, b] = await Promise.all([
    prisma.category.create({
      data: { slug: `${PREFIX}child-goods`, code: "TK", name: "— goods child", parentId: sector },
    }),
    prisma.category.create({
      data: { slug: `${PREFIX}child-svc`, code: "TK", name: "— service child", parentId: sector },
    }),
  ]);
  goodsChild = a.id;
  serviceChild = b.id;

  const deep = await prisma.category.create({
    data: { slug: `${PREFIX}grandchild`, code: "TK", name: "— grandchild", parentId: goodsChild },
  });
  grandchild = deep.id;

  /*
     `taxonomy.write` is OPS_LEAD_ONLY — the narrowest grant in the table,
     because a taxonomy change breaks cross-seller comparison. The actor is
     built here rather than read from a seat so the test states the role it
     needs instead of depending on which seats the seed happens to create.
  */
  const staff = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "staff_ops_lead" } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  actor = { id: staff.id, roles: ["staff_ops_lead"] };
});

afterAll(removeFixtures);

describe("setting how a trade is sold", () => {
  it("refuses without a written reason, like every other staff change", async () => {
    // CLAUDE.md non-negotiable 3. The reason is NOT NULL because the log
    // records decisions, and this decision changes what forty screens render.
    await expect(
      setTradeKindBulk({ actor, categoryIds: [sector], tradeKind: "services", reason: "" }),
    ).rejects.toBeInstanceOf(AuditReasonError);
  });

  it("writes the column and an audit row carrying both sides of the change", async () => {
    const result = await setTradeKindBulk({
      actor,
      categoryIds: [sector],
      tradeKind: "services",
      reason: `${PREFIX}the whole sector is sold by the job`,
    });
    expect(result.ok).toBe(true);

    const row = await prisma.category.findUniqueOrThrow({
      where: { id: sector },
      select: { tradeKind: true },
    });
    expect(row.tradeKind).toBe("services");

    const audit = await prisma.auditEvent.findFirst({
      where: { subject: `Category:${sector}` },
      orderBy: { createdAt: "desc" },
      select: { reason: true, before: true, after: true },
    });
    expect(audit?.reason).toContain("sold by the job");
    // Before and after, so the log answers "what was it" and not only "it changed".
    expect(audit?.before).toMatchObject({ tradeKind: null });
    expect(audit?.after).toMatchObject({ tradeKind: "services" });
  });

  it("carries the sector's answer down to children that have none", async () => {
    const rows = await loadTradeKinds();
    expect(resolveTradeKind(rows, serviceChild)).toBe("services");
    expect(resolveTradeKind(rows, grandchild)).toBe("services");
  });

  it("lets a child disagree, and passes the disagreement to its own children", async () => {
    /*
       The finding the column exists to record: Logistics holds customs
       clearance beside material handling equipment, so a sector-level flag
       would be wrong on one of them whichever way it was set.
    */
    await setTradeKindBulk({
      actor,
      categoryIds: [goodsChild],
      tradeKind: "goods",
      reason: `${PREFIX}this one is a product`,
    });

    const rows = await loadTradeKinds();
    expect(resolveTradeKind(rows, goodsChild)).toBe("goods");
    expect(resolveTradeKind(rows, grandchild)).toBe("goods");
    expect(resolveTradeKind(rows, serviceChild)).toBe("services");
  });

  it("clears an override so the row follows its sector again", async () => {
    // `null` is a choice, not an absence — which is why the panel offers three
    // options and the service takes `TradeKind | null` rather than an optional.
    const result = await setTradeKindBulk({
      actor,
      categoryIds: [goodsChild],
      tradeKind: null,
      reason: `${PREFIX}wrong call, put it back`,
    });
    expect(result.ok).toBe(true);

    const rows = await loadTradeKinds();
    expect(rows.get(goodsChild)?.tradeKind).toBeNull();
    expect(resolveTradeKind(rows, goodsChild)).toBe("services");
  });

  it("refuses a write that would change nothing", async () => {
    const again = await setTradeKindBulk({
      actor,
      categoryIds: [sector],
      tradeKind: "services",
      reason: `${PREFIX}again`,
    });
    expect(again.ok).toBe(false);
  });
});

describe("the count shown before the button", () => {
  it("counts what moves, and separately what will not follow", async () => {
    /*
       The promise `RenamePanel` makes about addresses, kept here about trades.
       `sector` is services and `serviceChild` overrides to goods, so switching
       the sector to goods moves the two rows that follow it and leaves the
       override alone — and the panel says both numbers rather than implying a
       sector write is total.
    */
    await setTradeKindBulk({
      actor,
      categoryIds: [serviceChild],
      tradeKind: "goods",
      reason: `${PREFIX}an override to be counted`,
    });

    const impact = await tradeKindBulkImpact([sector], "goods");
    // The sector itself, plus the two rows that inherit from it — and the
    // override, which does not follow and is counted separately so a sector
    // write is never assumed total.
    expect(impact.rows).toBe(1);
    expect(impact.alsoInheriting).toBe(2);
  });

  it("is zero for a category the taxonomy does not hold", async () => {
    expect(await tradeKindBulkImpact(["not-a-category"], "services")).toEqual({
      rows: 0,
      alsoInheriting: 0,
      listings: 0,
    });
  });
});

describe("the bulk bar", () => {
  it("writes every selected row in one transaction, and audits each one", async () => {
    /*
       B4: "Bulk set is one transaction, and a partial failure rolls back
       entirely. Seven rows half-set is worse than none."

       One audit row per category rather than one for the batch, because the log
       is read per subject — "why does this trade render a scope list" is a
       question about one row, and an answer that exists only as "part of a bulk
       of seven" cannot be found from the row.
    */
    const result = await setTradeKindBulk({
      actor,
      categoryIds: [goodsChild, serviceChild],
      tradeKind: "services",
      reason: `${PREFIX}both of these are sold by the job`,
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.changed).toBe(2);

    const rows = await loadTradeKinds(prisma);
    expect(rows.get(goodsChild)?.tradeKind).toBe("services");
    expect(rows.get(serviceChild)?.tradeKind).toBe("services");

    for (const id of [goodsChild, serviceChild]) {
      const audit = await prisma.auditEvent.findFirst({
        where: { subject: `Category:${id}`, reason: { contains: "both of these" } },
        select: { after: true },
      });
      expect(audit?.after, `every row in a bulk gets its own audit row`).toMatchObject({
        tradeKind: "services",
      });
    }
  });

  it("rolls the whole batch back when one row is not in the taxonomy", async () => {
    const before = await loadTradeKinds(prisma);
    const result = await setTradeKindBulk({
      actor,
      categoryIds: [sector, "not-a-category"],
      tradeKind: "goods",
      reason: `${PREFIX}one of these does not exist`,
    });
    expect(result.ok).toBe(false);

    // Nothing moved. A stale id in a selection must not half-apply the rest.
    const after = await loadTradeKinds(prisma);
    expect(after.get(sector)?.tradeKind).toBe(before.get(sector)?.tradeKind);
  });

  it("skips rows that already hold the value rather than refusing the batch", async () => {
    // A mixed selection is the normal case — the design's own state table has
    // "selection includes both set and unset rows".
    await setTradeKindBulk({
      actor,
      categoryIds: [goodsChild],
      tradeKind: "goods",
      reason: `${PREFIX}set one of the pair first`,
    });

    const result = await setTradeKindBulk({
      actor,
      categoryIds: [goodsChild, serviceChild],
      tradeKind: "goods",
      reason: `${PREFIX}now both`,
    });
    expect(result.ok).toBe(true);
    // Only the one that moved is counted, so the message cannot overstate it.
    expect(result.ok && result.changed).toBe(1);
  });

  it("counts listings over what MOVES, not over what was selected", async () => {
    /*
       AC5, and the number most easily got wrong. Selecting one sector with no
       listings of its own can change what every trade under it renders, so a
       confirmation quoting the sector's own count would say zero while four
       thousand businesses changed.
    */
    await setTradeKindBulk({
      actor,
      categoryIds: [sector],
      tradeKind: "goods",
      reason: `${PREFIX}baseline`,
    });
    await prisma.category.updateMany({
      where: { id: { in: [goodsChild, serviceChild] } },
      data: { tradeKind: null },
    });

    const business = await prisma.business.findFirst({
      where: { publishedAt: { not: null }, suspendedAt: null },
      select: { id: true, primaryCategoryId: true },
    });
    expect(business, "the seed needs a published listing for this to prove anything").not.toBeNull();
    await prisma.business.update({
      where: { id: business!.id },
      data: { primaryCategoryId: grandchild },
    });

    try {
      const impact = await tradeKindBulkImpact([sector], "services");
      // The sector is selected; three rows follow it, one of which holds the
      // listing — and the listing is counted even though the sector has none.
      expect(impact.rows).toBe(1);
      expect(impact.alsoInheriting).toBe(3);
      expect(impact.listings).toBe(1);
    } finally {
      await prisma.business.update({
        where: { id: business!.id },
        data: { primaryCategoryId: business!.primaryCategoryId },
      });
    }
  });
});

describe("what the board renders", () => {
  it("puts unset rows first, and derives the progress figure from the same array", async () => {
    /*
       AC7: "the progress figure and the unset-first sort derive from the same
       query — they cannot disagree." Asserted by checking the counts against
       the array rather than against a second query, which is the only way the
       guarantee means anything.
    */
    const board = await loadTradeKindBoard();

    expect(board.total).toBe(board.rows.length);
    expect(board.decided).toBe(board.rows.filter((r) => r.trade.from === "own").length);
    expect(board.inherited).toBe(board.rows.filter((r) => r.trade.from === "inherited").length);
    expect(board.unset).toBe(board.rows.filter((r) => r.trade.from === "default").length);
    expect(board.decided + board.inherited + board.unset).toBe(board.total);

    // Unset, then inherited, then decided — never interleaved.
    const band = { default: 0, inherited: 1, own: 2 } as const;
    const bands = board.rows.map((row) => band[row.trade.from]);
    expect(bands).toEqual([...bands].sort((a, b) => a - b));
  });

  it("names who set a row, and nobody for one that inherits", async () => {
    await setTradeKindBulk({
      actor,
      categoryIds: [sector],
      tradeKind: "services",
      reason: `${PREFIX}authored`,
    });
    await prisma.category.update({ where: { id: serviceChild }, data: { tradeKind: null } });

    const board = await loadTradeKindBoard();
    const own = board.rows.find((row) => row.id === sector);
    const inherits = board.rows.find((row) => row.id === serviceChild);

    expect(own?.setBy, "read from the audit log, not from a column").toBeTruthy();
    expect(inherits?.trade.from).toBe("inherited");
    expect(inherits?.setBy, "an inherited row has no author").toBeNull();
  });
});
