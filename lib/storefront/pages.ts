import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import { readBlocks, type Block } from "./blocks";
import { storeCount } from "./service";

/**
 * Board 5d — template pages.
 *
 * A page is authored once and appears on every storefront in the sector, which
 * is what makes criterion 9 matter more than it looks:
 *
 *   *"Slugs are immutable once published; renaming produces a 301."*
 *
 * Renaming a published page is not renaming one URL. It is breaking every link
 * anybody has to `/b/<any of 1,842 slugs>/about`, all at once. So the slug is
 * fixed at publish and a rename is a new slug plus a redirect for every store —
 * which is why `Redirect` is per-path and this writes one row per business
 * rather than one for the template.
 */

export type PageRefusal =
  | "not_found"
  | "slug_taken"
  | "slug_is_reserved"
  | "not_a_slug"
  | "already_published";

export type PageResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: PageRefusal; message: string };

const MESSAGE: Record<PageRefusal, string> = {
  not_found: "That page is not here.",
  slug_taken: "This template already has a page at that address.",
  slug_is_reserved: "That address is one the storefront already uses for its catalogue, branches or reviews.",
  not_a_slug: "Lowercase letters, numbers and hyphens.",
  already_published: "This page is live, so its address is fixed. Publish a new page and this one will redirect to it.",
};

function refuse<T>(error: PageRefusal): PageResult<T> {
  return { ok: false, error, message: MESSAGE[error] };
}

/**
 * Addresses a storefront already answers on.
 *
 * A page at `/b/x/products` would shadow the catalogue — or rather it would
 * not, because Next resolves the static segment first, so the page would
 * silently never render. Refusing it is better than shipping a page nobody can
 * reach.
 */
const RESERVED = ["products", "branches", "reviews", "p", "d"];

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface PageView {
  id: string;
  slug: string;
  title: string;
  metaDescription: string | null;
  blocks: Block[];
  showInNav: boolean;
  allowIndexing: boolean;
  status: string;
  publishedAt: Date | null;
}

export async function pagesFor(templateId: string): Promise<PageView[]> {
  const pages = await prisma.templatePage.findMany({
    where: { templateId },
    orderBy: [{ status: "asc" }, { slug: "asc" }],
  });
  return pages.map((page) => ({
    id: page.id,
    slug: page.slug,
    title: page.title,
    metaDescription: page.metaDescription,
    blocks: readBlocks(page.blocks),
    showInNav: page.showInNav,
    allowIndexing: page.allowIndexing,
    status: page.status,
    publishedAt: page.publishedAt,
  }));
}

export interface CreatePageInput {
  actor: Actor;
  templateId: string;
  slug: string;
  title: string;
  reason: string;
}

export async function createPage(input: CreatePageInput): Promise<PageResult<{ id: string }>> {
  const template = await prisma.storefrontTemplate.findUnique({
    where: { id: input.templateId },
    select: { id: true, sectorId: true },
  });
  if (!template) return refuse("not_found");

  const slug = input.slug.trim().toLowerCase();
  if (!SLUG.test(slug)) return refuse("not_a_slug");
  if (RESERVED.includes(slug)) return refuse("slug_is_reserved");

  const taken = await prisma.templatePage.findFirst({
    where: { templateId: template.id, slug },
    select: { id: true },
  });
  if (taken) return refuse("slug_taken");

  const count = await storeCount(template.sectorId);

  const id = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "storefront.template.write",
        subject: `StorefrontTemplate:${template.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const page = await tx.templatePage.create({
          data: { templateId: template.id, slug, title: input.title, status: "draft" },
          select: { id: true },
        });
        return {
          result: page.id,
          before: null,
          after: { page: slug, storeCount: count },
        };
      },
    ),
  );

  return { ok: true, id };
}

export interface EditPageInput {
  actor: Actor;
  pageId: string;
  title?: string;
  metaDescription?: string | null;
  blocks?: Block[];
  showInNav?: boolean;
  allowIndexing?: boolean;
  reason: string;
}

/**
 * Everything about a page except its address.
 *
 * The slug is deliberately not in this input. Criterion 9 makes it immutable
 * once published, and a field that is editable-until-published is a field
 * somebody edits by accident on the last draft save before publishing.
 * `renamePage` is the deliberate act.
 */
export async function editPage(input: EditPageInput): Promise<PageResult> {
  const page = await prisma.templatePage.findUnique({
    where: { id: input.pageId },
    select: { id: true, slug: true, template: { select: { id: true, sectorId: true } } },
  });
  if (!page) return refuse("not_found");

  const count = await storeCount(page.template.sectorId);

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "storefront.template.write",
        subject: `StorefrontTemplate:${page.template.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        await tx.templatePage.update({
          where: { id: page.id },
          data: {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.metaDescription !== undefined
              ? { metaDescription: input.metaDescription }
              : {}),
            ...(input.blocks !== undefined ? { blocks: input.blocks as object[] } : {}),
            ...(input.showInNav !== undefined ? { showInNav: input.showInNav } : {}),
            ...(input.allowIndexing !== undefined ? { allowIndexing: input.allowIndexing } : {}),
          },
        });
        return {
          result: null,
          before: null,
          after: { page: page.slug, storeCount: count },
        };
      },
    ),
  );

  return { ok: true };
}

export async function publishPage(
  actor: Actor,
  pageId: string,
  reason: string,
  now = new Date(),
): Promise<PageResult<{ storeCount: number }>> {
  const page = await prisma.templatePage.findUnique({
    where: { id: pageId },
    select: { id: true, slug: true, status: true, template: { select: { id: true, sectorId: true } } },
  });
  if (!page) return refuse("not_found");

  const count = await storeCount(page.template.sectorId);

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "storefront.template.write",
        subject: `StorefrontTemplate:${page.template.id}`,
        reason,
        tx,
      },
      async () => {
        await tx.templatePage.update({
          where: { id: page.id },
          data: { status: "live", publishedAt: now },
        });
        return {
          result: null,
          before: { status: page.status },
          // The slug is fixed from here. Recorded, because the audit row is
          // where somebody looks to find when it stopped being editable.
          after: { page: page.slug, status: "live", slugFixed: true, storeCount: count },
        };
      },
    ),
  );

  return { ok: true, storeCount: count };
}

export interface RenameInput {
  actor: Actor;
  pageId: string;
  slug: string;
  reason: string;
}

/**
 * Criterion 9's second half.
 *
 * A published page's slug does not change. What happens instead is that the
 * page moves to a new address and every store in the sector gets a 301 from the
 * old one — one `Redirect` row per business, because `Redirect.fromPath` is a
 * path and a storefront's path contains its own slug.
 *
 * That is a row per store, which for a large sector is a lot of rows. It is
 * still the right shape: the alternative is a pattern-matching redirect
 * resolver, and a resolver that runs a regex over every 404 is a resolver that
 * eventually matches something it should not.
 */
export async function renamePage(input: RenameInput): Promise<PageResult<{ redirects: number }>> {
  const page = await prisma.templatePage.findUnique({
    where: { id: input.pageId },
    select: {
      id: true,
      slug: true,
      status: true,
      template: { select: { id: true, sectorId: true } },
    },
  });
  if (!page) return refuse("not_found");

  const slug = input.slug.trim().toLowerCase();
  if (!SLUG.test(slug)) return refuse("not_a_slug");
  if (RESERVED.includes(slug)) return refuse("slug_is_reserved");
  if (slug === page.slug) return { ok: true, redirects: 0 };

  const taken = await prisma.templatePage.findFirst({
    where: { templateId: page.template.id, slug },
    select: { id: true },
  });
  if (taken) return refuse("slug_taken");

  const wasPublished = page.status === "live";
  const stores = wasPublished
    ? await prisma.business.findMany({
        where: {
          sectorId: page.template.sectorId,
          publishedAt: { not: null },
          suspendedAt: null,
          mergedIntoId: null,
        },
        select: { id: true, slug: true },
      })
    : [];

  const redirects = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "storefront.template.write",
        subject: `StorefrontTemplate:${page.template.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        await tx.templatePage.update({ where: { id: page.id }, data: { slug } });

        if (stores.length > 0) {
          /*
           * `createMany` with `skipDuplicates`: a page renamed twice would
           * otherwise collide on `fromPath`, and the older redirect is the one
           * worth keeping — it is the address that has been out in the world
           * longest.
           */
          await tx.redirect.createMany({
            data: stores.map((store) => ({
              fromPath: `/b/${store.slug}/${page.slug}`,
              toPath: `/b/${store.slug}/${slug}`,
              statusCode: 301,
              businessId: store.id,
            })),
            skipDuplicates: true,
          });
        }

        return {
          result: stores.length,
          before: { slug: page.slug },
          after: { slug, redirects: stores.length, storeCount: stores.length },
        };
      },
    ),
  );

  return { ok: true, redirects };
}

/** A published page, for the public route. */
export async function livePage(sectorId: string, slug: string) {
  const template = await prisma.storefrontTemplate.findFirst({
    where: { sectorId, status: "live" },
    select: { id: true },
  });
  if (!template) return null;

  const page = await prisma.templatePage.findFirst({
    where: { templateId: template.id, slug, status: "live" },
  });
  if (!page) return null;

  return {
    slug: page.slug,
    title: page.title,
    metaDescription: page.metaDescription,
    blocks: readBlocks(page.blocks),
    allowIndexing: page.allowIndexing,
  };
}

/** Pages a storefront links to in its own nav. */
export async function navPages(sectorId: string) {
  const template = await prisma.storefrontTemplate.findFirst({
    where: { sectorId, status: "live" },
    select: { id: true },
  });
  if (!template) return [];

  return prisma.templatePage.findMany({
    where: { templateId: template.id, status: "live", showInNav: true },
    orderBy: { slug: "asc" },
    select: { slug: true, title: true },
  });
}
