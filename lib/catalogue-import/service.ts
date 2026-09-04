import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { can } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import type { $Enums } from "@/lib/db/generated/client";
import {
  CATALOGUE_ACCEPT,
  CONCIERGE_PRODUCT_LIMIT,
  CONCIERGE_SLA_WORKING_DAYS,
  MAX_CATALOGUE_BYTES,
  readCataloguePricing,
  termsFor,
  workingDaysFrom,
} from "./pricing";

/**
 * The concierge catalogue load — "send us your price list and we will key it in".
 *
 * A queue, not a parser. `lib/import/service.ts` is the parser and it needs a
 * spreadsheet with columns; this is for the PDF a supplier has had since 2019,
 * and the work at the other end is a person reading it. Modelled on
 * `lib/visits/service.ts`, which is the same shape of promise: the seller asks,
 * somebody does something physical, and the row is what either side points at.
 *
 * ## Who writes an audit row, and who does not
 *
 * Every staff move here writes one with a written reason — CLAUDE.md
 * non-negotiable 3, and the schema's own doc comment on
 * `CatalogueImportRequest` repeats it. The seller's create and cancel write
 * none: they are the subject acting on their own data, which is the thing the
 * audit log exists to distinguish itself from.
 *
 * ## The capability the staff moves are gated on
 *
 * `queue.decide` — moderator or ops lead, `docs/permissions.md` §07's "Approve
 * listings & edits". It is the nearest existing row and it is a good fit:
 * working a queue of seller submissions is what it names, and the audit action
 * it maps to, `queue_decided`, describes what happens here without stretching.
 * A `catalogue.load` capability of its own would need a `docs/permissions.md`
 * row and a change to the permission-matrix test, neither of which this module
 * owns.
 *
 * ## The fee is frozen, and that is the point
 *
 * `feeAed` is stamped onto the row at the moment of asking. A price read back
 * later is a different price, and the seller agreed to the one on the screen
 * they were looking at.
 */

export type CatalogueImportStatus = $Enums.CatalogueImportStatus;

/** The states a request is still somebody's work. */
const OPEN_STATUSES = ["requested", "in_progress"] as const satisfies readonly CatalogueImportStatus[];

// ─────────────────────────────────────────────────────────────────────────────
// What the seller sees
// ─────────────────────────────────────────────────────────────────────────────

export interface ConciergeRequest {
  id: string;
  status: CatalogueImportStatus;
  /** Frozen at the moment of asking. Zero where the plan included it. */
  feeAed: number;
  note: string | null;
  /** The file the seller sent, by name. Never a link — see below. */
  filename: string | null;
  requestedAt: Date;
  dueAt: Date | null;
  productsLoaded: number | null;
  loadedAt: Date | null;
}

export interface ConciergeOffer {
  /**
   * Whether the panel renders at all. The caller decides — the setup hub reads
   * this and omits the card, rather than the card rendering an empty box that
   * says a seller cannot have something.
   */
  offered: boolean;
  planId: string | null;
  planName: string | null;
  /** Whole dirhams, from the platform setting. Zero where the plan includes it. */
  feeAed: number;
  /** How many products we promise to key in — never more than the plan holds. */
  productLimit: number;
  slaWorkingDays: number;
  maxBytes: number;
  /** The `accept` attribute for the file input. */
  accept: string;
  /** The most recent request that was not withdrawn. */
  request: ConciergeRequest | null;
  /** True while that request is still ours to finish. */
  open: boolean;
}

/**
 * What this seller is offered, and where their last request got to.
 *
 * Reads through `effectiveFor`, not through `Business.planId`, so a
 * grandfathered account keeps the terms it bought: the plan supplies the name
 * and the fee, and the seller's own frozen `productLimit` caps what we promise.
 * Promising fifty products to a seller whose snapshot holds ten would be a
 * number on a screen that the product cannot honour, which is the failure
 * CLAUDE.md's interface-honesty section names first.
 */
export async function conciergeOfferFor(businessId: string): Promise<ConciergeOffer> {
  const [plan, pricing, latest] = await Promise.all([
    effectiveFor(businessId),
    readCataloguePricing(),
    prisma.catalogueImportRequest.findFirst({
      where: { businessId, status: { not: "cancelled" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        feeAed: true,
        note: true,
        dueAt: true,
        productsLoaded: true,
        loadedAt: true,
        createdAt: true,
        document: { select: { filename: true } },
      },
    }),
  ]);

  const terms = termsFor(pricing, plan?.id);
  const request: ConciergeRequest | null = latest
    ? {
        id: latest.id,
        status: latest.status,
        feeAed: latest.feeAed,
        note: latest.note,
        filename: latest.document?.filename ?? null,
        requestedAt: latest.createdAt,
        dueAt: latest.dueAt,
        productsLoaded: latest.productsLoaded,
        loadedAt: latest.loadedAt,
      }
    : null;

  return {
    offered: terms.offered,
    planId: plan?.id ?? null,
    planName: plan?.name ?? null,
    feeAed: terms.feeAed,
    // `null` on the plan is unlimited, so the promise stands at fifty.
    productLimit:
      plan?.productLimit === null || plan?.productLimit === undefined
        ? CONCIERGE_PRODUCT_LIMIT
        : Math.min(CONCIERGE_PRODUCT_LIMIT, plan.productLimit),
    slaWorkingDays: CONCIERGE_SLA_WORKING_DAYS,
    maxBytes: MAX_CATALOGUE_BYTES,
    accept: CATALOGUE_ACCEPT,
    request,
    open: request !== null && (OPEN_STATUSES as readonly string[]).includes(request.status),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The seller's own moves. No audit rows: the subject acting on their own data.
// ─────────────────────────────────────────────────────────────────────────────

export type RequestRefusal =
  | "not_offered"
  | "already_open"
  | "not_your_business"
  | "no_file";

export type RequestCatalogueImportResult =
  | { ok: true; id: string; feeAed: number; dueAt: Date }
  | { ok: false; error: RequestRefusal };

export interface RequestCatalogueImportInput {
  /** A `Document` with `kind: catalogue`, already uploaded to the private bucket. */
  documentId: string;
  /** What the seller said about the file. Not instructions we promise to follow. */
  note?: string | undefined;
}

/**
 * Ask for a catalogue load.
 *
 * Three refusals, and each one is a sentence the seller can act on rather than
 * an exception: the plan does not include it, one is already with us, or this
 * seat does not belong to this business. The capability is checked with `can`
 * rather than `assertCan` for the same reason — a sales seat pressing a button
 * they should not see is a user-facing "not yours", not a stack trace.
 *
 * The document is re-read from the database rather than trusted from the form.
 * A `documentId` in a request body is a claim about whose file it is, and this
 * is the check that makes it one: a row belonging to another business, or of
 * another kind, is not a catalogue this seller sent us.
 */
export async function requestCatalogueImport(
  actor: Actor,
  businessId: string,
  input: RequestCatalogueImportInput,
  now = new Date(),
): Promise<RequestCatalogueImportResult> {
  if (actor.businessId !== businessId || !can(actor, "product.edit")) {
    return { ok: false, error: "not_your_business" };
  }

  const offer = await conciergeOfferFor(businessId);
  if (!offer.offered) return { ok: false, error: "not_offered" };
  /*
     Read-then-write, and there is no unique index under it. Two submits a
     second apart would both pass and leave two rows in the queue — annoying
     for staff, not dangerous, and the honest fix is a partial unique index on
     `(business_id) where status in ('requested','in_progress')`, which is a
     migration this module does not own.
  */
  if (offer.open) return { ok: false, error: "already_open" };

  const document = await prisma.document.findUnique({
    where: { id: input.documentId },
    select: { id: true, businessId: true, kind: true },
  });
  if (!document || document.businessId !== businessId || document.kind !== "catalogue") {
    return { ok: false, error: "no_file" };
  }

  const dueAt = workingDaysFrom(now, CONCIERGE_SLA_WORKING_DAYS);

  const created = await prisma.catalogueImportRequest.create({
    data: {
      businessId,
      requestedById: actor.id,
      documentId: document.id,
      // Frozen here, and read from the row everywhere after. A later change to
      // the platform setting is a change to what the *next* seller is quoted.
      feeAed: offer.feeAed,
      dueAt,
      note: input.note?.trim() || null,
    },
    select: { id: true },
  });

  return { ok: true, id: created.id, feeAed: offer.feeAed, dueAt };
}

export type CancelRefusal = "not_found" | "not_your_business" | "already_started";

export type CancelCatalogueImportResult = { ok: true } | { ok: false; error: CancelRefusal };

/**
 * The seller withdrawing their own request.
 *
 * **No audit row.** The log records decisions staff made about somebody else's
 * listing; a seller taking back a file they sent is not one, and putting it in
 * the same log would make the log harder to read rather than more complete.
 *
 * Only while nobody has started. Once a person is keying the file in, the
 * seller's route is to say so and let staff close the row with a reason —
 * `concierge.in_progress` deliberately offers no cancel control beside it,
 * where `concierge.pending` does.
 */
export async function cancelCatalogueImport(
  actor: Actor,
  id: string,
  now = new Date(),
): Promise<CancelCatalogueImportResult> {
  const request = await prisma.catalogueImportRequest.findUnique({
    where: { id },
    select: { id: true, businessId: true, status: true },
  });
  if (!request) return { ok: false, error: "not_found" };
  if (request.businessId !== actor.businessId || !can(actor, "product.edit")) {
    return { ok: false, error: "not_your_business" };
  }
  if (request.status !== "requested") return { ok: false, error: "already_started" };

  await prisma.catalogueImportRequest.update({
    where: { id: request.id },
    data: { status: "cancelled", cancelledAt: now },
  });

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// The staff moves. Every one writes an AuditEvent with a written reason.
// ─────────────────────────────────────────────────────────────────────────────

export type StaffMoveRefusal = "not_found" | "wrong_status" | "out_of_range";

export type StaffMoveResult = { ok: true } | { ok: false; error: StaffMoveRefusal };

/** A sanity bound on what staff can claim they keyed in. */
const PRODUCTS_CEILING = 10_000;

/** `CatalogueImportRequest:clx123`. Entity and id, so the audit log is greppable. */
function subjectOf(id: string): `${string}:${string}` {
  return `CatalogueImportRequest:${id}`;
}

/**
 * Somebody has picked this up.
 *
 * Audited even though it moves nothing a buyer can see. The queue is shared,
 * and "who started this and when" is the question the second person to open the
 * row is asking.
 */
export async function startCatalogueImport(
  staff: Actor,
  id: string,
  reason: string,
): Promise<StaffMoveResult> {
  const request = await prisma.catalogueImportRequest.findUnique({
    where: { id },
    select: { id: true, status: true, businessId: true },
  });
  if (!request) return { ok: false, error: "not_found" };
  if (request.status !== "requested") return { ok: false, error: "wrong_status" };

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: staff,
        capability: "queue.decide",
        subject: subjectOf(request.id),
        reason,
        tx,
      },
      async () => {
        await tx.catalogueImportRequest.update({
          where: { id: request.id },
          data: { status: "in_progress" },
        });
        return {
          result: undefined,
          before: { status: request.status },
          after: { status: "in_progress", businessId: request.businessId },
        };
      },
    ),
  );

  return { ok: true };
}

export interface CompleteCatalogueImportInput {
  /** How many products went on. Shown back to the seller, so it is counted, not estimated. */
  productsLoaded: number;
  reason: string;
}

/**
 * The products are on the listing.
 *
 * Accepted from `requested` as well as from `in_progress`. Pressing Start is a
 * courtesy to the rest of the team rather than a gate, and refusing a finished
 * load because nobody pressed a button would put a row back in the queue for
 * work that is already done.
 *
 * `productsLoaded` is a count somebody types, and it is the number the seller
 * reads back in `concierge.loaded`. The ceiling is a typo guard, not a policy.
 */
export async function completeCatalogueImport(
  staff: Actor,
  id: string,
  input: CompleteCatalogueImportInput,
  now = new Date(),
): Promise<StaffMoveResult> {
  if (
    !Number.isInteger(input.productsLoaded) ||
    input.productsLoaded < 0 ||
    input.productsLoaded > PRODUCTS_CEILING
  ) {
    return { ok: false, error: "out_of_range" };
  }

  const request = await prisma.catalogueImportRequest.findUnique({
    where: { id },
    select: { id: true, status: true, businessId: true, productsLoaded: true },
  });
  if (!request) return { ok: false, error: "not_found" };
  if (!(OPEN_STATUSES as readonly string[]).includes(request.status)) {
    return { ok: false, error: "wrong_status" };
  }

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: staff,
        capability: "queue.decide",
        subject: subjectOf(request.id),
        reason: input.reason,
        tx,
      },
      async () => {
        await tx.catalogueImportRequest.update({
          where: { id: request.id },
          data: { status: "loaded", productsLoaded: input.productsLoaded, loadedAt: now },
        });
        return {
          result: undefined,
          before: { status: request.status, productsLoaded: request.productsLoaded },
          after: {
            status: "loaded",
            productsLoaded: input.productsLoaded,
            businessId: request.businessId,
          },
        };
      },
    ),
  );

  return { ok: true };
}

/**
 * We are not doing this one.
 *
 * `cancelled` rather than a `rejected` member, because the enum has none and
 * should not grow one: its doc comment says `cancelled` is "either side
 * withdrawing", and a scan nobody can read is us withdrawing. What separates
 * this from the seller's own cancel is the audit row and the written reason on
 * it, which is exactly the distinction the log exists to make.
 */
export async function rejectCatalogueImport(
  staff: Actor,
  id: string,
  reason: string,
  now = new Date(),
): Promise<StaffMoveResult> {
  const request = await prisma.catalogueImportRequest.findUnique({
    where: { id },
    select: { id: true, status: true, businessId: true },
  });
  if (!request) return { ok: false, error: "not_found" };
  if (!(OPEN_STATUSES as readonly string[]).includes(request.status)) {
    return { ok: false, error: "wrong_status" };
  }

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: staff,
        capability: "queue.decide",
        subject: subjectOf(request.id),
        reason,
        tx,
      },
      async () => {
        await tx.catalogueImportRequest.update({
          where: { id: request.id },
          data: { status: "cancelled", cancelledAt: now },
        });
        return {
          result: undefined,
          before: { status: request.status },
          after: { status: "cancelled", businessId: request.businessId },
        };
      },
    ),
  );

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// The staff queue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Catalogues sent and not yet keyed in, oldest first.
 *
 * The due date travels with the row rather than being recomputed here: it was
 * resolved against the working week the seller was quoted, and a queue that
 * recalculates it would quietly move a deadline every time the calendar
 * changed.
 */
export async function openCatalogueImports(limit = 100) {
  const rows = await prisma.catalogueImportRequest.findMany({
    where: { status: { in: [...OPEN_STATUSES] } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      status: true,
      feeAed: true,
      note: true,
      dueAt: true,
      createdAt: true,
      business: {
        select: {
          id: true,
          // Identity is always displayName. A row that named the trade name
          // would send staff to a storefront titled something else.
          displayName: true,
          slug: true,
          plan: { select: { id: true, name: true } },
        },
      },
      document: { select: { id: true, filename: true, storagePath: true } },
    },
  });

  const now = new Date();
  return rows.map((row) => ({
    ...row,
    ageDays: Math.floor((now.getTime() - row.createdAt.getTime()) / 86_400_000),
    late: row.dueAt !== null && row.dueAt.getTime() < now.getTime(),
  }));
}
