import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import type { SubjectRef } from "@/lib/audit/types";
import { VERIFIED_TIER } from "@/lib/verification";
import {
  failures,
  MIN_MEMBERS,
  readCriteria,
  REAUDIT_DAYS,
  type CriterionFailure,
} from "./criteria";

/**
 * Board 6b — taking a snapshot, and the guarantee that moved here.
 *
 * ## What this replaced
 *
 * Membership used to be computed on every read, which made "placement cannot be
 * bought" free: there was no row to write, so there was nothing to sell. §3
 * ended that, because hand-written entries cross-reference each other and no
 * automated process can rewrite prose.
 *
 * So the bar is here now. `auditList` is **the only path** that writes a
 * member, and it refuses to record anybody who fails the list's own criteria at
 * the moment of the audit. Spec §5 requirement 4: *"A seller cannot request,
 * appeal or be notified of consideration for a list. There is no surface for it
 * in `3*` and none should be added."* There is no API path, no seller action,
 * and no admin action that adds a member outside this function.
 *
 * Every call writes an `AuditEvent` with a written reason **and** a retained
 * `CuratedListAudit` row. The first says who decided; the second is the evidence
 * that the decision met the published bar, and it is kept rather than
 * overwritten — a record replaced on every re-audit is not evidence, it is the
 * current claim restated.
 *
 * ## What is deliberately absent
 *
 * No plan, no ranking multiplier, no boost, no placement slot. Not weighted to
 * zero — absent. `no-placement.test.ts` reads this directory's source and fails
 * if any of those names appear, because a weight of nought is a decision
 * somebody can revisit in a config screen and an absent field is not.
 */

export type AuditRefusal =
  | "not_found"
  | "fails_criteria"
  | "too_few"
  | "duplicate_best_for"
  | "duplicate_member"
  | "empty_entry";

export type AuditResult<T = unknown> =
  | ({ ok: true } & T)
  | {
      ok: false;
      error: AuditRefusal;
      message: string;
      /** Which member failed what, so the editor can act rather than guess. */
      rejected?: { businessId: string; failures: CriterionFailure[] }[];
    };

export interface AuditEntry {
  businessId: string;
  bestFor: string;
  prose: string;
  /** `CATALOGUE` / `312 products`. Both or neither. */
  extraLabel?: string | null;
  extraValue?: string | null;
}

export interface AuditInput {
  actor: Actor;
  listId: string;
  /** In editorial order. Position is the index; the numeral is decorative. */
  entries: readonly AuditEntry[];
  reason: string;
  /**
   * The audit date, injectable for the same reason `refreshFreshness` takes one.
   *
   * Two audits inside one millisecond otherwise carry the same timestamp, which
   * makes "the date moved" untestable and — more to the point — makes two
   * genuine re-audits on a busy afternoon indistinguishable in the retained
   * record.
   */
  now?: Date;
}

/** The metrics a candidate is judged on, read once at audit time. */
async function measure(businessIds: readonly string[]) {
  const rows = await prisma.business.findMany({
    where: { id: { in: [...businessIds] } },
    select: {
      id: true,
      slug: true,
      displayName: true,
      verificationTier: true,
      responseTimeMedianMs: true,
      ratingOverall: true,
      establishedYear: true,
      suspendedAt: true,
      publishedAt: true,
      mergedIntoId: true,
      /*
         Counted here rather than read from `Business.reviewCount`, because the
         criterion is "15+ reviews **from enquiries**" and that column counts
         every row. A removed or held review is not evidence, and the operative
         phrase is what makes 15 a meaningful number.
      */
      reviews: { where: { removedAt: null, heldAt: null }, select: { id: true } },
    },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Record a snapshot: who is on the list, what they read, and what a person wrote.
 *
 * Whole-list rather than per-entry, because `position` is unique per list and
 * moving entry 3 to 1 through individual updates walks through a state where two
 * rows share a position. It is also the honest shape of the operation — an audit
 * is a re-reading of the whole list, not an edit to one row of it.
 */
export async function auditList(input: AuditInput): Promise<
  AuditResult<{ members: number; auditedAt: Date }>
> {
  const list = await prisma.curatedList.findUnique({
    where: { id: input.listId },
    select: {
      id: true,
      slug: true,
      criteria: true,
      categoryId: true,
      areaId: true,
      auditedAt: true,
    },
  });
  if (!list) {
    return { ok: false, error: "not_found", message: "That list is not here." };
  }

  const entries = input.entries.map((entry) => ({
    ...entry,
    bestFor: entry.bestFor.trim(),
    prose: entry.prose.trim(),
    extraLabel: entry.extraLabel?.trim() || null,
    extraValue: entry.extraValue?.trim() || null,
  }));

  if (entries.some((entry) => entry.bestFor === "" || entry.prose === "")) {
    return {
      ok: false,
      error: "empty_entry",
      message:
        "Every entry needs a BEST FOR line and a paragraph. An entry with neither is a ranked row, which is what this page exists not to be.",
    };
  }

  /*
     Acceptance 16, checked here as well as by the unique index.

     The index is the guarantee; this is the message. A editor who has written
     two entries "best for chiller AMC" should be told which two, not handed a
     constraint violation.
  */
  const seenBestFor = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.bestFor.toLowerCase();
    seenBestFor.set(key, (seenBestFor.get(key) ?? 0) + 1);
  }
  const repeated = [...seenBestFor.entries()].find(([, count]) => count > 1);
  if (repeated) {
    return {
      ok: false,
      error: "duplicate_best_for",
      message: `Two entries are both "best for ${repeated[0]}". The line is what turns a ranked list into recommendations that do not compete with each other, so no two may share one.`,
    };
  }

  const ids = entries.map((entry) => entry.businessId);
  if (new Set(ids).size !== ids.length) {
    return {
      ok: false,
      error: "duplicate_member",
      message: "One business appears twice on the list.",
    };
  }

  const criteria = readCriteria(list.criteria);
  const measured = await measure(ids);

  /*
     The bar, applied to every entry, at the moment of the audit.

     This is the whole of criterion 4's first half — "cannot include a business
     that fails them" — and it is what the computed model used to give for free.
     A member is recorded only if they pass now; the figures that pass are the
     figures the page then publishes, which is what makes the snapshot honest
     rather than merely frozen.
  */
  const rejected: { businessId: string; failures: CriterionFailure[] }[] = [];
  for (const entry of entries) {
    const row = measured.get(entry.businessId);
    if (!row) {
      rejected.push({
        businessId: entry.businessId,
        failures: [{ key: "verified", have: "not listed", need: "a published listing" }],
      });
      continue;
    }
    if (row.suspendedAt !== null || row.publishedAt === null || row.mergedIntoId !== null) {
      rejected.push({
        businessId: entry.businessId,
        failures: [{ key: "verified", have: "not public", need: "a published listing" }],
      });
      continue;
    }
    const failed = failures(
      {
        verificationTier: row.verificationTier,
        responseTimeMedianMs: row.responseTimeMedianMs,
        reviewCount: row.reviews.length,
      },
      criteria,
      VERIFIED_TIER,
    );
    if (failed.length > 0) rejected.push({ businessId: entry.businessId, failures: failed });
  }

  if (rejected.length > 0) {
    return {
      ok: false,
      error: "fails_criteria",
      message: `${rejected.length} of ${entries.length} do not meet the criteria this list publishes. Lowering a criterion to fit somebody in is the one thing this page cannot survive.`,
      rejected,
    };
  }

  /*
     The floor. §Selection: never pad to reach a round number, and never lower a
     criterion for one list to fill it out — but also never publish four.
  */
  if (entries.length < MIN_MEMBERS) {
    return {
      ok: false,
      error: "too_few",
      message: `${entries.length} qualify, and a list publishes at ${MIN_MEMBERS}. Below that it is a shortlist, not a recommendation.`,
    };
  }

  /*
     The candidate pool, for the record. Counted, never listed to the reader —
     "chosen from 218 listed companies" is the claim, and the 218 has to be a
     real number rather than a round one.
  */
  const consideredCount = await prisma.business.count({
    where: {
      suspendedAt: null,
      publishedAt: { not: null },
      mergedIntoId: null,
      primaryCategoryId: list.categoryId,
      ...(list.areaId ? { locations: { some: { areaId: list.areaId, published: true } } } : {}),
    },
  });

  const auditedAt = input.now ?? new Date();
  const subject: SubjectRef = `CuratedList:${list.slug}`;

  const record = entries.map((entry, index) => {
    const row = measured.get(entry.businessId);
    return {
      position: index,
      businessId: entry.businessId,
      slug: row?.slug ?? null,
      displayName: row?.displayName ?? null,
      bestFor: entry.bestFor,
      verificationTier: row?.verificationTier ?? null,
      responseTimeMedianMs: row?.responseTimeMedianMs ?? null,
      reviewCount: row?.reviews.length ?? 0,
      ratingOverall: row?.ratingOverall ?? null,
    };
  });

  await prisma.$transaction(async (tx) =>
    staffMutation(
      { actor: input.actor, capability: "taxonomy.write", subject, reason: input.reason, tx },
      async () => {
        const before = await tx.curatedListMember.count({ where: { listId: list.id } });

        await tx.curatedListMember.deleteMany({ where: { listId: list.id } });
        for (const [index, entry] of entries.entries()) {
          const row = measured.get(entry.businessId);
          await tx.curatedListMember.create({
            data: {
              listId: list.id,
              businessId: entry.businessId,
              position: index,
              bestFor: entry.bestFor,
              prose: entry.prose,
              snapshotAt: auditedAt,
              snapRatingOverall: row?.ratingOverall ?? null,
              snapReviewCount: row?.reviews.length ?? 0,
              // Non-null by construction: the reply criterion refused a null
              // above, and a list whose criteria omit it has no reply figure to
              // publish either — nought reads as instant, so it is not a
              // sensible fallback and the type says so.
              snapResponseMs: row?.responseTimeMedianMs ?? MISSING_REPLY,
              snapEstablishedYear: row?.establishedYear ?? null,
              extraLabel: entry.extraLabel,
              extraValue: entry.extraValue,
            },
          });
        }

        await tx.curatedList.update({
          where: { id: list.id },
          data: {
            auditedAt,
            editorId: input.actor.id,
            consideredCount,
            // A re-audit is what resolves drift. Nothing else does.
            entryRemovedAt: null,
            reauditDueAt: new Date(auditedAt.getTime() + REAUDIT_DAYS * 86_400_000),
          },
        });

        await tx.curatedListAudit.create({
          data: {
            listId: list.id,
            auditedAt,
            editorId: input.actor.id,
            consideredCount,
            memberCount: entries.length,
            record,
          },
        });

        await tx.curatedListDrift.updateMany({
          where: { listId: list.id, resolvedAt: null },
          data: { resolvedAt: auditedAt },
        });

        return {
          result: null,
          before: { members: before },
          after: { members: entries.length, consideredCount, auditedAt: auditedAt.toISOString() },
        };
      },
    ),
  );

  return { ok: true, members: entries.length, auditedAt };
}

/**
 * A reply figure for a list whose criteria do not require one.
 *
 * Sentinel rather than nought or null: nought renders as an instant reply, and
 * null would make the column nullable on every row to serve a case that does
 * not arise while `reply` is a default criterion. A day is visibly not a
 * measurement and the band renders it muted, which is the honest treatment.
 */
const MISSING_REPLY = 24 * 3_600_000;
