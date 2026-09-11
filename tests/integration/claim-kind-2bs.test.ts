import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  changeSellsKind,
  isSellsChoice,
  recommendKind,
  setSellsKind,
} from "@/lib/onboarding/kind";

/**
 * Board `2b-s` — the fork, asked once, after ownership is proven.
 *
 * The rule worth testing is the one that is easy to get backwards: a
 * recommendation may only come from a decision somebody made. `resolveTradeKind`
 * never returns null — an unset taxonomy falls back to `goods` so the product
 * behaves as it did before the column existed — and if that fallback counted as
 * evidence, every seller on a platform with 0 of 440 categories set would be
 * shown "we sell products · MATCHES YOUR LICENCE" over a licence nobody read.
 */

const PREFIX = "kind-2bs-test-";

let goodsCat: string;
let servicesCat: string;
let undecidedCat: string;
let sectorId: string;

let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;
const made: string[] = [];

async function makeSeller(fields: {
  categoryIds?: readonly string[];
  licenceActivity?: string | null;
  published?: boolean;
}): Promise<string> {
  const mark = stamp();
  const primary = fields.categoryIds?.[0] ?? undecidedCat;
  const business = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-K${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      /*
         `in` rather than `??`, because the null case is a test case: a licence
         that states no activity is a real state and `??` would silently swap
         the default back in for it.
      */
      licenceActivity:
        "licenceActivity" in fields
          ? fields.licenceActivity
          : "Auditing of accounts · Tax consultancy",
      primaryCategoryId: primary,
      claimStatus: "claimed",
      ...(fields.published ? { publishedAt: new Date() } : {}),
      ...(fields.categoryIds && fields.categoryIds.length > 1
        ? {
            categories: {
              create: fields.categoryIds.slice(1).map((categoryId) => ({ categoryId })),
            },
          }
        : {}),
    },
    select: { id: true },
  });
  made.push(business.id);
  return business.id;
}

beforeAll(async () => {
  const sector = await prisma.category.create({
    data: { slug: `${PREFIX}sector`, code: "K2", name: "Kind test sector" },
    select: { id: true },
  });
  sectorId = sector.id;

  const [g, s, u] = await Promise.all([
    prisma.category.create({
      data: { slug: `${PREFIX}goods`, code: "K2", name: "Kind test — goods", parentId: sectorId, tradeKind: "goods" },
      select: { id: true },
    }),
    prisma.category.create({
      data: { slug: `${PREFIX}svc`, code: "K2", name: "Kind test — services", parentId: sectorId, tradeKind: "services" },
      select: { id: true },
    }),
    // Nothing set on it or anywhere above it: resolves by fallback only.
    prisma.category.create({
      data: { slug: `${PREFIX}undecided`, code: "K2", name: "Kind test — undecided", parentId: sectorId },
      select: { id: true },
    }),
  ]);
  goodsCat = g.id;
  servicesCat = s.id;
  undecidedCat = u.id;
});

afterAll(async () => {
  await prisma.business.deleteMany({ where: { id: { in: made } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
});

describe("what the licence recommends", () => {
  it("recommends services when every decided trade is sold by the job", async () => {
    const id = await makeSeller({ categoryIds: [servicesCat] });
    const rec = await recommendKind(id);
    expect(rec?.suggested).toBe("services");
    expect(rec?.because).toBeNull();
  });

  it("recommends products when every decided trade is sold by the item", async () => {
    const id = await makeSeller({ categoryIds: [goodsCat] });
    expect((await recommendKind(id))?.suggested).toBe("goods");
  });

  it("recommends both when the licence covers one of each — D8's whole case", async () => {
    /*
       An IT company selling servers and cybersecurity. This needs no third
       value on `Category.tradeKind`: the business holds one trade of each and
       each listing still renders per its own.
    */
    const id = await makeSeller({ categoryIds: [goodsCat, servicesCat] });
    expect((await recommendKind(id))?.suggested).toBe("both");
  });

  it("recommends NOTHING when no trade has been decided, rather than the fallback", async () => {
    /*
       AC2, and the defect this test exists to prevent.

       `resolveTradeKind` answers `goods` for an undecided category, by design.
       If that counted here, a platform with an untouched taxonomy would tell
       every single seller their licence says products — a confident sentence
       about a licence nobody has read. The recommendation is built from
       `tradeKindOrigin`, which knows the difference between a decision and a
       fallback.
    */
    const id = await makeSeller({ categoryIds: [undecidedCat] });
    const rec = await recommendKind(id);
    expect(rec?.suggested).toBeNull();
    expect(rec?.because).toBe("taxonomy_undecided");
    expect(rec?.read.every((row) => row.decided === false)).toBe(true);
  });

  it("ignores undecided trades when at least one has been decided", async () => {
    // A half-set taxonomy is the normal state for months. One real answer is
    // evidence; the silent ones beside it are not counterevidence.
    const id = await makeSeller({ categoryIds: [servicesCat, undecidedCat] });
    expect((await recommendKind(id))?.suggested).toBe("services");
  });

  it("renders the licence's own words rather than our category names", async () => {
    // B3. The seller recognises their licence; they do not recognise our
    // taxonomy, and paraphrasing register prose stops this being evidence.
    const activity = "Auditing of accounts · Tax consultancy · Bookkeeping services";
    const id = await makeSeller({ categoryIds: [servicesCat], licenceActivity: activity });
    const rec = await recommendKind(id);
    expect(rec?.licenceActivity).toBe(activity);
    expect(rec?.licenceNumber).toMatch(/^DED-K/);
  });

  it("says so when the licence states no activity at all", async () => {
    const id = await makeSeller({ categoryIds: [servicesCat], licenceActivity: null });
    const rec = await recommendKind(id);
    expect(rec?.licenceActivity).toBeNull();
    // The trades still decide the recommendation; only the evidence card changes.
    expect(rec?.suggested).toBe("services");
  });
});

describe("recording the answer", () => {
  it("takes only the three real answers", () => {
    for (const value of ["services", "goods", "both"]) expect(isSellsChoice(value)).toBe(true);
    // `unset` is a state, never a choice — offering it would let a seller
    // un-answer the one question the rest of onboarding depends on.
    for (const value of ["unset", "", "SERVICES", "product"]) {
      expect(isSellsChoice(value), value).toBe(false);
    }
  });

  it("starts unset, so onboarding can route back to the question", async () => {
    const id = await makeSeller({ categoryIds: [servicesCat] });
    const row = await prisma.business.findUniqueOrThrow({
      where: { id },
      select: { sellsKind: true },
    });
    expect(row.sellsKind).toBe("unset");
  });

  it("records the declaration and converts nothing else", async () => {
    const id = await makeSeller({ categoryIds: [goodsCat] });
    const before = await prisma.business.findUniqueOrThrow({
      where: { id },
      select: { primaryCategoryId: true, licenceActivity: true },
    });

    // Against the recommendation, which must be unimpeded — AC4.
    expect(await setSellsKind(id, "services")).toEqual({ ok: true });

    const after = await prisma.business.findUniqueOrThrow({
      where: { id },
      select: { sellsKind: true, primaryCategoryId: true, licenceActivity: true },
    });
    expect(after.sellsKind).toBe("services");
    // The categories are untouched: the declaration and the taxonomy are two
    // different facts, and this screen only writes one of them.
    expect(after.primaryCategoryId).toBe(before.primaryCategoryId);
    expect(after.licenceActivity).toBe(before.licenceActivity);
  });

  it("refuses in onboarding once the listing is published", async () => {
    // Not frozen — moved. After publication the change has consequences a
    // five-second funnel click should not carry, so it belongs in Settings.
    const id = await makeSeller({ categoryIds: [servicesCat], published: true });
    expect(await setSellsKind(id, "goods")).toEqual({ ok: false, error: "published" });
  });

  it("keeps a previous answer, so returning to the screen shows it", async () => {
    const id = await makeSeller({ categoryIds: [goodsCat] });
    await setSellsKind(id, "both");
    expect((await recommendKind(id))?.current).toBe("both");
  });
});

describe("the Settings path the onboarding copy promises", () => {
  it("changes a published seller's answer and converts nothing", async () => {
    /*
       AC7 and B5: "do not ship the copy without the behaviour." The copy says
       you can switch at any time and that nothing carries across — so the
       behaviour has to exist, and it has to leave the rows alone.
    */
    const id = await makeSeller({ categoryIds: [goodsCat], published: true });
    await prisma.business.update({ where: { id }, data: { sellsKind: "goods" } });

    const product = await prisma.product.create({
      data: {
        businessId: id,
        name: "Kind test valve",
        slug: `${PREFIX}valve-${stamp()}`,
        categoryId: goodsCat,
        availability: "in_stock",
        status: "live",
      },
      select: { id: true, availability: true },
    });

    const result = await changeSellsKind(id, "services");
    expect(result).toEqual({ ok: true, changed: true });

    expect(
      (await prisma.business.findUniqueOrThrow({ where: { id }, select: { sellsKind: true } }))
        .sellsKind,
    ).toBe("services");

    // The product survives, with its stock level intact. Silent conversion
    // would destroy data, and it is the one thing both halves of the fork
    // refuse to do.
    const kept = await prisma.product.findUnique({
      where: { id: product.id },
      select: { availability: true },
    });
    expect(kept?.availability).toBe(product.availability);
  });

  it("says nothing changed rather than rewriting the same value", async () => {
    const id = await makeSeller({ categoryIds: [servicesCat], published: true });
    await prisma.business.update({ where: { id }, data: { sellsKind: "services" } });
    expect(await changeSellsKind(id, "services")).toEqual({ ok: true, changed: false });
  });
});
