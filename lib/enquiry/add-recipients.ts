import "server-only";
import { prisma } from "@/lib/db/client";
import { actorFor } from "@/lib/auth/actor";
import { assertCanCreateEnquiry } from "@/lib/auth/guards";
import { routeLead } from "@/lib/leads/router";
import { sendAutoReplies } from "@/lib/messaging/auto-reply";
import { onEnquiryDelivered } from "@/lib/notify/events";
import { MAX_RECIPIENTS, selectRecipients, type FanoutRequest } from "./fanout";
import { descendantsOf, estimatedValueAed, findFanoutCandidates } from "./service";
import { additionalWanted, enquiryTrade } from "./tracking";

/**
 * Board 1i — *Add two more suppliers*, on an enquiry that has already gone.
 *
 * The tracking page has linked to `/rfq/new?from=ENQ-…` since the board shipped,
 * and nothing read the parameter: the link opened a blank composer, and a buyer
 * who wanted two more quotes on the requirement they had already written was
 * asked to write it again. This is the behaviour the link promised.
 *
 * **The same matcher as the first send, never a looser one.** The trade the
 * enquiry was for, its emirate and its lines go back through
 * `findFanoutCandidates` and `selectRecipients` with every current recipient
 * excluded. Whoever that returns is offered; if it returns nobody, nobody is
 * added and the page says so. Padding to reach two is the one thing the
 * fan-out has refused since board 1h.
 *
 * **The buyer's ticks, intersected, never substituted.** The send re-runs the
 * matcher and keeps only the ticked suppliers it would still offer. A supplier
 * who reached their monthly cap between the preview and the send is dropped and
 * recorded as missed (D4) rather than replaced by whoever ranked next.
 *
 * Goods enquiries only. A brief went to every supplier who covers the site, up
 * to the cap, so there is nobody further to add under `1h-s`'s rules.
 */

export type AddRefusal = "not_found" | "closed" | "accepted" | "brief" | "full";

export interface AdditionalSupplier {
  businessId: string;
  slug: string;
  displayName: string;
  verificationTier: number;
  responseTimeMedianMs: number | null;
}

export type AdditionalState =
  | {
      ok: true;
      enquiryId: string;
      ref: string;
      /** Recipients already on it, every state included. */
      sent: number;
      /** How many the control offered. */
      wanted: number;
      /** At most `wanted`, and possibly none. Never padded. */
      suppliers: AdditionalSupplier[];
    }
  | { ok: false; reason: AddRefusal };

async function loadEnquiry(buyerId: string, refOrId: string) {
  return prisma.enquiry.findFirst({
    // The buyer inside the `where`, so another buyer's reference and an unknown
    // one are the same null — the tracking page's rule.
    where: { OR: [{ ref: refOrId }, { id: refOrId }], buyerId },
    select: {
      id: true,
      ref: true,
      emirate: true,
      closesAt: true,
      contactReleasedToBusinessId: true,
      serviceBrief: { select: { enquiryId: true } },
      lines: {
        select: { qty: true, targetUnitPriceAed: true, product: { select: { categoryId: true } } },
      },
      recipients: {
        select: {
          businessId: true,
          state: true,
          business: { select: { primaryCategoryId: true } },
        },
      },
    },
  });
}

type LoadedEnquiry = NonNullable<Awaited<ReturnType<typeof loadEnquiry>>>;

function refusalFor(enquiry: LoadedEnquiry | null, now: Date): AddRefusal | null {
  if (!enquiry) return "not_found";
  if (enquiry.serviceBrief) return "brief";
  if (enquiry.contactReleasedToBusinessId) return "accepted";
  if (enquiry.closesAt.getTime() <= now.getTime()) return "closed";
  if (enquiry.recipients.length >= MAX_RECIPIENTS) return "full";
  return null;
}

/**
 * What the goods matcher offers now, for this enquiry, excluding everyone on it.
 */
async function matchAdditional(enquiry: LoadedEnquiry, now: Date) {
  /*
     The stored state is the effective one here: a closed enquiry was refused
     above, and while one is open `effectiveState` only relabels a no-response
     that cannot count as declined either way.
  */
  const declined = enquiry.recipients.filter((r) => r.state === "declined").length;
  const wanted = additionalWanted({
    sent: enquiry.recipients.length,
    declined,
    allDeclined: enquiry.recipients.length > 0 && declined === enquiry.recipients.length,
  });

  const trade = enquiryTrade({
    productCategoryIds: enquiry.lines.flatMap((line) => (line.product ? [line.product.categoryId] : [])),
    recipientCategoryIds: enquiry.recipients.map((r) => r.business.primaryCategoryId),
  });
  if (!trade || wanted === 0) {
    return { wanted, selection: { recipients: [], skipped: [] } as ReturnType<typeof selectRecipients> };
  }

  const request: FanoutRequest = {
    categoryId: trade,
    categoryIds: await descendantsOf(trade),
    emirate: enquiry.emirate,
    lineCount: Math.max(1, enquiry.lines.length),
    want: wanted,
  };
  const candidates = await findFanoutCandidates(
    { ...request, excludeBusinessIds: enquiry.recipients.map((r) => r.businessId) },
    now,
  );
  return { wanted, selection: selectRecipients(candidates, request) };
}

export async function additionalSuppliersFor(
  buyerId: string,
  refOrId: string,
  now: Date = new Date(),
): Promise<AdditionalState> {
  const enquiry = await loadEnquiry(buyerId, refOrId);
  const refusal = refusalFor(enquiry, now);
  if (refusal || !enquiry) return { ok: false, reason: refusal ?? "not_found" };

  const { wanted, selection } = await matchAdditional(enquiry, now);
  return {
    ok: true,
    enquiryId: enquiry.id,
    ref: enquiry.ref,
    sent: enquiry.recipients.length,
    wanted,
    suppliers: selection.recipients.map((r) => ({
      businessId: r.businessId,
      slug: r.slug,
      displayName: r.displayName,
      verificationTier: r.verificationTier,
      responseTimeMedianMs: r.responseTimeMedianMs,
    })),
  };
}

export type AddResult =
  | { ok: true; enquiryId: string; ref: string; added: number }
  | { ok: false; reason: AddRefusal | "none_chosen" | "none_available" };

export async function addSuppliers(
  input: { buyerId: string; refOrId: string; chosenBusinessIds: readonly string[] },
  now: Date = new Date(),
): Promise<AddResult> {
  // Build plan 9.4: sending to two more suppliers is sending the enquiry, and
  // asks `enquiry.create` the way the first send does. Throws `PermissionError`.
  assertCanCreateEnquiry(await actorFor(input.buyerId));

  if (input.chosenBusinessIds.length === 0) return { ok: false, reason: "none_chosen" };

  const enquiry = await loadEnquiry(input.buyerId, input.refOrId);
  const refusal = refusalFor(enquiry, now);
  if (refusal || !enquiry) return { ok: false, reason: refusal ?? "not_found" };

  const { selection } = await matchAdditional(enquiry, now);
  const chosen = new Set(input.chosenBusinessIds);
  const adding = selection.recipients.filter((r) => chosen.has(r.businessId)).map((r) => r.businessId);
  if (adding.length === 0) {
    // Record the caps that decided it even so — a missed enquiry is the stack D4 unlocks.
    await recordMissed(enquiry.id, selection.skipped);
    return { ok: false, reason: "none_available" };
  }

  const added = await prisma.$transaction(async (tx) => {
    /*
       The cap, re-counted inside the write and under a lock on the enquiry row.
       Two tabs pressing *Send* would each have counted room for two; without the
       lock both counts run before either insert and the enquiry lands at ten.
       With it the second waits, finds the first's rows, and takes what is left.
    */
    await tx.$queryRaw`SELECT id FROM enquiry WHERE id = ${enquiry.id} FOR UPDATE`;
    const current = await tx.enquiryRecipient.count({ where: { enquiryId: enquiry.id } });
    const room = Math.max(0, MAX_RECIPIENTS - current);
    const rows = adding.slice(0, room);
    if (rows.length > 0) {
      await tx.enquiryRecipient.createMany({
        data: rows.map((businessId) => ({ enquiryId: enquiry.id, businessId })),
        skipDuplicates: true,
      });
    }
    if (selection.skipped.length > 0) {
      await tx.missedEnquiry.createMany({
        data: selection.skipped.map((s) => ({ enquiryId: enquiry.id, businessId: s.businessId, reason: s.reason })),
        skipDuplicates: true,
      });
    }
    return rows;
  });
  if (added.length === 0) return { ok: false, reason: "full" };

  // After the write, in `createEnquiry`'s order and for its reasons: route, then
  // tell the seat the router chose, then the out-of-hours auto-reply.
  await Promise.all(
    added.map(async (businessId) => {
      try {
        await routeLead({ enquiryId: enquiry.id, businessId });
      } catch (cause) {
        console.error("[routing] failed", { enquiryId: enquiry.id, businessId, cause });
      }
    }),
  );
  await onEnquiryDelivered({
    enquiryId: enquiry.id,
    businessIds: added,
    valueAed: estimatedValueAed(
      enquiry.lines.map((line) => ({
        qty: line.qty,
        targetUnitPriceAed: line.targetUnitPriceAed?.toString() ?? null,
      })),
    ),
  });
  await sendAutoReplies({ enquiryId: enquiry.id, businessIds: added });

  return { ok: true, enquiryId: enquiry.id, ref: enquiry.ref, added: added.length };
}

async function recordMissed(enquiryId: string, skipped: readonly { businessId: string; reason: "at_monthly_cap" }[]) {
  if (skipped.length === 0) return;
  await prisma.missedEnquiry.createMany({
    data: skipped.map((s) => ({ enquiryId, businessId: s.businessId, reason: s.reason })),
    skipDuplicates: true,
  });
}
