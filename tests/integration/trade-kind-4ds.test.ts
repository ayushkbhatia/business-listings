import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { AuditReasonError } from "@/lib/auth/errors";
import type { Actor } from "@/lib/auth/roles";
import { loadTradeKinds, setTradeKind, tradeKindImpact } from "@/lib/taxonomy/service";
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
      setTradeKind({ actor, categoryId: sector, tradeKind: "services", reason: "" }),
    ).rejects.toBeInstanceOf(AuditReasonError);
  });

  it("writes the column and an audit row carrying both sides of the change", async () => {
    const result = await setTradeKind({
      actor,
      categoryId: sector,
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
    await setTradeKind({
      actor,
      categoryId: goodsChild,
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
    const result = await setTradeKind({
      actor,
      categoryId: goodsChild,
      tradeKind: null,
      reason: `${PREFIX}wrong call, put it back`,
    });
    expect(result.ok).toBe(true);

    const rows = await loadTradeKinds();
    expect(rows.get(goodsChild)?.tradeKind).toBeNull();
    expect(resolveTradeKind(rows, goodsChild)).toBe("services");
  });

  it("refuses a write that would change nothing", async () => {
    const again = await setTradeKind({
      actor,
      categoryId: sector,
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
    await setTradeKind({
      actor,
      categoryId: serviceChild,
      tradeKind: "goods",
      reason: `${PREFIX}an override to be counted`,
    });

    const impact = await tradeKindImpact(sector, "goods");
    // The sector itself, plus the two rows that inherit from it.
    expect(impact.moved).toBe(3);
    expect(impact.overridden).toBe(1);
  });

  it("is zero for a category the taxonomy does not hold", async () => {
    expect(await tradeKindImpact("not-a-category", "services")).toEqual({
      moved: 0,
      overridden: 0,
    });
  });
});
