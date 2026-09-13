import { createHash, randomBytes } from "node:crypto";

/**
 * Board `11i` — the dates and the one state a closure can be in, as arithmetic.
 *
 * Pure, so every rule that decides whether a seller can still get their
 * listing back is provable without a database. The service reads these and
 * writes rows; nothing in here knows what a row is.
 */

/**
 * The cooling-off window. Answered by the owner on 14 Sep 2026.
 *
 * The listing comes down at request; for fourteen days after that the closure
 * can be reversed from the email and the listing goes back up exactly as it
 * was. A closure triggered in anger or by the wrong person is recoverable, and a
 * seller who closes because August was quiet can come back in September without
 * re-claiming a listing and re-verifying a licence.
 */
export const COOLING_OFF_DAYS = 14;

/**
 * How long a seller is told before a platform closure takes effect. Build note
 * `B8` — "the seller hears before it happens, not after".
 *
 * Fourteen, matching Terms §14's own notice period for a material change. A
 * licence renewal checked by an ops lead inside the window withdraws the notice
 * without anybody having to remember to.
 */
export const PLATFORM_NOTICE_DAYS = 14;

/**
 * How long verification documents are kept once a business is closed.
 *
 * Not a number this board chose. Privacy §07 already publishes it for
 * verification documents — *"12 months after expiry or removal"*, and the
 * reason it gives is *"proof of what we checked"*, not a statute. The board's
 * rail said *statutory*; the published policy is what binds, and a unit test
 * holds the two in step so the number cannot move here without the page.
 */
export const DOCUMENT_RETENTION_MONTHS = 12;

/**
 * How long invoices and tax records are kept. Privacy §07 r5, "5 years",
 * "UAE tax law" — the one retained item that is statutory, and the one the
 * board's table did not list. A closing seller loses dashboard access to their
 * own tax invoices, so the screen tells them to download copies first.
 */
export const INVOICE_RETENTION_YEARS = 5;

/** The document kinds that count as verification evidence for Privacy §07 r4. */
export const RETAINED_DOCUMENT_KINDS = ["trade_licence", "vat_certificate"] as const;

const DAY_MS = 86_400_000;

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/**
 * Calendar months, clamped to the last day of a shorter month.
 *
 * `setUTCMonth` alone rolls 31 January forward to 3 March. A retention date that
 * lands two days late is a document held longer than the policy says, which is
 * the direction a privacy promise must never err in.
 */
export function addMonths(from: Date, months: number): Date {
  const next = new Date(from.getTime());
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

export type ClosureInitiator = "owner" | "platform";

/** The fields a state needs. Structural, so a test needs no Prisma type. */
export interface ClosureFacts {
  initiator: ClosureInitiator;
  effectiveAt: Date;
  appliedAt: Date | null;
  finalAt: Date;
  reversedAt: Date | null;
  finalisedAt: Date | null;
}

/**
 * Where a closure is, and there is exactly one answer.
 *
 *   `noticed`   a platform notice is running; the listing is still up
 *   `pending`   a platform notice ran out but has not been applied yet
 *   `requested` the listing is down and the closure can still be reversed
 *   `due`       the window has passed but the job has not finalised it yet
 *   `final`     closed for good
 *   `reversed`  undone — by the owner, or withdrawn
 *
 * `pending` and `due` exist because a nightly job does the writing. A reader
 * that treated a passed `finalAt` as `requested` would offer a reversal the
 * service is about to refuse, and one that treated it as `final` would tell a
 * seller something the database does not say yet.
 */
export type ClosureState = "noticed" | "pending" | "requested" | "due" | "final" | "reversed";

export function closureState(facts: ClosureFacts, now: Date): ClosureState {
  if (facts.reversedAt) return "reversed";
  if (facts.finalisedAt) return "final";
  if (!facts.appliedAt) {
    return now.getTime() < facts.effectiveAt.getTime() ? "noticed" : "pending";
  }
  return now.getTime() < facts.finalAt.getTime() ? "requested" : "due";
}

/** Whether a reversal is still allowed right now. The service's own check. */
export function canReverse(facts: ClosureFacts, now: Date): boolean {
  const state = closureState(facts, now);
  return state === "requested" || state === "noticed" || state === "pending";
}

/** The dates an owner closure is created with. Effective the moment it is asked. */
export function ownerClosureDates(now: Date): { effectiveAt: Date; finalAt: Date } {
  return { effectiveAt: now, finalAt: addDays(now, COOLING_OFF_DAYS) };
}

/**
 * The dates a platform notice is created with.
 *
 * The cooling-off window starts when the listing actually comes down, not when
 * the notice was given, so a seller gets the same fourteen days to reverse
 * however the closure began.
 */
export function platformClosureDates(now: Date): { effectiveAt: Date; finalAt: Date } {
  const effectiveAt = addDays(now, PLATFORM_NOTICE_DAYS);
  return { effectiveAt, finalAt: addDays(effectiveAt, COOLING_OFF_DAYS) };
}

/** When a closed business's verification documents may be hard-deleted. */
export function documentsDeletableAt(finalisedAt: Date): Date {
  return addMonths(finalisedAt, DOCUMENT_RETENTION_MONTHS);
}

/**
 * A reversal token and the hash that is stored.
 *
 * 32 bytes, base64url. The token goes in the email and nowhere else; the
 * database holds only its SHA-256, so a read of `business_closure` is not
 * enough to reopen somebody's listing.
 */
export function newReversalToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashReversalToken(token) };
}

export function hashReversalToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * A token that could be one of ours, before any database read.
 *
 * Refusing obvious junk here means a link mangled by a mail client costs a
 * string comparison rather than an indexed lookup, and the page says the link
 * is broken rather than that it has expired.
 */
export function looksLikeReversalToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}
