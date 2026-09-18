import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { loadComparison, trayItemFor } from "@/lib/db/queries/compare";
import { changeTray, trayCookie } from "@/lib/compare/service";
import { buildComparison } from "@/lib/compare/table";
import { COMPARE_COOKIE, EMPTY_TRAY, parseTray, serialiseTray, type Tray } from "@/lib/compare/tray";
import { POST } from "@/app/api/compare/route";

/**
 * Board `10d` — the comparison against real rows.
 *
 * The pure rules — which cells differ, the cap, one trade — are unit tests
 * beside `lib/compare`. What lives here is what a unit test cannot reach: that
 * the columns are read fresh and in the buyer's order, that the rows are the
 * resolved template's, that a product which left the directory leaves the
 * comparison, and that the route writes the cookie only when the tray changed.
 *
 * Everything is this file's own — a trade with its own template, two sellers
 * made for it — so the seeded catalogue is read by nobody here and changed by
 * nothing.
 */

const PREFIX = "10d-compare-fixture";
const stamp = `${Date.now()}`;
const DAY = 86_400_000;

let valves: { id: string; name: string };
let pumps: { id: string; name: string };
let templateId: string;
let fieldIds: { size: string; end: string; seat: string; coating: string };
let sellerA: string;
let sellerB: string;
let suspended: string;

const ids: Record<string, string> = {};

async function seller(label: string, extra: { suspendedAt?: Date; responseTimeMedianMs?: number } = {}) {
  const row = await prisma.business.create({
    data: {
      tradeName: `${PREFIX} ${label} LLC`,
      displayName: `${PREFIX} ${label}`,
      slug: `${PREFIX}-${label}-${stamp}`,
      licenceNumber: `DED-${label.slice(0, 3).toUpperCase()}${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * DAY),
      primaryCategoryId: valves.id,
      claimStatus: "claimed",
      planId: "free",
      publishedAt: new Date(),
      ...extra,
    },
    select: { id: true },
  });
  return row.id;
}

async function product(
  key: string,
  businessId: string,
  opts: {
    categoryId?: string;
    specValues?: Record<string, unknown>;
    status?: "live" | "draft";
    stockQty?: number;
    stockUpdatedAt?: Date;
  } = {},
) {
  const row = await prisma.product.create({
    data: {
      businessId,
      categoryId: opts.categoryId ?? valves.id,
      name: `${PREFIX} ${key}`,
      slug: `${PREFIX}-${key}-${stamp}`,
      availability: "in_stock",
      stockQty: opts.stockQty ?? null,
      stockUpdatedAt: opts.stockUpdatedAt ?? null,
      status: opts.status ?? "live",
      specValues: (opts.specValues ?? {}) as never,
    },
    select: { id: true },
  });
  ids[key] = row.id;
  return row.id;
}

beforeAll(async () => {
  valves = await prisma.category.create({
    data: { name: `${PREFIX} valves`, slug: `${PREFIX}-valves-${stamp}`, code: `${PREFIX}-valves-${stamp}` },
    select: { id: true, name: true },
  });
  pumps = await prisma.category.create({
    data: { name: `${PREFIX} pumps`, slug: `${PREFIX}-pumps-${stamp}`, code: `${PREFIX}-pumps-${stamp}` },
    select: { id: true, name: true },
  });

  const template = await prisma.specTemplate.create({
    data: {
      categories: { create: { categoryId: valves.id } },
      name: `${PREFIX} butterfly valves`,
      version: 1,
      status: "live",
      fields: {
        create: [
          { key: "size", label: "Nominal size", type: "text", sortOrder: 0 },
          {
            key: "end",
            label: "End connection",
            type: "select",
            options: ["Grooved", "Lugged wafer", "Wafer"],
            sortOrder: 1,
          },
          { key: "seat", label: "Seat material", type: "text", sortOrder: 2 },
          { key: "coating", label: "Coating", type: "text", sortOrder: 3 },
        ],
      },
    },
    select: { id: true, fields: { select: { id: true, key: true } } },
  });
  templateId = template.id;
  await prisma.category.update({ where: { id: valves.id }, data: { defaultTemplateId: template.id } });
  const byKey = Object.fromEntries(template.fields.map((field) => [field.key, field.id]));
  fieldIds = { size: byKey.size!, end: byKey.end!, seat: byKey.seat!, coating: byKey.coating! };

  sellerA = await seller("alpha", { responseTimeMedianMs: 2 * 3_600_000 });
  sellerB = await seller("bravo");
  suspended = await seller("charlie", { suspendedAt: new Date() });

  await product("dn100-grooved", sellerA, {
    specValues: { [fieldIds.size]: "DN100", [fieldIds.end]: "Grooved", [fieldIds.seat]: "EPDM" },
    stockQty: 240,
    stockUpdatedAt: new Date(),
  });
  await product("4in-wafer", sellerB, {
    specValues: { [fieldIds.size]: '4"', [fieldIds.end]: "Wafer" },
    stockQty: 60,
    stockUpdatedAt: new Date(Date.now() - 45 * DAY),
  });
  await product("draft", sellerA, { status: "draft" });
  await product("suspended-seller", suspended);
  await product("a-pump", sellerA, { categoryId: pumps.id });
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.category.updateMany({ where: { defaultTemplateId: templateId }, data: { defaultTemplateId: null } });
  await prisma.specField.deleteMany({ where: { templateId } });
  await prisma.specTemplateCategory.deleteMany({ where: { templateId } });
  await prisma.specTemplate.deleteMany({ where: { id: templateId } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe("loadComparison", () => {
  it("keeps the buyer's order, not the database's (B12)", async () => {
    const forward = await loadComparison([ids["dn100-grooved"]!, ids["4in-wafer"]!]);
    const backward = await loadComparison([ids["4in-wafer"]!, ids["dn100-grooved"]!]);
    expect(forward.products.map((column) => column.id)).toEqual([ids["dn100-grooved"], ids["4in-wafer"]]);
    expect(backward.products.map((column) => column.id)).toEqual([ids["4in-wafer"], ids["dn100-grooved"]]);
  });

  it("takes its rows from the resolved template, in template order, filled or not (B1)", async () => {
    const loaded = await loadComparison([ids["dn100-grooved"]!, ids["4in-wafer"]!]);
    expect(loaded.trade).toEqual(valves);
    expect(loaded.fields.map((field) => field.label)).toEqual([
      "Nominal size",
      "End connection",
      "Seat material",
      "Coating",
    ]);
    expect(loaded.fields.find((field) => field.label === "End connection")!.options).toEqual([
      "Grooved",
      "Lugged wafer",
      "Wafer",
    ]);
  });

  it("names the seller by displayName and carries the measured reply time", async () => {
    const loaded = await loadComparison([ids["dn100-grooved"]!, ids["4in-wafer"]!]);
    expect(loaded.products[0]).toMatchObject({ seller: `${PREFIX} alpha`, replyMs: 2 * 3_600_000 });
    expect(loaded.products[1]).toMatchObject({ seller: `${PREFIX} bravo`, replyMs: null });
  });

  it("states a fresh stock count and withholds a stale one", async () => {
    const loaded = await loadComparison([ids["dn100-grooved"]!, ids["4in-wafer"]!]);
    expect(loaded.products.map((column) => column.stockQty)).toEqual([240, null]);
  });

  it("drops a draft and a suspended seller's product, and counts them (B10)", async () => {
    const loaded = await loadComparison([
      ids["dn100-grooved"]!,
      ids["draft"]!,
      ids["suspended-seller"]!,
      ids["4in-wafer"]!,
    ]);
    expect(loaded.products.map((column) => column.id)).toEqual([ids["dn100-grooved"], ids["4in-wafer"]]);
    expect(loaded.delisted).toBe(2);
  });

  it("compares in the first product's trade and names the one from another", async () => {
    const loaded = await loadComparison([ids["dn100-grooved"]!, ids["a-pump"]!, ids["4in-wafer"]!]);
    expect(loaded.trade).toEqual(valves);
    expect(loaded.products).toHaveLength(2);
    expect(loaded.otherTrade).toEqual([{ id: ids["a-pump"], name: `${PREFIX} a-pump`, trade: pumps.name }]);
  });

  it("returns nothing, honestly, when nothing resolves", async () => {
    expect(await loadComparison([])).toMatchObject({ trade: null, products: [], delisted: 0 });
    expect(await loadComparison([ids["draft"]!])).toMatchObject({ trade: null, products: [], delisted: 1 });
  });

  it("builds a table where DN100 and 4\" agree and the end connection decides", async () => {
    const loaded = await loadComparison([ids["dn100-grooved"]!, ids["4in-wafer"]!]);
    const table = buildComparison(loaded.fields, loaded.products, {
      availability: "Availability",
      reply: "Reply time",
      completeness: "Spec completeness",
    });
    const differs = Object.fromEntries(table.rows.map((row) => [row.label, row.differs]));
    expect(differs).toMatchObject({
      "Nominal size": false,
      "End connection": true,
      "Seat material": false,
      Coating: false,
      Availability: false,
    });
    expect(table.deciding).toBe(1);
  });
});

describe("changeTray", () => {
  it("reads the product fresh and files it under its own trade", async () => {
    expect(await trayItemFor(ids["dn100-grooved"]!)).toEqual({
      item: { id: ids["dn100-grooved"], name: `${PREFIX} dn100-grooved`, seller: `${PREFIX} alpha` },
      trade: valves,
    });
    expect(await trayItemFor(ids["draft"]!)).toBeNull();
    expect(await trayItemFor(ids["suspended-seller"]!)).toBeNull();
  });

  it("adds nothing for a product no longer listed, and says so", async () => {
    const change = await changeTray(EMPTY_TRAY, "add", ids["draft"]!);
    expect(change.outcome).toBe("unavailable");
    expect(change.tray).toBe(EMPTY_TRAY);
  });

  it("starts a fresh comparison for another trade", async () => {
    const first = await changeTray(EMPTY_TRAY, "add", ids["dn100-grooved"]!);
    const second = await changeTray(first.tray, "add", ids["a-pump"]!);
    expect(second).toMatchObject({ outcome: "replaced", dropped: 1 });
    expect(second.tray.trade).toEqual(pumps);
  });

  it("clears to nothing, which the cookie writer turns into a delete", async () => {
    const change = await changeTray(EMPTY_TRAY, "clear", null);
    expect(change.outcome).toBe("cleared");
    expect(trayCookie(change.tray)).toBeNull();
  });
});

describe("POST /api/compare", () => {
  const ORIGIN = "https://businesslistings.me";

  function post(fields: Record<string, string>, init: { tray?: Tray; json?: boolean; origin?: string; referer?: string } = {}) {
    const body = new URLSearchParams(fields);
    const headers = new Headers({
      "content-type": "application/x-www-form-urlencoded",
      host: "businesslistings.me",
      origin: init.origin ?? ORIGIN,
    });
    if (init.json) headers.set("accept", "application/json");
    if (init.referer) headers.set("referer", init.referer);
    // Sent as a browser sends it: percent-encoded, the way the response set it.
    if (init.tray) headers.set("cookie", `${COMPARE_COOKIE}=${encodeURIComponent(serialiseTray(init.tray))}`);
    return new NextRequest(`${ORIGIN}/api/compare`, { method: "POST", headers, body });
  }

  it("adds, answers with the tray, and sets a session cookie a script can read", async () => {
    const response = await POST(post({ intent: "add", productId: ids["dn100-grooved"]! }, { json: true }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const change = await response.json();
    expect(change.outcome).toBe("added");

    const cookie = response.cookies.get(COMPARE_COOKIE)!;
    expect(parseTray(cookie.value).items.map((item) => item.id)).toEqual([ids["dn100-grooved"]]);
    /*
       What the browser receives, and what `document.cookie` then holds: encoded
       exactly once. The client store decodes once, so a second layer here is a
       tray the server reads and the page cannot.
    */
    const header = response.headers.get("set-cookie") ?? "";
    const sent = /bl_cmp=([^;]*)/.exec(header)![1]!;
    expect(parseTray(decodeURIComponent(sent)).items).toHaveLength(1);
    expect(cookie).toMatchObject({ path: "/", sameSite: "lax", httpOnly: false });
    expect(cookie.maxAge).toBeUndefined();
    expect(cookie.expires).toBeUndefined();
  });

  it("refuses a fifth without touching the cookie (B7)", async () => {
    const full: Tray = {
      trade: valves,
      items: [1, 2, 3, 4].map((n) => ({ id: `cfull${String(n).padStart(20, "0")}`, name: `Held ${n}`, seller: "S" })),
    };
    const response = await POST(post({ intent: "add", productId: ids["4in-wafer"]! }, { json: true, tray: full }));
    expect((await response.json()).outcome).toBe("full");
    expect(response.cookies.get(COMPARE_COOKIE)).toBeUndefined();
  });

  it("deletes the cookie when the last one leaves", async () => {
    const one: Tray = { trade: valves, items: [{ id: ids["dn100-grooved"]!, name: "x", seller: "y" }] };
    const response = await POST(post({ intent: "remove", productId: ids["dn100-grooved"]! }, { json: true, tray: one }));
    expect((await response.json()).outcome).toBe("removed");
    expect(response.cookies.get(COMPARE_COOKIE)?.value).toBe("");
  });

  it("sends a plain form post back to the page it came from, on our own host", async () => {
    const response = await POST(
      post({ intent: "add", productId: ids["dn100-grooved"]! }, { referer: `${ORIGIN}/search?q=valve` }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/search?q=valve`);
  });

  it("never redirects to another site's referer", async () => {
    const response = await POST(
      post({ intent: "add", productId: ids["dn100-grooved"]! }, { referer: "https://elsewhere.example/phish" }),
    );
    expect(response.headers.get("location")).toBe(`${ORIGIN}/compare`);
  });

  it("refuses a post from another origin, and a body that is not a tick", async () => {
    expect((await POST(post({ intent: "add", productId: ids["dn100-grooved"]! }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(post({ intent: "delete-everything" }, { json: true }))).status).toBe(400);
  });
});
