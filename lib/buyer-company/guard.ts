import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";
import { activeMembership, lockCompany, type Membership } from "./store";

/**
 * Board `7b` — the one way into a company write.
 *
 * The capability is the membership, read from the record inside the write's
 * own transaction and again under the company lock: a demotion that committed
 * a moment ago is the answer, not the role the page was rendered with. A
 * company role is never an `Actor` role and never comes from a session claim.
 */

export type Refusal<E extends string> = { ok: false; error: E };

/** Refused before anything is changed. Every company screen answers these alike. */
export type NotAdmin = "not_member" | "not_admin";

/** A refusal found inside a transaction, thrown so the transaction rolls back with it. */
export class Refused<E extends string = string> extends Error {
  constructor(readonly code: E) {
    super(code);
  }
}

/** Run `work` in a transaction, under the actor's company lock, as its admin. */
export async function asAdmin<T, E extends string = never>(
  actorId: string,
  work: (tx: Prisma.TransactionClient, seat: Membership) => Promise<T>,
): Promise<T | Refusal<E | NotAdmin>> {
  return asMember<T, E | "not_admin">(actorId, async (tx, seat) => {
    if (seat.role !== "company_admin") throw new Refused("not_admin");
    return work(tx, seat);
  });
}

/** Run `work` in a transaction, under the actor's company lock, as any active member. */
export async function asMember<T, E extends string = never>(
  actorId: string,
  work: (tx: Prisma.TransactionClient, seat: Membership) => Promise<T>,
): Promise<T | Refusal<E | "not_member">> {
  try {
    return await prisma.$transaction(async (tx) => {
      const found = await activeMembership(tx, actorId);
      if (!found) throw new Refused("not_member");
      await lockCompany(tx, found.companyId);
      const seat = await activeMembership(tx, actorId);
      if (!seat || seat.companyId !== found.companyId) throw new Refused("not_member");
      return work(tx, seat);
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.code as E | "not_member" };
    throw error;
  }
}
