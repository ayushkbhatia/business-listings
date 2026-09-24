import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";
import type { CredentialKind } from "@/lib/db/generated/enums";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { resolveScopeFamily } from "@/lib/services/family";
import { credentialKindOrigin, type CredentialKindOrigin } from "./credential-kind";
import { tradeKindFor } from "./service";
import { lockCategories } from "./write";
import {
  servicesLandingProblems,
  tidy,
  type CategoryAskInput,
  type ServicesLandingProblem,
} from "./services-landing-rules";

export * from "./services-landing-rules";

/**
 * Board `6a-s` — what a services landing page reads off its trade, and the
 * writes that set it.
 *
 * Four things a person decides and no query can: what the page calls the people
 * in the trade, which credential buyers look for, the three questions worth
 * asking, and whether the services template is open for the trade at all. They
 * are set on `/admin/categories` beside the trade's kind, by `taxonomy.write`,
 * each with a written reason — non-negotiable 3 — and nothing here touches a
 * landing page's own copy, which stays per scope on the 6f matrix.
 *
 * Refusals are codes, as in `./write.ts`; the action turns them into catalogue
 * strings, so no sentence a person reads is written here.
 */

type Tx = Prisma.TransactionClient;

export interface CategoryAskView {
  position: number;
  question: string;
  why: string;
}

/** One trade's asks, in reading order. */
export async function categoryAsks(categoryId: string, db: Tx | typeof prisma = prisma): Promise<CategoryAskView[]> {
  return db.categoryAsk.findMany({
    where: { categoryId },
    orderBy: { position: "asc" },
    select: { position: true, question: true, why: true },
  });
}

/**
 * The credential a trade's page counts, with where the answer came from.
 *
 * Two small reads — the taxonomy's three columns and the families' two — and
 * the walk in `./credential-kind.ts`. The families are resolved through the
 * same `resolveScopeFamily` the editor uses, so a trade and its scope sheet
 * cannot disagree about which family they are in.
 */
export async function credentialKindFor(categoryId: string): Promise<CredentialKindOrigin> {
  const [categories, families] = await Promise.all([
    prisma.category.findMany({
      select: { id: true, parentId: true, credentialKind: true, scopeFamilyId: true },
    }),
    prisma.scopeSheetFamily.findMany({ select: { id: true, isDefault: true, credentialKind: true } }),
  ]);
  const rows = new Map(categories.map((row) => [row.id, row]));
  const familyId = resolveScopeFamily(rows, categoryId);
  const family =
    (familyId ? families.find((row) => row.id === familyId) : undefined) ??
    families.find((row) => row.isDefault) ??
    null;
  return credentialKindOrigin(
    rows,
    categoryId,
    family ? { familyId: family.id, kind: family.credentialKind } : null,
  );
}

/* ── The fields ──────────────────────────────────────────────────────────── */

export type ServicesLandingRefusal =
  | ServicesLandingProblem
  | "not_found"
  | "not_services"
  | "unchanged";

export type ServicesLandingResult = { ok: true } | { ok: false; error: ServicesLandingRefusal };

class Refused extends Error {
  constructor(readonly error: ServicesLandingRefusal) {
    super(error);
  }
}

/**
 * Save the trade's page vocabulary in one decision, with one reason: its plural
 * noun, the credential it counts and its questions.
 *
 * Whole-list for the questions, for the reason `saveLandingFaq` gives —
 * `position` is unique per trade, and reordering by individual updates walks
 * through a state where two rows share one.
 *
 * Refused for a trade that resolves to goods. None of these renders there, and
 * a field set on a trade nothing reads is a column with no reader.
 */
export async function saveServicesLandingCopy(input: {
  actor: Actor;
  categoryId: string;
  pluralHuman: string;
  credentialKind: string | null;
  asks: readonly CategoryAskInput[];
  reason: string;
}): Promise<ServicesLandingResult> {
  assertCan(input.actor, "taxonomy.write");

  const problems = servicesLandingProblems(input);
  if (problems.length > 0) return { ok: false, error: problems[0]! };
  if ((await tradeKindFor(input.categoryId)) !== "services") return { ok: false, error: "not_services" };

  const plural = tidy(input.pluralHuman) || null;
  const credential = (input.credentialKind as CredentialKind | null) ?? null;
  const asks = input.asks.map((ask, position) => ({
    position,
    question: tidy(ask.question),
    why: tidy(ask.why),
  }));

  try {
    await prisma.$transaction(async (tx) => {
      await lockCategories(tx, [input.categoryId]);
      const row = await tx.category.findUnique({
        where: { id: input.categoryId },
        select: { id: true, pluralHuman: true, credentialKind: true },
      });
      if (!row) throw new Refused("not_found");
      const before = await categoryAsks(row.id, tx);

      const same =
        row.pluralHuman === plural &&
        row.credentialKind === credential &&
        before.length === asks.length &&
        before.every(
          (ask, index) => ask.question === asks[index]?.question && ask.why === asks[index]?.why,
        );
      if (same) throw new Refused("unchanged");

      await staffMutation(
        {
          actor: input.actor,
          capability: "taxonomy.write",
          subject: `Category:${row.id}`,
          reason: input.reason,
          tx,
        },
        async () => {
          await tx.category.update({
            where: { id: row.id },
            data: { pluralHuman: plural, credentialKind: credential },
          });
          await tx.categoryAsk.deleteMany({ where: { categoryId: row.id } });
          if (asks.length > 0) {
            await tx.categoryAsk.createMany({
              data: asks.map((ask) => ({ categoryId: row.id, ...ask })),
            });
          }
          return {
            result: null,
            before: {
              pluralHuman: row.pluralHuman,
              credentialKind: row.credentialKind,
              asks: before.map((ask) => ask.question),
            },
            after: {
              pluralHuman: plural,
              credentialKind: credential,
              asks: asks.map((ask) => ask.question),
            },
          };
        },
      );
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.error };
    throw error;
  }
}

/**
 * Open or close the services template for one trade — the rollout flag.
 *
 * Opening stamps the day, which is what the Search Console check measures
 * from; closing clears it, and every live services page in the trade leaves
 * the site, the sitemap and every link block on the next request — `live`
 * reads the column. Closing does not unpublish anything: staff intent on each
 * page is left where it was, so reopening restores exactly the pages that were
 * live, and the sweep has nothing to undo.
 */
export async function setServicesLandingOpen(input: {
  actor: Actor;
  categoryId: string;
  open: boolean;
  reason: string;
  now?: Date;
}): Promise<ServicesLandingResult> {
  assertCan(input.actor, "taxonomy.write");
  if ((await tradeKindFor(input.categoryId)) !== "services") return { ok: false, error: "not_services" };

  try {
    await prisma.$transaction(async (tx) => {
      await lockCategories(tx, [input.categoryId]);
      const row = await tx.category.findUnique({
        where: { id: input.categoryId },
        select: { id: true, servicesLandingOpenedAt: true },
      });
      if (!row) throw new Refused("not_found");
      if ((row.servicesLandingOpenedAt !== null) === input.open) throw new Refused("unchanged");

      const next = input.open ? (input.now ?? new Date()) : null;
      await staffMutation(
        {
          actor: input.actor,
          capability: "taxonomy.write",
          subject: `Category:${row.id}`,
          reason: input.reason,
          tx,
        },
        async () => {
          await tx.category.update({
            where: { id: row.id },
            data: { servicesLandingOpenedAt: next },
          });
          return {
            result: null,
            before: { servicesLandingOpenedAt: row.servicesLandingOpenedAt },
            after: { servicesLandingOpenedAt: next },
          };
        },
      );
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.error };
    throw error;
  }
}

/* ── The editor's read ───────────────────────────────────────────────────── */

export interface ServicesLandingEditor {
  categoryId: string;
  name: string;
  pluralHuman: string | null;
  /** The trade's own value — what the select holds. */
  credentialKind: CredentialKind | null;
  /** What the pages actually count, and where it came from. */
  credential: CredentialKindOrigin;
  /** Where an inherited or family value came from, named. */
  credentialSource: string | null;
  asks: CategoryAskView[];
  openedAt: Date | null;
  /**
   * Pages in this trade staff have published — what closing the template
   * takes off the site. Intent, not the live state: closing hides every one of
   * them whatever its floors say, and reopening brings back exactly these.
   */
  publishedPages: number;
}

/**
 * The panel's read, for a trade that resolves to `services`; null for goods,
 * where nothing on it renders.
 */
export async function servicesLandingEditor(categoryId: string): Promise<ServicesLandingEditor | null> {
  if ((await tradeKindFor(categoryId)) !== "services") return null;
  const [row, asks, credential, areaPages, emiratePages] = await Promise.all([
    prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, name: true, pluralHuman: true, credentialKind: true, servicesLandingOpenedAt: true },
    }),
    categoryAsks(categoryId),
    credentialKindFor(categoryId),
    prisma.areaPage.count({ where: { categoryId, publishedAt: { not: null } } }),
    prisma.emiratePage.count({ where: { categoryId, publishedAt: { not: null } } }),
  ]);
  if (!row) return null;

  const credentialSource =
    credential.from === "inherited"
      ? ((await prisma.category.findUnique({ where: { id: credential.ancestorId }, select: { name: true } }))?.name ??
        null)
      : credential.from === "family"
        ? ((await prisma.scopeSheetFamily.findUnique({ where: { id: credential.familyId }, select: { name: true } }))
            ?.name ?? null)
        : null;

  return {
    categoryId: row.id,
    name: row.name,
    pluralHuman: row.pluralHuman,
    credentialKind: row.credentialKind,
    credential,
    credentialSource,
    asks,
    openedAt: row.servicesLandingOpenedAt,
    publishedPages: areaPages + emiratePages,
  };
}
