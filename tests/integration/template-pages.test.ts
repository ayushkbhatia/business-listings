import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { createPage, editPage, livePage, navPages, publishPage, renamePage } from "@/lib/storefront/pages";
import { createTemplate, publishTemplate } from "@/lib/storefront/service";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Board 5d, and criterion 9:
 *
 *   "Slugs are immutable once published; renaming produces a 301."
 *
 * A template page is authored once and appears on every storefront in the
 * sector, so renaming a published one is not renaming a URL — it is breaking
 * every link anybody has to any of them, at once.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;
let templateId: string;
let sectorId: string;
const madeCategories: string[] = [];

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
      select: { id: true },
    })
  ).id;

  const stamp = `${Date.now()}`;
  const sector = await prisma.category.create({
    data: { name: `Pages Trade ${stamp}`, slug: `pages-test-${stamp}`, code: "PG" },
    select: { id: true },
  });
  madeCategories.push(sector.id);
  sectorId = sector.id;

  const created = await createTemplate({
    actor: actor(opsLeadId, "staff_ops_lead"),
    sectorId,
    name: `Pages Template ${stamp}`,
    reason: "A template to hang test pages off.",
  });
  if (!created.ok) throw new Error("fixture failed");
  templateId = created.id;

  await publishTemplate({
    actor: actor(opsLeadId, "staff_ops_lead"),
    templateId,
    reason: "Live, so pages on it can be live too.",
  });
});

afterAll(async () => {
  await prisma.redirect.deleteMany({ where: { fromPath: { contains: "/pages-store-" } } });
  await prisma.business.deleteMany({ where: { slug: { startsWith: "pages-store-" } } });
  await prisma.storefrontTemplate.deleteMany({ where: { sectorId: { in: madeCategories } } });
  await prisma.category.deleteMany({ where: { id: { in: madeCategories } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: "pages-test-" } } });
  await prisma.$disconnect();
});

async function page(slug: string, title = "About us") {
  const result = await createPage({
    actor: actor(opsLeadId, "staff_ops_lead"),
    templateId,
    slug,
    title,
    reason: "A page this trade needs for company-name searches.",
  });
  if (!result.ok) throw new Error(`fixture failed: ${result.error}`);
  return result.id;
}

/** A published listing in the sector, so a rename has somewhere to redirect. */
async function store(index: number) {
  const stamp = `${Date.now()}${index}`;
  const business = await prisma.business.create({
    data: {
      tradeName: `Pages Store ${stamp}`,
      displayName: `Pages Store ${stamp}`,
      slug: `pages-store-${stamp}`,
      licenceNumber: `DED-PG-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 200 * 86_400_000),
      primaryCategoryId: sectorId,
      claimStatus: "claimed",
      publishedAt: new Date(),
    },
    select: { id: true, slug: true },
  });
  return business;
}

describe("addresses a page may have", () => {
  it("refuses one the storefront already answers on", async () => {
    /*
     * Next resolves the static segment first, so a page at `products` would
     * silently never render. Refusing it is better than shipping a page nobody
     * can reach.
     */
    for (const slug of ["products", "branches", "reviews", "p", "d"]) {
      const result = await createPage({
        actor: actor(opsLeadId, "staff_ops_lead"),
        templateId,
        slug,
        title: "Clash",
        reason: "Trying a reserved address.",
      });
      expect(result, slug).toMatchObject({ ok: false, error: "slug_is_reserved" });
    }
  }, 60_000);

  it("refuses anything that is not a slug", async () => {
    for (const slug of ["About Us", "about_us", "about/us", "-about", ""]) {
      const result = await createPage({
        actor: actor(opsLeadId, "staff_ops_lead"),
        templateId,
        slug,
        title: "Bad",
        reason: "Trying a bad address.",
      });
      expect(result, slug).toMatchObject({ ok: false, error: "not_a_slug" });
    }
  }, 60_000);

  it("refuses a second page at the same address", async () => {
    await page("projects");
    const again = await createPage({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId,
      slug: "projects",
      title: "Projects again",
      reason: "Trying a duplicate.",
    });
    expect(again).toMatchObject({ ok: false, error: "slug_taken" });
  }, 60_000);
});

describe("criterion 9 — a published slug is fixed, and a rename redirects", () => {
  it("renames a draft freely, and writes no redirect", async () => {
    // Nothing has linked to a draft. A redirect from an address nobody has is
    // a row that will never be read.
    const id = await page("draft-page");
    const result = await renamePage({
      actor: actor(opsLeadId, "staff_ops_lead"),
      pageId: id,
      slug: "draft-renamed",
      reason: "Better name before anybody sees it.",
    });
    expect(result).toMatchObject({ ok: true, redirects: 0 });

    const after = await prisma.templatePage.findUniqueOrThrow({ where: { id } });
    expect(after.slug).toBe("draft-renamed");
  }, 60_000);

  it("writes a 301 per store when a published page moves", async () => {
    const stores = [await store(1), await store(2)];
    const id = await page("certifications-page", "Certifications");
    await publishPage(actor(opsLeadId, "staff_ops_lead"), id, "Live for this trade.");

    const result = await renamePage({
      actor: actor(opsLeadId, "staff_ops_lead"),
      pageId: id,
      slug: "accreditations",
      reason: "Accreditations is what buyers in this trade search for.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redirects).toBeGreaterThanOrEqual(stores.length);

    /*
     * One row per store, because `Redirect.fromPath` is a path and a
     * storefront's path contains its own slug. Renaming one template page
     * breaks a link on every storefront in the sector at once.
     */
    for (const shop of stores) {
      const redirect = await prisma.redirect.findUnique({
        where: { fromPath: `/b/${shop.slug}/certifications-page` },
        select: { toPath: true, statusCode: true },
      });
      expect(redirect, shop.slug).not.toBeNull();
      expect(redirect!.toPath).toBe(`/b/${shop.slug}/accreditations`);
      expect(redirect!.statusCode).toBe(301);
    }
  }, 120_000);

  it("keeps the older redirect when a page is renamed twice", async () => {
    const shop = await store(3);
    const id = await page("twice", "Twice");
    await publishPage(actor(opsLeadId, "staff_ops_lead"), id, "Live.");

    await renamePage({
      actor: actor(opsLeadId, "staff_ops_lead"),
      pageId: id,
      slug: "twice-two",
      reason: "First rename.",
    });
    await renamePage({
      actor: actor(opsLeadId, "staff_ops_lead"),
      pageId: id,
      slug: "twice-three",
      reason: "Second rename.",
    });

    // The address that has been out in the world longest still resolves.
    const first = await prisma.redirect.findUnique({
      where: { fromPath: `/b/${shop.slug}/twice` },
      select: { toPath: true },
    });
    expect(first).not.toBeNull();
    void shop;
  }, 120_000);

  it("records on the audit row that the slug is now fixed", async () => {
    const id = await page("audit-page", "Audit");
    await publishPage(actor(opsLeadId, "staff_ops_lead"), id, "Publishing this page for the trade.");

    const row = await prisma.auditEvent.findFirstOrThrow({
      where: { subject: `StorefrontTemplate:${templateId}` },
      orderBy: { createdAt: "desc" },
      select: { after: true },
    });
    const after = row.after as { slugFixed: boolean; status: string };
    expect(after.slugFixed).toBe(true);
    expect(after.status).toBe("live");
  }, 60_000);
});

describe("what a storefront serves", () => {
  it("serves a published page and not a draft", async () => {
    const draft = await page("still-draft", "Draft");
    expect(await livePage(sectorId, "still-draft")).toBeNull();

    await publishPage(actor(opsLeadId, "staff_ops_lead"), draft, "Live now.");
    const live = await livePage(sectorId, "still-draft");
    expect(live).not.toBeNull();
    expect(live!.title).toBe("Draft");
  }, 60_000);

  it("lists only the pages marked for the nav", async () => {
    const hidden = await page("hidden-page", "Hidden");
    await publishPage(actor(opsLeadId, "staff_ops_lead"), hidden, "Live but not in the nav.");
    await editPage({
      actor: actor(opsLeadId, "staff_ops_lead"),
      pageId: hidden,
      showInNav: false,
      reason: "Reachable by link, not in the nav.",
    });

    const nav = await navPages(sectorId);
    expect(nav.some((entry) => entry.slug === "hidden-page")).toBe(false);
  }, 60_000);
});

describe("who may author a page", () => {
  it("refuses a moderator", async () => {
    await expect(
      createPage({
        actor: actor(moderatorId, "staff_moderator"),
        templateId,
        slug: "moderator-page",
        title: "Nope",
        reason: "Not my row.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  }, 60_000);
});
