import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { resolveTradeKind } from "@/lib/taxonomy/trade-kind";
import { LEAF_OVERRIDES, SCOPE_FAMILIES, TRADE_KINDS } from "../../prisma/trade-kinds.mjs";

/**
 * The classified taxonomy — `4d-s`'s column filled in, `4e-s` B5's assignments.
 *
 * These are the assertions that catch a *rename*. The list in
 * `prisma/trade-kinds.mts` matches categories by slug and by name, so a trade
 * renamed in `seed-taxonomy.mts` would silently stop being classified and every
 * services board would go quietly back to testing one kind. The seed throws on
 * a miss; this proves the resolved state rather than the writing of it.
 */

async function taxonomy() {
  const rows = await prisma.category.findMany({
    select: { id: true, parentId: true, name: true, slug: true, tradeKind: true, scopeFamilyId: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const parents = new Set(rows.map((row) => row.parentId).filter(Boolean) as string[]);
  const leaves = rows.filter((row) => !parents.has(row.id));
  return { rows, byId, leaves };
}

describe("every trade is classified", () => {
  it("resolves both kinds, and neither is a rounding error", async () => {
    const { byId, leaves } = await taxonomy();
    const services = leaves.filter((row) => resolveTradeKind(byId, row.id) === "services");

    /*
       The epic's premise is that roughly half the directory sells work rather
       than things. A fixture where one kind is a handful lets every services
       branch pass vacuously, which is what it did while six of 440 were set.
    */
    expect(services.length).toBeGreaterThan(100);
    expect(leaves.length - services.length).toBeGreaterThan(100);
  });

  it("names no sector or subcategory that does not exist", async () => {
    const { rows } = await taxonomy();
    const bySlug = new Map(rows.map((row) => [row.slug, row]));

    for (const sector of TRADE_KINDS) {
      const parent = bySlug.get(sector.slug);
      expect(parent, `no sector "${sector.slug}"`).toBeDefined();

      for (const name of sector.except ?? []) {
        const hit = rows.filter((row) => row.parentId === parent!.id && row.name === name);
        expect(hit, `"${sector.slug} › ${name}"`).toHaveLength(1);
      }
    }

    for (const leaf of LEAF_OVERRIDES) {
      expect(bySlug.get(leaf.slug), `no category "${leaf.slug}"`).toBeDefined();
    }
  });

  it("puts every sector's exceptions on the other side of its own default", async () => {
    const { byId, rows } = await taxonomy();
    const bySlug = new Map(rows.map((row) => [row.slug, row]));

    for (const sector of TRADE_KINDS) {
      const parent = bySlug.get(sector.slug)!;
      expect(resolveTradeKind(byId, parent.id)).toBe(sector.kind);

      const other = sector.kind === "goods" ? "services" : "goods";
      for (const name of sector.except ?? []) {
        const child = rows.find((row) => row.parentId === parent.id && row.name === name)!;
        expect(resolveTradeKind(byId, child.id), `${sector.slug} › ${name}`).toBe(other);
      }
    }
  });
});

describe("every services subcategory has a scope sheet — `4e-s` B5, AC5", () => {
  it("leaves none on the fallback", async () => {
    const { byId, leaves } = await taxonomy();
    const orphans = leaves
      .filter((row) => resolveTradeKind(byId, row.id) === "services")
      .filter((row) => row.scopeFamilyId === null);

    expect(orphans.map((row) => row.name)).toEqual([]);
  });

  it("puts no goods subcategory on one", async () => {
    /*
       A goods category carrying a family is not broken — nothing reads it —
       but it would tell an admin a sheet covers a trade that will never render
       one, which is why `scopeLibrary` counts services leaves rather than the
       relation.
    */
    const { byId, leaves } = await taxonomy();
    const wrong = leaves
      .filter((row) => resolveTradeKind(byId, row.id) === "goods")
      .filter((row) => row.scopeFamilyId !== null);

    expect(wrong.map((row) => row.name)).toEqual([]);
  });

  it("assigns only families that exist", async () => {
    const families = new Set(
      (await prisma.scopeSheetFamily.findMany({ select: { id: true } })).map((row) => row.id),
    );

    for (const sector of SCOPE_FAMILIES) {
      expect(families, `${sector.slug} default`).toContain(sector.family);
      for (const [name, family] of Object.entries(sector.except ?? {})) {
        expect(families, `${sector.slug} › ${name}`).toContain(family);
      }
    }
  });

  it("spreads them across every family rather than defaulting to one", async () => {
    const { byId, leaves } = await taxonomy();
    const used = new Set(
      leaves
        .filter((row) => resolveTradeKind(byId, row.id) === "services")
        .map((row) => row.scopeFamilyId),
    );
    // All five are earning their place — a taxonomy that put everything on one
    // sheet would make four of the five dead rows.
    expect(used.size).toBe(5);
    expect(used).not.toContain("general");
  });
});
