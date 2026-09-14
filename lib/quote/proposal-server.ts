import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { descendantsOf } from "@/lib/enquiry/service";
import { t } from "@/lib/i18n";
import { onQuoteSent } from "@/lib/notify/events";
import { replyDueAt } from "@/lib/leads/inbox";
import { familyFor } from "@/lib/services/service";
import { recordEvent } from "@/lib/telemetry/record";
import { draftRef, nextRevisionFor } from "./draft";
import { quoteFence, type QuoteFenceReason } from "./fence";
import { lockQuoteFence, readQuoteFence } from "./fence-server";
import { quoteFenceMessage } from "./fence-words";
import {
  PROPOSAL_DEFAULT_VALIDITY_DAYS,
  checkProposal,
  cleanText,
  draftProposal,
  type ProposalInput,
  type ProposalRefusal,
} from "./proposal";
import { VALIDITY_CHOICES, nextQuoteRef } from "./send-quote";
import { workEnquiryOf, type WorkEnquiry } from "./work-enquiry";

/**
 * Board `3j-s` — writing a proposal.
 *
 * The services counterpart of `send-quote.ts` and `draft.ts`, and deliberately
 * the same shape: a draft is the next revision held on a `draft` quote row, a
 * send promotes that row, the fence is read first and again under the enquiry's
 * row lock, the recipient is marked `quoted` and the first reply stamped once.
 * The only difference is what sits on the row — one `QuoteProposal` where a
 * goods quote has lines.
 *
 * ## Which enquiries this answers
 *
 * **An enquiry for work**: a brief from `1h-s`, or an enquiry whose line named a
 * service (`1d-s`, `1g-s`). `sendQuoteForBusiness` refuses both since this
 * board, so a work enquiry has exactly one way to be answered and it carries no
 * line (B2).
 *
 * ## The fee basis is read, never chosen (B1)
 *
 * The seller picks which of their services the proposal answers from — a firm
 * with two Hard FM services has two scope sheets — and the basis comes with the
 * service. There is no input that carries a basis, so there is nothing to
 * validate against a family and nothing to forge. A service with no basis, or a
 * basis its family no longer offers, blocks the send and routes to `3g-s`
 * (acceptance criterion 8): the basis cannot be invented here.
 */

/* ── The services it may answer from ─────────────────────────────────────── */

/** One of the seller's services, as the composer offers it. */
export interface ProposalService {
  id: string;
  name: string;
  status: string;
  /** Whether the buyer named this one — it is offered first. */
  named: boolean;
  feeBasis: string | null;
  /** The family's words for the basis, when it still offers it. */
  feeBasisLabel: string | null;
  /**
   * `ok`, or why the proposal cannot be sent from this sheet. `stale_basis` is
   * `3g-s`'s *moved trade* state: a key the service's family no longer offers.
   */
  basis: "ok" | "no_basis" | "stale_basis";
  scope: string | null;
  deliverable: string | null;
  deliveredWhere: string | null;
  excluded: string | null;
}

/**
 * The seller's services a proposal on this enquiry may answer from.
 *
 * The same trade tree the brief matcher routed on (`descendantsOf`), plus any
 * service of theirs the buyer named. Drafts are included and say so: the basis
 * is the scope sheet's whether or not the sheet is published, and hiding a
 * draft would send a firm to create a duplicate of a service they already have.
 *
 * Named first, then live before draft, then the seller's own order.
 */
export async function proposalServicesFor(
  businessId: string,
  work: WorkEnquiry,
): Promise<ProposalService[]> {
  const [tree, business] = await Promise.all([
    descendantsOf(work.categoryId),
    prisma.business.findUnique({ where: { id: businessId }, select: { scopeSheetFamilyId: true } }),
  ]);

  const rows = await prisma.service.findMany({
    where: {
      businessId,
      OR: [{ categoryId: { in: tree } }, { id: { in: work.namedServiceIds } }],
    },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      status: true,
      categoryId: true,
      feeBasis: true,
      scope: true,
      deliverable: true,
      deliveredWhere: true,
      excluded: true,
    },
  });

  // One family read per distinct trade — usually one.
  const families = new Map<string, Awaited<ReturnType<typeof familyFor>>>();
  for (const categoryId of new Set(rows.map((row) => row.categoryId))) {
    families.set(categoryId, await familyFor(categoryId, business?.scopeSheetFamilyId ?? null));
  }

  const named = new Set(work.namedServiceIds);
  const services = rows.map((row): ProposalService => {
    const basis = row.feeBasis
      ? families.get(row.categoryId)?.feeBases.find((option) => option.key === row.feeBasis) ?? null
      : null;
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      named: named.has(row.id),
      feeBasis: row.feeBasis,
      feeBasisLabel: basis?.label ?? null,
      basis: row.feeBasis === null ? "no_basis" : basis ? "ok" : "stale_basis",
      scope: row.scope,
      deliverable: row.deliverable,
      deliveredWhere: row.deliveredWhere ? t(`delivered.${row.deliveredWhere}` as "delivered.on_site") : null,
      excluded: row.excluded,
    };
  });

  // A stable sort over an order that already ends on the id.
  return services.sort(
    (a, b) => Number(b.named) - Number(a.named) || Number(b.status === "live") - Number(a.status === "live"),
  );
}

/** The draft in progress on a work enquiry, with its proposal. */
export async function findProposalDraft(enquiryId: string, businessId: string) {
  return prisma.quote.findFirst({
    where: { enquiryId, businessId, status: "draft" },
    orderBy: { revision: "desc" },
    select: {
      id: true,
      revision: true,
      validityDays: true,
      updatedAt: true,
      proposal: true,
    },
  });
}

/* ── Autosave ────────────────────────────────────────────────────────────── */

export type SaveProposalResult =
  | { ok: true; savedAt: Date }
  | { ok: false; error: "not_your_enquiry" | "not_work" | "not_your_service" }
  | { ok: false; error: "fenced"; reason: QuoteFenceReason; closesAt: Date };

/**
 * Save what is typed so far.
 *
 * Tolerant, as the goods draft is: a half-typed fee is kept as not stated rather
 * than refused, because autosave runs while somebody is typing. It never
 * stamps a first reply, never moves the recipient's state and never notifies —
 * a seller halfway through a proposal has not replied to anything.
 */
export async function saveProposalDraft(
  actor: Actor,
  businessId: string,
  input: ProposalInput & { enquiryId: string },
): Promise<SaveProposalResult> {
  assertCan(actor, "quote.send");

  const fence = await readQuoteFence(prisma, input.enquiryId, businessId);
  if (!fence) return { ok: false, error: "not_your_enquiry" };
  const refusal = quoteFence(fence, new Date());
  if (refusal) return { ok: false, error: "fenced", reason: refusal, closesAt: fence.closesAt };

  const work = await workEnquiryOf(prisma, input.enquiryId);
  if (!work) return { ok: false, error: "not_work" };

  const services = await proposalServicesFor(businessId, work);
  const service = input.serviceId ? services.find((row) => row.id === input.serviceId) : null;
  if (input.serviceId && !service) return { ok: false, error: "not_your_service" };

  const values = draftProposal(input);
  const validityDays = validityOf(input.validityDays);
  const proposal = {
    serviceId: service?.id ?? null,
    serviceName: service?.name ?? "",
    // The basis is copied at send, not at draft: B1 reads it from the service,
    // and a draft that froze it would send a stale one after a `3g-s` edit.
    feeBasis: null,
    feeBasisLabel: null,
    ...values,
  };

  const now = new Date();
  const existing = await findProposalDraft(input.enquiryId, businessId);

  if (existing) {
    await prisma.$transaction(async (tx) => {
      // A draft started by the goods composer before this board has lines; a
      // proposal has none, and the trigger refuses the two together.
      await tx.quoteLine.deleteMany({ where: { quoteId: existing.id } });
      await tx.quoteProposal.upsert({
        where: { quoteId: existing.id },
        create: { quoteId: existing.id, ...proposal },
        update: proposal,
      });
      await tx.quote.update({
        where: { id: existing.id },
        data: { validityDays, note: null, paymentTerms: null, delivery: null, updatedAt: now },
      });
    });
    return { ok: true, savedAt: now };
  }

  const revision = await nextRevisionFor(input.enquiryId, businessId);
  await prisma.quote.create({
    data: {
      ref: draftRef(input.enquiryId, businessId, revision),
      enquiryId: input.enquiryId,
      businessId,
      revision,
      validityDays,
      status: "draft",
      proposal: { create: proposal },
    },
  });
  return { ok: true, savedAt: now };
}

/* ── Sending ─────────────────────────────────────────────────────────────── */

export type SendProposalResult =
  | { ok: true; quoteId: string; quoteRef: string; revision: number }
  | { ok: false; error: string; refusals?: ProposalRefusal[] };

export async function sendProposal(
  actor: Actor,
  businessId: string,
  input: ProposalInput & { enquiryId: string },
): Promise<SendProposalResult> {
  assertCan(actor, "quote.send");

  const recipient = await prisma.enquiryRecipient.findUnique({
    where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId } },
    select: {
      firstReplyAt: true,
      createdAt: true,
      business: { select: { leadEscalationMinutes: true } },
    },
  });
  // Not a recipient and no such enquiry give the same answer.
  if (!recipient) return { ok: false, error: t("quote.error.not_your_enquiry") };

  const now = new Date();
  const early = await readQuoteFence(prisma, input.enquiryId, businessId);
  if (!early) return { ok: false, error: t("quote.error.not_your_enquiry") };
  const earlyRefusal = quoteFence(early, now);
  if (earlyRefusal) return { ok: false, error: quoteFenceMessage(earlyRefusal, early.closesAt) };

  const work = await workEnquiryOf(prisma, input.enquiryId);
  if (!work) return { ok: false, error: t("proposal.error.not_work") };

  const refusals: ProposalRefusal[] = [];
  const services = await proposalServicesFor(businessId, work);
  const service = input.serviceId ? services.find((row) => row.id === input.serviceId) ?? null : null;
  if (!service) refusals.push({ field: "service", code: "required" });
  else if (service.basis !== "ok") refusals.push({ field: "service", code: service.basis });

  const checked = checkProposal(input);
  if (!checked.ok) refusals.push(...checked.refusals);
  if (refusals.length > 0 || !checked.ok || !service || !service.feeBasis || !service.feeBasisLabel) {
    return { ok: false, error: t("proposal.error.fix_fields"), refusals };
  }

  const validityDays = validityOf(input.validityDays);
  const draft = await findProposalDraft(input.enquiryId, businessId);
  const expiresAt = new Date(now.getTime() + validityDays * 86_400_000);
  const enquiry = await prisma.enquiry.findUniqueOrThrow({
    where: { id: input.enquiryId },
    select: { revision: true },
  });

  const proposal = {
    serviceId: service.id,
    serviceName: service.name,
    feeBasis: service.feeBasis,
    feeBasisLabel: service.feeBasisLabel,
    ...checked.value,
  };
  const quoteData = {
    againstRevision: enquiry.revision,
    validityDays,
    status: "sent" as const,
    sentAt: now,
    expiresAt,
    note: null,
    paymentTerms: null,
    delivery: null,
  };

  const sent = await prisma.$transaction(async (tx) => {
    // The fence again, under the enquiry's row lock — see `lockQuoteFence`.
    const locked = await lockQuoteFence(tx, input.enquiryId, businessId);
    if (!locked) return { ok: false as const, error: t("quote.error.not_your_enquiry") };
    const refusal = quoteFence(locked, now);
    if (refusal) return { ok: false as const, error: quoteFenceMessage(refusal, locked.closesAt) };

    /*
       The revision and its reference are decided under the lock, not before it.
       Two sends with no draft between them — two tabs, a double tap — would
       otherwise both read revision 1 and the second would die on the unique
       `(enquiry, business, revision)` as a 500. Serialised by the lock, the
       second reads the first's commit and is revision 2.
    */
    const revision = draft?.revision ?? (await nextRevisionIn(tx, input.enquiryId, businessId));
    const ref = await nextQuoteRef(input.enquiryId, businessId, revision);

    let row: { id: string; ref: string; revision: number };
    if (draft) {
      // Two sends from two tabs both found this draft. The first promoted it;
      // the second must not write over a proposal the buyer already holds.
      const still = await tx.quote.findUnique({ where: { id: draft.id }, select: { status: true } });
      if (still?.status !== "draft") {
        return { ok: false as const, error: t("proposal.error.already_sent") };
      }
      /*
         Promote. The proposal is written **before** the status moves, in this
         order on purpose: `quote_proposal_immutable` refuses any update to a
         proposal whose quote has left `draft`, and that includes this one a
         statement later.
      */
      await tx.quoteLine.deleteMany({ where: { quoteId: draft.id } });
      await tx.quoteProposal.upsert({
        where: { quoteId: draft.id },
        create: { quoteId: draft.id, ...proposal },
        update: proposal,
      });
      row = await tx.quote.update({
        where: { id: draft.id },
        data: { ...quoteData, ref },
        select: { id: true, ref: true, revision: true },
      });
    } else {
      row = await tx.quote.create({
        data: {
          ...quoteData,
          ref,
          enquiryId: input.enquiryId,
          businessId,
          revision,
          proposal: { create: proposal },
        },
        select: { id: true, ref: true, revision: true },
      });
    }

    await tx.enquiryRecipient.update({
      where: { enquiryId_businessId: { enquiryId: input.enquiryId, businessId } },
      data: {
        state: "quoted",
        // Response time is measured, never claimed: stamped once, here or by
        // the goods send, and never by a draft.
        ...(recipient.firstReplyAt === null ? { firstReplyAt: now } : {}),
      },
    });

    return { ok: true as const, quoteId: row.id, quoteRef: row.ref, revision: row.revision };
  });

  if (!sent.ok) return sent;

  await onQuoteSent({ enquiryId: input.enquiryId, businessId, revision: sent.revision });

  const due = replyDueAt(recipient.createdAt, recipient.business.leadEscalationMinutes);
  await recordEvent({
    name: "proposal_sent",
    businessId,
    actorId: actor.id,
    props: {
      revision: sent.revision,
      validityDays,
      termStated: checked.value.termMonths !== null,
      mobilisationStated: checked.value.mobilisationAed !== null,
      scopeEdited: checked.value.scope !== cleanText(service.scope ?? ""),
      exclusionsEdited: (checked.value.exclusions ?? "") !== cleanText(service.excluded ?? ""),
      // The first reply is what falls due. A revision is never late.
      late: recipient.firstReplyAt === null && now.getTime() > due.getTime(),
      hoursSinceReceipt: Math.round((now.getTime() - recipient.createdAt.getTime()) / 3_600_000),
    },
  });

  return sent;
}

/** `nextRevisionFor`, read inside the transaction that holds the enquiry's lock. */
async function nextRevisionIn(tx: Prisma.TransactionClient, enquiryId: string, businessId: string): Promise<number> {
  const previous = await tx.quote.findFirst({
    where: { enquiryId, businessId, status: { not: "draft" } },
    orderBy: { revision: "desc" },
    select: { revision: true },
  });
  return (previous?.revision ?? 0) + 1;
}

/** The window, from the composer's own list; anything else is the proposal default. */
function validityOf(days: number): number {
  return VALIDITY_CHOICES.includes(days as (typeof VALIDITY_CHOICES)[number])
    ? days
    : PROPOSAL_DEFAULT_VALIDITY_DAYS;
}
