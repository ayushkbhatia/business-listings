import "server-only";
import { prisma } from "@/lib/db/client";
import { Prisma, type PrismaClient, type QueueSubject } from "@/lib/db/generated/client";
import type { Authority, Emirate } from "@/lib/db/generated/enums";
import { SLA_DAYS } from "@/lib/console/overview";
import { AUTHORITY_EMIRATE } from "@/lib/ingest/sources";
import { activityCovers } from "@/lib/onboarding/activity";
import { loadTradeKinds } from "@/lib/taxonomy/service";
import { resolveTradeKind } from "@/lib/taxonomy/trade-kind";
import { isPublishable } from "@/lib/verification/credentials";
import { parseRegisterFetch } from "@/lib/credentials/register-fetch";
import { normaliseLicenceNumber } from "@/lib/verification/licence/number";
import {
  allPassed,
  checksFor,
  rowAction,
  type Check,
  type CheckSentence,
  type RowAction,
  type SubmissionFacts,
} from "./checks";
import { parseRules, QUEUE_KINDS, RULES_SETTING_KEY, type CheckRules, type QueueKind } from "./rules";

/**
 * Board 4b — what the approval queue reads.
 *
 * Six kinds of submission live in five tables, and from the moderator's side of
 * the desk they are one job. This reads all of them, computes every row's
 * checks against the rules as they stand now (B2), and returns one list — so
 * the chips, the header's over-SLA count, the pass rate and the bulk set are
 * all counted off the same array as the rows (B4). A count that came from a
 * second query is a count that can disagree with the table under it.
 *
 * Pending means: a change request still `pending`; a claim not yet decided
 * and not part of an open conflict (the conflict is the row); a conflict not
 * resolved; a credential asked to publish and not looked at; a credential the
 * register could not settle (board 4c-s — pending, or waiting on a clearer
 * document); and a branch published outside the emirate its business's licence
 * covers, carrying no licence of its own, that nobody has decided for that
 * emirate.
 */

type Db = PrismaClient | Prisma.TransactionClient;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Per kind (B7). A conflict and a description rewrite do not deserve the same
 * clock. The figures are the ones `/admin` already measures lateness against,
 * so the overview and the queue can never disagree about what "late" is.
 */
export const SLA_MS: Record<QueueKind, number> = {
  claim: SLA_DAYS.claim * DAY_MS,
  conflict: SLA_DAYS.claim * DAY_MS,
  profile_edit: SLA_DAYS.moderation * DAY_MS,
  category_change: SLA_DAYS.moderation * DAY_MS,
  locations: SLA_DAYS.moderation * DAY_MS,
  credential: SLA_DAYS.credential * DAY_MS,
};

export interface QueueEntry {
  /** `claim:cl123` — the subject and its id, unique across the queue. */
  ref: string;
  subject: QueueSubject;
  id: string;
  kind: QueueKind;
  businessId: string;
  businessName: string;
  businessSlug: string;
  summary: CheckSentence;
  checks: Check[];
  allPassed: boolean;
  action: RowAction;
  submittedAt: Date;
  waitingMs: number;
  slaMs: number;
  /** Over SLA, and not waiting on the seller. */
  late: boolean;
  assignee: { id: string; name: string | null } | null;
  /** An outstanding request for a document: asked, and nothing back yet. */
  docsRequested: { at: Date; reason: string } | null;
  href: string;
}

export function refFor(subject: QueueSubject, id: string): string {
  return `${subject}:${id}`;
}

export function parseRef(ref: string): { subject: QueueSubject; id: string } | null {
  const [subject, id, extra] = ref.split(":");
  if (extra !== undefined || !id) return null;
  if (!["change_request", "claim", "conflict", "credential", "location", "register_credential"].includes(subject ?? "")) {
    return null;
  }
  return { subject: subject as QueueSubject, id };
}

export async function readRules(db: Db = prisma): Promise<CheckRules> {
  const row = await db.platformSetting.findUnique({ where: { key: RULES_SETTING_KEY }, select: { value: true } });
  return parseRules(row?.value);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/** The authorities licensed in each emirate, for the branch query. */
function authoritiesByEmirate(): Map<Emirate, Authority[]> {
  const map = new Map<Emirate, Authority[]>();
  for (const [authority, emirate] of Object.entries(AUTHORITY_EMIRATE) as [Authority, Emirate][]) {
    map.set(emirate, [...(map.get(emirate) ?? []), authority]);
  }
  return map;
}

/* ── Reading every source ──────────────────────────────────────────────────── */

interface Raw {
  subject: QueueSubject;
  id: string;
  kind: QueueKind;
  businessId: string;
  businessName: string;
  businessSlug: string;
  summary: CheckSentence;
  facts: SubmissionFacts;
  submittedAt: Date;
  /** For a branch: the emirate a decision would be about. */
  version?: string;
  /**
   * Board 4c-s: a request for a clearer document lives on the credential, not
   * on `queue_item`, because it is a review state the seller's screen reads.
   */
  waitingOnSeller?: { at: Date; reason: string } | null;
}

/**
 * Every pending submission, with the facts its checks read. Unfiltered and
 * unsorted; `loadQueue` does both.
 */
export async function loadPending(db: Db = prisma): Promise<Raw[]> {
  const openConflict = { resolvedAt: null } as const;
  const byEmirate = authoritiesByEmirate();

  const [changes, claims, conflicts, credentials, branches, registerCredentials] = await Promise.all([
    db.listingChangeRequest.findMany({
      where: { status: "pending" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        field: true,
        beforeValue: true,
        afterValue: true,
        createdAt: true,
        business: {
          select: {
            id: true,
            displayName: true,
            slug: true,
            licenceAuthority: true,
            licenceActivity: true,
            primaryCategoryId: true,
          },
        },
      },
    }),
    db.claimSubmission.findMany({
      where: {
        decidedAt: null,
        conflictsAsA: { none: openConflict },
        conflictsAsB: { none: openConflict },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        route: true,
        phone: true,
        claimantName: true,
        statedLicenceNumber: true,
        statedLicenceExpiry: true,
        ocrLicenceNumber: true,
        ocrLicenceExpiry: true,
        ocrConfidence: true,
        createdAt: true,
        claimant: { select: { fullName: true } },
        document: { select: { detectedKind: true } },
        business: {
          select: {
            id: true,
            displayName: true,
            slug: true,
            licenceNumber: true,
            licenceAuthority: true,
            licenceExpiry: true,
            closureRequestedAt: true,
            locations: { where: { phone: { not: null } }, select: { phone: true } },
          },
        },
      },
    }),
    db.claimConflict.findMany({
      where: openConflict,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        createdAt: true,
        business: { select: { id: true, displayName: true, slug: true } },
        submissionA: { select: { route: true, claimantName: true, claimant: { select: { fullName: true } } } },
        submissionB: { select: { route: true, claimantName: true, claimant: { select: { fullName: true } } } },
      },
    }),
    db.document.findMany({
      where: { isPublic: true, reviewedAt: null, businessId: { not: null } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        kind: true,
        displayName: true,
        filename: true,
        validUntil: true,
        createdAt: true,
        business: { select: { id: true, displayName: true, slug: true } },
      },
    }),
    // A published branch in an emirate its business's licence does not cover,
    // with no registry number of its own. One OR per emirate, because the
    // authority-to-emirate map is code and not a column.
    db.location.findMany({
      where: {
        published: true,
        licenceNumber: null,
        business: { closureRequestedAt: null, mergedIntoId: null },
        OR: [...byEmirate.entries()].map(([emirate, authorities]) => ({
          emirate: { not: emirate },
          business: { licenceAuthority: { in: authorities } },
        })),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        type: true,
        emirate: true,
        addressLine: true,
        publishedAt: true,
        createdAt: true,
        area: { select: { name: true } },
        business: { select: { id: true, displayName: true, slug: true, licenceAuthority: true } },
      },
    }),
    // Board 4c-s. What the register could not settle. A verified or rejected
    // credential has left the queue; one nobody could check never entered it.
    db.credential.findMany({
      where: { kind: "fta_tax_agent", review: { in: ["pending", "more_info"] }, business: { mergedIntoId: null } },
      orderBy: [{ reviewOpenedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        identifier: true,
        expiresOn: true,
        review: true,
        reviewOpenedAt: true,
        reviewedAt: true,
        reviewNote: true,
        resubmittedAt: true,
        registerFetch: true,
        createdAt: true,
        business: {
          select: {
            id: true,
            displayName: true,
            slug: true,
            tradeName: true,
            licenceNumber: true,
            licenceAuthority: true,
          },
        },
      },
    }),
  ]);

  const raws: Raw[] = [];

  /* Change requests: names, slugs, licence duplicates and categories. */
  const categoryIds = new Set<string>();
  const nextSlugs = new Map<string, string>();
  const licenceValues = new Map<string, string>();
  for (const change of changes) {
    if (change.field === "primary_category" || change.field === "additional_category") {
      categoryIds.add(change.afterValue);
      if (change.beforeValue) categoryIds.add(change.beforeValue);
    }
    if (change.field === "trade_name") {
      const slug = slugify(change.afterValue);
      if (slug && slug !== change.business.slug) nextSlugs.set(change.id, slug);
    }
    if (change.field === "licence") {
      const normalised = normaliseLicenceNumber(change.afterValue, change.business.licenceAuthority);
      if (normalised.ok) licenceValues.set(change.id, normalised.value);
    }
  }

  const [categories, tradeKinds, takenSlugs, licenceHolders] = await Promise.all([
    categoryIds.size > 0
      ? db.category.findMany({
          where: { id: { in: [...categoryIds] } },
          select: { id: true, name: true, synonyms: true, parent: { select: { name: true } } },
        })
      : Promise.resolve([]),
    changes.some((change) => change.field === "primary_category") ? loadTradeKinds(db) : Promise.resolve(new Map()),
    nextSlugs.size > 0
      ? db.business.findMany({ where: { slug: { in: [...nextSlugs.values()] } }, select: { id: true, slug: true } })
      : Promise.resolve([]),
    licenceValues.size > 0
      ? db.business.findMany({
          where: { licenceNumber: { in: [...licenceValues.values()] }, mergedIntoId: null },
          select: { id: true, displayName: true, licenceNumber: true },
        })
      : Promise.resolve([]),
  ]);
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  for (const change of changes) {
    const business = change.business;
    const base = {
      subject: "change_request" as const,
      id: change.id,
      businessId: business.id,
      businessName: business.displayName,
      businessSlug: business.slug,
      submittedAt: change.createdAt,
    };

    if (change.field === "trade_name" || change.field === "licence") {
      const nextSlug = nextSlugs.get(change.id) ?? null;
      const licence = licenceValues.get(change.id);
      const duplicate = licence
        ? licenceHolders.find((holder) => holder.licenceNumber === licence && holder.id !== business.id)
        : undefined;
      raws.push({
        ...base,
        kind: "profile_edit",
        summary: {
          key: change.field === "trade_name" ? "admin.queue.summary.trade_name" : "admin.queue.summary.licence",
          params: { from: change.beforeValue ?? "", to: change.afterValue },
        },
        facts: {
          kind: "profile_edit",
          field: change.field,
          before: change.beforeValue,
          after: change.afterValue,
          authority: business.licenceAuthority,
          nextSlug,
          slugTaken: nextSlug ? takenSlugs.some((row) => row.slug === nextSlug && row.id !== business.id) : false,
          duplicateOf: duplicate?.displayName ?? null,
        },
      });
      continue;
    }

    const after = categoryById.get(change.afterValue);
    const before = change.beforeValue ? categoryById.get(change.beforeValue) : undefined;
    const categoryName = after?.name ?? change.afterValue;
    raws.push({
      ...base,
      kind: "category_change",
      summary:
        change.field === "primary_category"
          ? {
              key: "admin.queue.summary.primary_category",
              params: { from: before?.name ?? change.beforeValue ?? "", to: categoryName },
            }
          : { key: "admin.queue.summary.additional_category", params: { to: categoryName } },
      facts: {
        kind: "category_change",
        field: change.field,
        categoryName,
        fitsLicence: after
          ? activityCovers(business.licenceActivity, { name: after.name, synonyms: after.synonyms, parent: after.parent })
          : false,
        tradeKindBefore:
          change.field === "primary_category" && change.beforeValue ? resolveTradeKind(tradeKinds, change.beforeValue) : null,
        tradeKindAfter: change.field === "primary_category" ? resolveTradeKind(tradeKinds, change.afterValue) : null,
      },
    });
  }

  for (const claim of claims) {
    const business = claim.business;
    raws.push({
      subject: "claim",
      id: claim.id,
      kind: "claim",
      businessId: business.id,
      businessName: business.displayName,
      businessSlug: business.slug,
      submittedAt: claim.createdAt,
      summary: {
        key: claim.route === "licence_upload" ? "admin.queue.summary.claim_licence" : "admin.queue.summary.claim_phone",
        params: { name: claim.claimantName ?? claim.claimant.fullName ?? "" },
      },
      facts: {
        kind: "claim",
        route: claim.route,
        authority: business.licenceAuthority,
        registerLicenceNumber: business.licenceNumber,
        registerExpiry: business.licenceExpiry,
        statedLicenceNumber: claim.statedLicenceNumber,
        ocrLicenceNumber: claim.ocrLicenceNumber,
        statedLicenceExpiry: claim.statedLicenceExpiry,
        ocrLicenceExpiry: claim.ocrLicenceExpiry,
        ocrConfidence: claim.ocrConfidence,
        detectedKind: claim.document?.detectedKind ?? null,
        phone: claim.phone,
        recordPhones: business.locations.map((location) => location.phone!).filter(Boolean),
        closing: business.closureRequestedAt !== null,
      },
    });
  }

  for (const conflict of conflicts) {
    const name = (side: typeof conflict.submissionA) => side.claimantName ?? side.claimant.fullName ?? "";
    raws.push({
      subject: "conflict",
      id: conflict.id,
      kind: "conflict",
      businessId: conflict.business.id,
      businessName: conflict.business.displayName,
      businessSlug: conflict.business.slug,
      submittedAt: conflict.createdAt,
      summary: {
        key: "admin.queue.summary.conflict",
        params: { a: name(conflict.submissionA), b: name(conflict.submissionB) },
      },
      facts: { kind: "conflict", claims: [conflict.submissionA, conflict.submissionB] },
    });
  }

  for (const document of credentials) {
    const business = document.business!;
    raws.push({
      subject: "credential",
      id: document.id,
      kind: "credential",
      businessId: business.id,
      businessName: business.displayName,
      businessSlug: business.slug,
      submittedAt: document.createdAt,
      summary: {
        key: "admin.queue.summary.credential",
        params: { name: document.displayName ?? document.filename },
      },
      facts: {
        kind: "credential",
        displayName: document.displayName,
        validUntil: document.validUntil,
        publishable: isPublishable(document.kind),
      },
    });
  }

  for (const credential of registerCredentials) {
    const business = credential.business;
    // Waiting on the seller. Their answer moves it back to `pending`, and ours.
    const waiting =
      credential.review === "more_info" && credential.reviewedAt && credential.reviewNote
        ? { at: credential.reviewedAt, reason: credential.reviewNote }
        : null;
    raws.push({
      subject: "register_credential",
      id: credential.id,
      kind: "credential",
      businessId: business.id,
      businessName: business.displayName,
      businessSlug: business.slug,
      submittedAt: credential.reviewOpenedAt ?? credential.createdAt,
      waitingOnSeller: waiting,
      summary: {
        key: "admin.queue.summary.register_credential",
        params: { number: credential.identifier ?? "" },
      },
      facts: {
        kind: "register_credential",
        submitted: {
          identifier: credential.identifier,
          name: business.tradeName,
          expiresOn: credential.expiresOn,
          licenceNumber: business.licenceNumber,
          licenceAuthority: business.licenceAuthority,
        },
        read: parseRegisterFetch(credential.registerFetch),
      },
    });
  }

  for (const branch of branches) {
    raws.push({
      subject: "location",
      id: branch.id,
      kind: "locations",
      businessId: branch.business.id,
      businessName: branch.business.displayName,
      businessSlug: branch.business.slug,
      submittedAt: branch.publishedAt ?? branch.createdAt,
      version: branch.emirate,
      summary: {
        key: "admin.queue.summary.location",
        params: { area: branch.area.name },
        labels: { type: `locations.type.${branch.type}`, emirate: `emirate.${branch.emirate}` },
      },
      facts: {
        kind: "locations",
        emirate: branch.emirate,
        authority: branch.business.licenceAuthority,
        branchLicenceNumber: null,
      },
    });
  }

  if (raws.length === 0) return raws;

  /*
     A branch somebody kept for its current emirate is not pending. One they
     took down and the seller has published again is: it is live outside the
     licence once more, and the earlier decision said it should not be.
  */
  const decided = await db.queueItem.findMany({
    where: {
      subjectType: "location",
      decision: "approved",
      subjectId: { in: branches.map((branch) => branch.id) },
    },
    select: { subjectId: true, subjectVersion: true },
  });
  const decidedFor = new Map(decided.map((row) => [row.subjectId, row.subjectVersion]));
  return raws.filter((raw) => raw.subject !== "location" || decidedFor.get(raw.id) !== raw.version);
}

/* ── The queue, as the screen reads it ─────────────────────────────────────── */

export interface QueueFilter {
  kind?: QueueKind | null;
  /** Only rows assigned to this staff member. */
  assigneeId?: string | null;
}

export interface QueueView {
  rules: CheckRules;
  /** Every pending row, sorted, before any filter: the header's figures. */
  all: QueueEntry[];
  /** The rows the current filter shows. */
  rows: QueueEntry[];
  /** Per kind, counted off the rows the assignee filter leaves (B4). */
  counts: Record<QueueKind, number>;
  total: number;
  overSla: number;
  /** Rows where every check passed, across the whole queue. */
  passing: number;
}

function hrefFor(subject: QueueSubject, id: string): string {
  switch (subject) {
    case "change_request":
      return `/admin/queue/${id}`;
    case "claim":
      return `/admin/queue/claim/${id}`;
    case "conflict":
      return `/admin/queue/conflict/${id}`;
    case "credential":
      return `/admin/queue/document/${id}`;
    case "location":
      return `/admin/queue/location/${id}`;
    case "register_credential":
      return `/admin/queue/credential/${id}`;
  }
}

/**
 * Over SLA first, then oldest first (B9), then by reference — a total order,
 * so "next" in a triage session is always the same row. Survives filtering
 * because filtering only removes rows.
 */
export function compareEntries(a: QueueEntry, b: QueueEntry): number {
  return (
    Number(b.late) - Number(a.late) ||
    a.submittedAt.getTime() - b.submittedAt.getTime() ||
    (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)
  );
}

export function entriesFrom(
  raws: readonly Raw[],
  rules: CheckRules,
  items: ReadonlyMap<string, QueueItemState>,
  now: Date,
): QueueEntry[] {
  return raws
    .map((raw) => {
      const checks = checksFor(raw.facts, rules, now);
      const ref = refFor(raw.subject, raw.id);
      const item = items.get(ref);
      const waitingMs = Math.max(0, now.getTime() - raw.submittedAt.getTime());
      const docsRequested =
        raw.waitingOnSeller !== undefined
          ? raw.waitingOnSeller
          : item?.docsRequestedAt && item.docsRequestReason && !item.docsReceivedAt
            ? { at: item.docsRequestedAt, reason: item.docsRequestReason }
            : null;
      const slaMs = SLA_MS[raw.kind];
      return {
        ref,
        subject: raw.subject,
        id: raw.id,
        kind: raw.kind,
        businessId: raw.businessId,
        businessName: raw.businessName,
        businessSlug: raw.businessSlug,
        summary: raw.summary,
        checks,
        allPassed: allPassed(checks),
        action: rowAction(raw.kind, checks),
        submittedAt: raw.submittedAt,
        waitingMs,
        slaMs,
        // A row waiting on the seller is not late on us.
        late: waitingMs > slaMs && docsRequested === null,
        assignee: item?.assigneeId ? { id: item.assigneeId, name: item.assigneeName } : null,
        docsRequested,
        href: hrefFor(raw.subject, raw.id),
      };
    })
    .sort(compareEntries);
}

export interface QueueItemState {
  assigneeId: string | null;
  assigneeName: string | null;
  docsRequestedAt: Date | null;
  docsRequestReason: string | null;
  docsReceivedAt: Date | null;
}

export async function queueItemStates(refs: readonly { subject: QueueSubject; id: string }[], db: Db = prisma) {
  const map = new Map<string, QueueItemState>();
  if (refs.length === 0) return map;
  const rows = await db.queueItem.findMany({
    where: { OR: groupBySubject(refs).map(([subjectType, ids]) => ({ subjectType, subjectId: { in: ids } })) },
    select: {
      subjectType: true,
      subjectId: true,
      assigneeId: true,
      docsRequestedAt: true,
      docsRequestReason: true,
      docsReceivedAt: true,
      assignee: { select: { fullName: true } },
    },
  });
  for (const row of rows) {
    map.set(refFor(row.subjectType, row.subjectId), {
      assigneeId: row.assigneeId,
      assigneeName: row.assignee?.fullName ?? null,
      docsRequestedAt: row.docsRequestedAt,
      docsRequestReason: row.docsRequestReason,
      docsReceivedAt: row.docsReceivedAt,
    });
  }
  return map;
}

function groupBySubject(refs: readonly { subject: QueueSubject; id: string }[]): [QueueSubject, string[]][] {
  const groups = new Map<QueueSubject, string[]>();
  for (const ref of refs) groups.set(ref.subject, [...(groups.get(ref.subject) ?? []), ref.id]);
  return [...groups.entries()];
}

export async function loadQueue(filter: QueueFilter = {}, now = new Date(), db: Db = prisma): Promise<QueueView> {
  const [raws, rules] = await Promise.all([loadPending(db), readRules(db)]);
  const items = await queueItemStates(raws, db);
  return viewOf(entriesFrom(raws, rules, items, now), rules, filter);
}

export function viewOf(all: QueueEntry[], rules: CheckRules, filter: QueueFilter): QueueView {
  const mine = filter.assigneeId ? all.filter((entry) => entry.assignee?.id === filter.assigneeId) : all;
  const counts = Object.fromEntries(QUEUE_KINDS.map((kind) => [kind, 0])) as Record<QueueKind, number>;
  for (const entry of mine) counts[entry.kind] += 1;
  return {
    rules,
    all,
    rows: filter.kind ? mine.filter((entry) => entry.kind === filter.kind) : mine,
    counts,
    total: mine.length,
    overSla: all.filter((entry) => entry.late).length,
    passing: all.filter((entry) => entry.allPassed).length,
  };
}

/** One pending row, checked now. Null once it is decided or withdrawn. */
export async function entryFor(ref: string, now = new Date(), db: Db = prisma): Promise<QueueEntry | null> {
  const [raws, rules] = await Promise.all([loadPending(db), readRules(db)]);
  const raw = raws.find((candidate) => refFor(candidate.subject, candidate.id) === ref);
  if (!raw) return null;
  const items = await queueItemStates([raw], db);
  return entriesFrom([raw], rules, items, now)[0] ?? null;
}

/** Pending rows across the queue, for the sidebar badge. */
export async function queueCount(db: Db = prisma): Promise<number> {
  return (await loadPending(db)).length;
}

/* ── The queue's health ────────────────────────────────────────────────────── */

export interface QueueHealth {
  /** Median time from submission to decision over the window, or null with nothing decided. */
  medianMs: number | null;
  decided: number;
  /** The most recent decision of any kind. */
  lastDecidedAt: Date | null;
}

export const HEALTH_WINDOW_DAYS = 30;

/**
 * Median decision time, measured (never claimed). Decisions a person made in
 * the last thirty days, across every kind: a withdrawal is not a decision and a
 * branch's clock starts when it was published.
 */
export async function queueHealth(now = new Date(), db: Db = prisma): Promise<QueueHealth> {
  const since = new Date(now.getTime() - HEALTH_WINDOW_DAYS * DAY_MS);
  const rows = await db.$queryRaw<{ median: number | null; decided: bigint; last: Date | null }[]>(Prisma.sql`
    WITH decided AS (
      SELECT "decided_at" AS at, EXTRACT(EPOCH FROM "decided_at" - "created_at") AS secs
        FROM "listing_change_request"
       WHERE "decided_at" >= ${since} AND "status" IN ('approved', 'rejected')
      UNION ALL
      SELECT "decided_at", EXTRACT(EPOCH FROM "decided_at" - "created_at")
        FROM "claim_submission"
       WHERE "decided_at" >= ${since} AND ("outcome" IS NULL OR "outcome" <> 'withdrawn')
      UNION ALL
      SELECT "resolved_at", EXTRACT(EPOCH FROM "resolved_at" - "created_at")
        FROM "claim_conflict"
       WHERE "resolved_at" >= ${since}
      UNION ALL
      SELECT "reviewed_at", EXTRACT(EPOCH FROM "reviewed_at" - "created_at")
        FROM "document"
       WHERE "reviewed_at" >= ${since} AND "business_id" IS NOT NULL AND "review_reason" IS NOT NULL
      UNION ALL
      SELECT q."decided_at", EXTRACT(EPOCH FROM q."decided_at" - COALESCE(l."published_at", l."created_at"))
        FROM "queue_item" q JOIN "location" l ON l."id" = q."subject_id"
       WHERE q."subject_type" = 'location' AND q."decided_at" >= ${since}
      UNION ALL
      -- Board 4c-s. A person's verification or rejection, from when it entered
      -- review. Asking for a clearer document decides nothing, and a credential
      -- the register settled was never a person's to decide.
      SELECT "reviewed_at", EXTRACT(EPOCH FROM "reviewed_at" - "review_opened_at")
        FROM "credential"
       WHERE "reviewed_at" >= ${since} AND "review" IN ('verified', 'rejected')
    )
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(secs, 0))::float8 AS median,
           COUNT(*) AS decided,
           MAX(at) AS last
      FROM decided
  `);
  const row = rows[0];
  return {
    medianMs: row?.median === null || row?.median === undefined ? null : Math.round(row.median * 1000),
    decided: Number(row?.decided ?? 0),
    lastDecidedAt: row?.last ?? null,
  };
}

export { HOUR_MS };
