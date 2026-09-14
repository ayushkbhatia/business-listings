import { z } from "zod";

/**
 * One read of the FTA tax agent register, as it is kept — board `4c-s` B2.
 *
 * Pure, and the only description of the shape. The adapter writes it, the
 * credential stores it, the review screen draws its right-hand column from it,
 * and the decision's audit row carries a copy, so all four read one schema and
 * none of them can disagree about what "the register said" means.
 *
 * ## Point-in-time, and kept
 *
 * `FETCHED 09:14` on the board is real. A read is a statement about one moment,
 * and a decision taken against an old one is a decision about a register that
 * may have moved since — so a stale read has to be refetched before anybody
 * decides anything against it, and the read itself is kept, because a
 * verification nobody can re-read later is not auditable.
 *
 * What is **not** kept is a compliance record. `D10`'s *no register* means the
 * platform holds no register of its own on the seller — nothing it maintains,
 * nothing it chases on renewal. One read of somebody else's register, stored
 * beside the outcome it justified, is the opposite of that.
 */

/** The register's own statuses. Anything but `active` is not a practising agent. */
export const AGENT_STATUSES = ["active", "suspended", "deregistered", "expired"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * What a register client must return for a number it holds.
 *
 * This is the contract, not the FTA's own API — there is no public FTA API to
 * mirror. Whatever sits behind `FTA_REGISTER_URL` answers
 * `GET /tax-agents/:number` with this body, or a 404. The trade licence is part
 * of the contract because the entity cross-check needs it: without the licence
 * the register names, a matching name only says a company with that name is an
 * agent, not that this one is.
 */
export const registerRecordSchema = z.object({
  taan: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(300),
  status: z.enum(AGENT_STATUSES),
  /** `yyyy-mm-dd`. Null where the register prints no end date. */
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  tradeLicence: z
    .object({
      number: z.string().trim().min(1).max(60),
      authority: z.string().trim().min(1).max(20).nullable().optional(),
    })
    .nullable(),
});

export type RegisterRecord = z.infer<typeof registerRecordSchema>;

/** Why a read did not produce an answer. None of them is evidence about the seller. */
export const UNAVAILABLE_CAUSES = ["not_configured", "timeout", "http_status", "bad_response", "network"] as const;
export type UnavailableCause = (typeof UNAVAILABLE_CAUSES)[number];

const base = {
  v: z.literal(1),
  /** The normalised number that was asked about. */
  asked: z.string(),
  fetchedAt: z.iso.datetime(),
  /** Which register answered, named for the record and the screen. */
  source: z.string(),
};

export const registerFetchSchema = z.discriminatedUnion("outcome", [
  z.object({ ...base, outcome: z.literal("found"), record: registerRecordSchema }),
  z.object({ ...base, outcome: z.literal("not_found") }),
  z.object({
    ...base,
    outcome: z.literal("unavailable"),
    cause: z.enum(UNAVAILABLE_CAUSES),
    httpStatus: z.number().int().optional(),
  }),
]);

export type RegisterFetch = z.infer<typeof registerFetchSchema>;

/** The register's name, as a verification records it and a buyer reads it. */
export const FTA_REGISTER_SOURCE = "FTA tax agent register";

/**
 * How long a read may be decided against.
 *
 * An hour. Registers move slowly, and the rule is not about the FTA changing its
 * mind in forty minutes — it is that "fetched 09:14" on a screen opened at
 * 16:30 is a stale statement dressed as a current one. The screen offers a
 * refetch and the service refuses a decision past this, so the rule holds for a
 * bulk action that never drew the screen at all.
 */
export const REGISTER_FRESH_MS = 60 * 60 * 1000;

/**
 * How soon a read the register did not answer is tried again by the sweep.
 * Hourly, like the sweep; the bound is so a register that is down for a day
 * is not asked about the same number sixty times.
 */
export const REGISTER_RETRY_MS = 50 * 60 * 1000;

export function isFresh(fetch: Pick<RegisterFetch, "fetchedAt">, now: Date): boolean {
  const at = Date.parse(fetch.fetchedAt);
  return Number.isFinite(at) && now.getTime() - at <= REGISTER_FRESH_MS && at <= now.getTime() + 60_000;
}

/** A stored read, read defensively: anything that does not parse is no read at all. */
export function parseRegisterFetch(value: unknown): RegisterFetch | null {
  const parsed = registerFetchSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
