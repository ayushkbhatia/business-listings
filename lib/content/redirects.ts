import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";

/**
 * Board 12g — redirects.
 *
 * `Redirect` is read by `lib/listing/redirect.ts` and by the template-page
 * route, so a row here is a live 301. Three of the four ways one gets written
 * are automatic — a merged listing, a renamed template page, a moved slug — and
 * this screen is for the fourth: somebody printed the wrong address on a van.
 *
 * Deletion is the interesting operation. A redirect that has been out in the
 * world is a link somebody may still follow, so removing one is a decision with
 * a reason on it rather than a tidy-up.
 */

export type RedirectRefusal =
  | "not_found"
  | "not_a_path"
  | "same_path"
  | "already_exists"
  | "would_chain";

export type RedirectResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: RedirectRefusal; message: string };

const MESSAGE: Record<RedirectRefusal, string> = {
  not_found: "That redirect is not here.",
  not_a_path: "A path that starts with a slash, like /b/al-marwan.",
  same_path: "A path cannot redirect to itself.",
  already_exists: "Something already redirects from that address.",
  would_chain:
    "The destination is itself a redirect. Point this one where that one goes, so a visitor takes one hop rather than two.",
};

function refuse<T>(error: RedirectRefusal): RedirectResult<T> {
  return { ok: false, error, message: MESSAGE[error] };
}

const PATH = /^\/[^\s?#]*$/;

export interface RedirectRow {
  id: string;
  fromPath: string;
  toPath: string;
  statusCode: number;
  businessName: string | null;
  createdAt: Date;
}

export async function redirectList(limit = 500): Promise<RedirectRow[]> {
  const rows = await prisma.redirect.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      fromPath: true,
      toPath: true,
      statusCode: true,
      createdAt: true,
      business: { select: { displayName: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    fromPath: row.fromPath,
    toPath: row.toPath,
    statusCode: row.statusCode,
    businessName: row.business?.displayName ?? null,
    createdAt: row.createdAt,
  }));
}

export interface AddRedirectInput {
  actor: Actor;
  fromPath: string;
  toPath: string;
  reason: string;
}

export async function addRedirect(
  input: AddRedirectInput,
): Promise<RedirectResult<{ id: string }>> {
  const fromPath = input.fromPath.trim();
  const toPath = input.toPath.trim();

  if (!PATH.test(fromPath) || !PATH.test(toPath)) return refuse("not_a_path");
  if (fromPath === toPath) return refuse("same_path");

  const [existing, chained] = await Promise.all([
    prisma.redirect.findUnique({ where: { fromPath }, select: { id: true } }),
    /*
     * A redirect whose destination is itself a redirect makes a visitor take
     * two hops and a crawler discount the second. Point it at the end of the
     * chain instead — refused rather than silently followed, because the person
     * adding it can see where it should go and this code cannot.
     */
    prisma.redirect.findUnique({ where: { fromPath: toPath }, select: { toPath: true } }),
  ]);
  if (existing) return refuse("already_exists");
  if (chained) return refuse("would_chain");

  const id = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "taxonomy.write",
        subject: `Redirect:${fromPath}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const row = await tx.redirect.create({
          data: { fromPath, toPath, statusCode: 301 },
          select: { id: true },
        });
        return { result: row.id, before: null, after: { fromPath, toPath } };
      },
    ),
  );

  return { ok: true, id };
}

export async function removeRedirect(
  actor: Actor,
  id: string,
  reason: string,
): Promise<RedirectResult> {
  const redirect = await prisma.redirect.findUnique({ where: { id } });
  if (!redirect) return refuse("not_found");

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        subject: `Redirect:${redirect.fromPath}`,
        reason,
        tx,
      },
      async () => {
        await tx.redirect.delete({ where: { id } });
        return {
          result: null,
          // The row is gone; the audit row is the only record it existed.
          before: { fromPath: redirect.fromPath, toPath: redirect.toPath },
          after: null,
        };
      },
    ),
  );

  return { ok: true };
}
