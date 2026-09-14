import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertReason } from "@/lib/audit/write-audit";
import { assertCan } from "@/lib/auth/can";
import { assertCanEditListing } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { Prisma, type PrismaClient } from "@/lib/db/generated/client";
import type { CredentialRejectReason, CredentialReview } from "@/lib/db/generated/enums";
import {
  compareCredential,
  mayDecide,
  mayVerify,
  supportedReasons,
  type Comparison,
  type Submitted,
} from "./compare";
import { fetchTaxAgent, normaliseTaan, registerConfigured } from "./fta";
import { parseRegisterFetch, REGISTER_RETRY_MS, type RegisterFetch } from "./register-fetch";

/**
 * Board `4c-s` — a credential reviewed against the register that issued it.
 *
 * ## The machine settles what it can
 *
 * *Where the register has an API this should be mostly automatic, and the human
 * queue should hold only what the machine could not settle.* So a credential
 * whose read matches on all three fields and names the same licence is
 * verified by the read itself, at submission or on the sweep's retry, and never
 * reaches a person (`settleByRead`). What reaches the queue is what did not
 * match: the register did not answer, a near-match on the name, a number that
 * resolves to somebody else, a register that says lapsed, a certificate that
 * contradicts an active entry.
 *
 * ## A person decides the review, never the tier
 *
 * `verifyCredential`, `rejectCredential` and `requestClearerDocument` are the
 * three decisions, each a `staffMutation` with the reviewer's own words and the
 * register read attached (B11). The tier follows the review — a CHECK in the
 * migration holds them together — and nothing here takes a tier as input.
 *
 * ## A refetch is evidence, not a decision
 *
 * `refetchRegister` replaces the stored read and changes nothing else — no
 * review state, no tier, no verification even where the fresh read now matches.
 * It writes no audit row for that reason: it is a lookup a reviewer asked for,
 * and the decision taken after it carries the read it was taken against. A
 * staff click that verified by side effect would be a decision with no reason.
 *
 * ## Nothing is withheld, so nothing is released
 *
 * The board's card says approval publishes two withheld services, and `B7`
 * wants that in the same transaction. No service on this platform waits on a
 * credential: `mayPublish()` returns `true` unconditionally and a test asserts
 * the absence, and `8b-s`, `3f-s` and `4e-s` all took that line. `4c-s` Q2 asks
 * whether a credential should gate publishing, and that is a decision rather
 * than a build. `unlocksFor` therefore says what a verification actually
 * changes, and says plainly that nothing was waiting on it.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export const OPEN_REVIEWS: readonly CredentialReview[] = ["pending", "more_info"];

export const REVIEW_SELECT = {
  id: true,
  businessId: true,
  kind: true,
  identifier: true,
  issuer: true,
  expiresOn: true,
  trust: true,
  verifiedOn: true,
  verifiedBy: true,
  review: true,
  reviewOpenedAt: true,
  reviewedAt: true,
  reviewNote: true,
  rejectReason: true,
  resubmittedAt: true,
  registerFetch: true,
  registerFetchedAt: true,
  createdAt: true,
  document: { select: { id: true, filename: true, bytes: true } },
  reviewedBy: { select: { fullName: true } },
  business: {
    select: {
      id: true,
      displayName: true,
      slug: true,
      tradeName: true,
      licenceNumber: true,
      licenceAuthority: true,
      publishedAt: true,
    },
  },
} satisfies Prisma.CredentialSelect;

export type ReviewRow = Prisma.CredentialGetPayload<{ select: typeof REVIEW_SELECT }>;

export function submittedOf(row: {
  identifier: string | null;
  expiresOn: Date | null;
  business: { tradeName: string; licenceNumber: string; licenceAuthority: string };
}): Submitted {
  return {
    identifier: row.identifier,
    name: row.business.tradeName,
    expiresOn: row.expiresOn,
    licenceNumber: row.business.licenceNumber,
    licenceAuthority: row.business.licenceAuthority,
  };
}

export function comparisonOf(
  row: Parameters<typeof submittedOf>[0] & { registerFetch: Prisma.JsonValue | null },
  now: Date,
): Comparison {
  return compareCredential(submittedOf(row), parseRegisterFetch(row.registerFetch), now);
}

/* ── The machine's half ────────────────────────────────────────────────────── */

export interface Settlement {
  review: CredentialReview;
  trust: "register_verified" | "seller_claim";
  verifiedOn: Date | null;
  verifiedBy: string | null;
  registerFetch: RegisterFetch;
  comparison: Comparison;
}

/**
 * What one read settles, for a credential with no person's decision pending on
 * it: verified where everything matches, otherwise waiting for a person.
 */
export function settleByRead(submitted: Submitted, read: RegisterFetch, now: Date): Settlement {
  const comparison = compareCredential(submitted, read, now);
  const verified = mayVerify(comparison);
  return {
    review: verified ? "auto_verified" : "pending",
    trust: verified ? "register_verified" : "seller_claim",
    verifiedOn: verified ? now : null,
    verifiedBy: verified ? read.source : null,
    registerFetch: read,
    comparison,
  };
}

class ReviewRaced extends Error {
  constructor() {
    super("credential review changed concurrently");
    this.name = "ReviewRaced";
  }
}

/**
 * The hourly retry — reads the register did not answer, and credentials saved
 * before a register was configured.
 *
 * No actor, no audit row: a lookup that runs on a schedule and verifies only
 * where every field matches is the machine settling what it can, the same
 * statement a read at submission makes. A row somebody has asked the seller
 * about (`more_info`) is left alone; it is waiting on the seller, not the FTA.
 *
 * Bounded, and oldest first, so a register that is down for a day costs one
 * batch an hour rather than every row every hour.
 */
export async function retryRegisterReads(now = new Date(), limit = 50): Promise<{ read: number; verified: number; skipped: string | null }> {
  if (!registerConfigured()) return { read: 0, verified: 0, skipped: "not_configured" };
  const retryBefore = new Date(now.getTime() - REGISTER_RETRY_MS);

  /*
     Raw, for the one condition Prisma cannot say: an identifier shaped like an
     agent number. A malformed one can never be asked about, and selecting it
     would put the same unaskable rows at the head of every batch for ever.
  */
  const ids = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "credential"
     WHERE "kind" = 'fta_tax_agent'
       AND "trust" = 'seller_claim'
       AND regexp_replace(COALESCE("identifier", ''), '[\\s-]', '', 'g') ~ '^[0-9]{4,15}$'
       AND (
         ("review" IS NULL AND "register_fetched_at" IS NULL)
         OR ("review" = 'pending' AND (
               "register_fetched_at" IS NULL
               OR ("register_fetch"->>'outcome' = 'unavailable' AND "register_fetched_at" < ${retryBefore})
             ))
       )
     ORDER BY COALESCE("review_opened_at", "created_at") ASC, "id" ASC
     LIMIT ${limit}
  `);

  let read = 0;
  let verified = 0;
  for (const { id } of ids) {
    const row = await prisma.credential.findUnique({ where: { id }, select: REVIEW_SELECT });
    const asked = row?.identifier ? normaliseTaan(row.identifier) : null;
    if (!row || asked === null) continue;
    const settlement = settleByRead(submittedOf(row), await fetchTaxAgent(asked, now), now);
    const { count } = await prisma.credential.updateMany({
      where: { id: row.id, review: row.review, registerFetchedAt: row.registerFetchedAt, trust: "seller_claim" },
      data: {
        review: settlement.review,
        reviewOpenedAt: row.reviewOpenedAt ?? now,
        trust: settlement.trust,
        verifiedOn: settlement.verifiedOn,
        verifiedBy: settlement.verifiedBy,
        registerFetch: settlement.registerFetch as unknown as Prisma.InputJsonValue,
        registerFetchedAt: now,
      },
    });
    if (count === 0) continue;
    read += 1;
    if (settlement.review === "auto_verified") verified += 1;
  }
  return { read, verified, skipped: null };
}

/* ── The reviewer's half ───────────────────────────────────────────────────── */

export type ReviewError =
  | "not_found"
  | "not_pending"
  | "register_unread"
  | "register_disagrees"
  | "reason_unsupported"
  | "not_configured";

export type ReviewResult = { ok: true } | { ok: false; error: ReviewError };

async function loadOpen(credentialId: string, db: Db = prisma) {
  const row = await db.credential.findUnique({ where: { id: credentialId }, select: REVIEW_SELECT });
  if (!row) return { row: null, error: "not_found" as const };
  if (row.review === null || !OPEN_REVIEWS.includes(row.review)) return { row: null, error: "not_pending" as const };
  return { row, error: null };
}

/**
 * Ask the register again. Evidence only — see the file's note.
 *
 * Refused where the credential is not open, so a reviewer cannot rewrite the
 * read a past decision was taken against.
 */
export async function refetchRegister(
  input: { actor: Actor; credentialId: string },
  now = new Date(),
): Promise<ReviewResult> {
  assertCan(input.actor, "queue.decide");
  if (!registerConfigured()) return { ok: false, error: "not_configured" };
  const { row, error } = await loadOpen(input.credentialId);
  if (!row) return { ok: false, error };
  const asked = row.identifier ? normaliseTaan(row.identifier) : null;
  if (asked === null) return { ok: false, error: "not_pending" };

  const read = await fetchTaxAgent(asked, now);
  const { count } = await prisma.credential.updateMany({
    where: { id: row.id, review: row.review, registerFetchedAt: row.registerFetchedAt },
    data: { registerFetch: read as unknown as Prisma.InputJsonValue, registerFetchedAt: now },
  });
  return count === 0 ? { ok: false, error: "not_pending" } : { ok: true };
}

interface DecisionInput {
  actor: Actor;
  credentialId: string;
  reason: string;
}

/** Runs one decision against the row as it was read, and reports a lost race as one. */
async function decide(
  row: ReviewRow,
  input: DecisionInput,
  action: "queue_decided" | "queue_docs_requested",
  data: Prisma.CredentialUncheckedUpdateManyInput,
  after: Record<string, unknown>,
): Promise<ReviewResult> {
  let raced = false;
  await prisma
    .$transaction(async (tx) =>
      staffMutation(
        {
          actor: input.actor,
          capability: "queue.decide",
          action,
          subject: `Credential:${row.id}`,
          reason: input.reason,
          tx,
        },
        async () => {
          const { count } = await tx.credential.updateMany({
            // The read the reviewer saw is the read this decides against.
            where: { id: row.id, review: row.review, registerFetchedAt: row.registerFetchedAt },
            data,
          });
          if (count === 0) {
            raced = true;
            throw new ReviewRaced();
          }
          return {
            result: null,
            before: { review: row.review, trust: row.trust, rejectReason: row.rejectReason },
            // B11: the register's own answer rides with the decision it justified.
            after: { ...after, registerFetch: row.registerFetch },
          };
        },
      ),
    )
    .catch((error) => {
      if (error instanceof ReviewRaced) return null;
      throw error;
    });
  return raced ? { ok: false, error: "not_pending" } : { ok: true };
}

/** B3. Only against a fresh read where all three match and the licence names the same entity. */
export async function verifyCredential(input: DecisionInput, now = new Date()): Promise<ReviewResult> {
  assertCan(input.actor, "queue.decide");
  assertReason("queue_decided", input.reason);
  const { row, error } = await loadOpen(input.credentialId);
  if (!row) return { ok: false, error };

  const comparison = comparisonOf(row, now);
  if (!mayDecide(comparison)) return { ok: false, error: "register_unread" };
  if (!mayVerify(comparison)) return { ok: false, error: "register_disagrees" };
  const read = parseRegisterFetch(row.registerFetch)!;

  return decide(
    row,
    input,
    "queue_decided",
    {
      review: "verified",
      trust: "register_verified",
      verifiedOn: now,
      verifiedBy: read.source,
      rejectReason: null,
      reviewedAt: now,
      reviewedById: input.actor.id,
      reviewNote: input.reason.trim(),
    },
    { review: "verified", trust: "register_verified" },
  );
}

/**
 * B5. One of the four reasons, and only one the read supports — the seller reads
 * it verbatim and can act on every one of them.
 */
export async function rejectCredential(
  input: DecisionInput & { rejectReason: CredentialRejectReason },
  now = new Date(),
): Promise<ReviewResult> {
  assertCan(input.actor, "queue.decide");
  assertReason("queue_decided", input.reason);
  const { row, error } = await loadOpen(input.credentialId);
  if (!row) return { ok: false, error };

  const comparison = comparisonOf(row, now);
  if (!mayDecide(comparison)) return { ok: false, error: "register_unread" };
  if (!supportedReasons(comparison, row.document !== null).has(input.rejectReason)) {
    return { ok: false, error: "reason_unsupported" };
  }

  return decide(
    row,
    input,
    "queue_decided",
    {
      review: "rejected",
      rejectReason: input.rejectReason,
      reviewedAt: now,
      reviewedById: input.actor.id,
      reviewNote: input.reason.trim(),
    },
    { review: "rejected", rejectReason: input.rejectReason },
  );
}

/**
 * B6. A state, not an email: the credential stays in the queue as `more_info`,
 * the seller's screen offers the re-upload, and the clock that started when it
 * entered review keeps running.
 */
export async function requestClearerDocument(input: DecisionInput, now = new Date()): Promise<ReviewResult> {
  assertCan(input.actor, "queue.decide");
  assertReason("queue_docs_requested", input.reason);
  const { row, error } = await loadOpen(input.credentialId);
  if (!row) return { ok: false, error };
  if (!mayDecide(comparisonOf(row, now))) return { ok: false, error: "register_unread" };

  return decide(
    row,
    input,
    "queue_docs_requested",
    { review: "more_info", reviewedAt: now, reviewedById: input.actor.id, reviewNote: input.reason.trim() },
    { review: "more_info" },
  );
}

/* ── The seller's half ─────────────────────────────────────────────────────── */

export interface ResubmitInput {
  identifier: string;
  /** `yyyy-mm-dd`, or empty for none. */
  expiresOn: string;
  /** A document this business owns, replacing the one on the credential. */
  documentId: string | null;
}

export type ResubmitResult =
  | { ok: true; review: CredentialReview; replacedDocumentId: string | null }
  | { ok: false; reason: "not_found" | "not_open" };

/**
 * The seller answers a request or a rejection: a retyped number, a clearer
 * scan, a renewed date. The read runs again at once, so a fixed typo verifies
 * on the spot and a person is asked only if it still does not match.
 *
 * The clock: an answer to a request for a clearer document keeps the clock the
 * request found (`4c-s` B6). An answer to a rejection is a new submission — the
 * earlier one was decided — so it starts again.
 */
export async function resubmitCredential(
  actor: Actor,
  businessId: string,
  credentialId: string,
  input: ResubmitInput,
  now = new Date(),
): Promise<ResubmitResult> {
  assertCanEditListing(actor);
  const row = await prisma.credential.findFirst({ where: { id: credentialId, businessId }, select: REVIEW_SELECT });
  if (!row) return { ok: false, reason: "not_found" };
  if (row.review !== "more_info" && row.review !== "rejected") return { ok: false, reason: "not_open" };

  const identifier = input.identifier.trim().slice(0, 200) || row.identifier;
  const expiresOn = /^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn.trim())
    ? new Date(`${input.expiresOn.trim()}T00:00:00.000Z`)
    : null;
  const documentId = input.documentId
    ? ((await prisma.document.findFirst({ where: { id: input.documentId, businessId }, select: { id: true } }))?.id ?? null)
    : null;

  const asked = identifier ? normaliseTaan(identifier) : null;
  const submitted = submittedOf({ identifier, expiresOn, business: row.business });
  const read = asked === null ? null : await fetchTaxAgent(asked, now);
  /*
     A number that is not an agent number any more cannot be asked about, and it
     cannot sit in review either — the CHECK allows a review only on the
     checkable kind, and a person has nothing to compare. It waits in the queue
     as a read that did not happen, which the screen states, until the seller
     types one that can be asked.
  */
  const settlement = read ? settleByRead(submitted, read, now) : null;
  const opened = row.review === "rejected" ? now : (row.reviewOpenedAt ?? now);

  const { count } = await prisma.credential.updateMany({
    where: { id: row.id, review: row.review },
    data: {
      identifier,
      expiresOn,
      ...(documentId ? { documentId } : {}),
      review: settlement?.review ?? "pending",
      reviewOpenedAt: opened,
      rejectReason: null,
      resubmittedAt: now,
      trust: settlement?.trust ?? "seller_claim",
      verifiedOn: settlement?.verifiedOn ?? null,
      verifiedBy: settlement?.verifiedBy ?? null,
      registerFetch: settlement ? (settlement.registerFetch as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      registerFetchedAt: settlement ? now : null,
    },
  });
  if (count === 0) return { ok: false, reason: "not_open" };
  return {
    ok: true,
    review: settlement?.review ?? "pending",
    replacedDocumentId: documentId && row.document && row.document.id !== documentId ? row.document.id : null,
  };
}

/* ── Reading one, for the screen ───────────────────────────────────────────── */

export interface Unlocks {
  /** Whether a buyer can see the listing at all. */
  published: boolean;
  slug: string;
  /** Live services — none of which waits on this. */
  liveServices: number;
  /** Open proposals that name this firm on a buyer's comparison. */
  openProposals: number;
}

/**
 * What a verification changes, counted. Never what it would release, because
 * nothing on this platform waits on a credential — see the file's note.
 */
export async function unlocksFor(businessId: string, db: Db = prisma): Promise<Unlocks> {
  const [business, liveServices, openProposals] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: { slug: true, publishedAt: true } }),
    db.service.count({ where: { businessId, status: "live" } }),
    db.quote.count({
      where: {
        businessId,
        proposal: { isNot: null },
        status: { in: ["sent", "read"] },
        // Still being compared: nobody has accepted a quote on it yet.
        enquiry: { contactReleasedAt: null },
      },
    }),
  ]);
  return { published: business?.publishedAt != null, slug: business?.slug ?? "", liveServices, openProposals };
}

export async function credentialReviewFor(credentialId: string, now = new Date()) {
  const row = await prisma.credential.findUnique({ where: { id: credentialId }, select: REVIEW_SELECT });
  if (!row) return null;
  return { row, comparison: comparisonOf(row, now), unlocks: await unlocksFor(row.businessId) };
}
