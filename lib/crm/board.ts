import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";
import type { Actor } from "@/lib/auth/roles";
import { stateWhere } from "@/lib/accounts/health-where";
import { maskPhone } from "@/lib/format";
import { nextDailyRun } from "@/lib/jobs/schedule";
import { SCRIPT_IDS, scriptIdFor, type ScriptId } from "./scripts";
import { lastSyncRun } from "./sync";
import {
  PIPELINE_SIGNALS,
  actionOf,
  dubaiWeekStart,
  isDue,
  type CrmSignalKey,
  type SignalFacts,
  type TaskState,
} from "./model";

/**
 * Board 12d — everything the call list screen reads, for one seat.
 *
 * The rows are the open tasks nobody else holds: unassigned, or assigned to the
 * seat reading them. A row somebody else holds is not shown to be picked up —
 * `assignedToId` is the lock — and the header counts how many there are, so the
 * list does not look shorter than the work.
 *
 * Every figure in the rail is a count with its denominator (B5), and the two
 * header counts are labelled apart (B10): *assigned to me* is every open task
 * on this seat, *due* is the subset to ring today.
 */

export type CrmTab = "calls" | "upgrade" | "renewal";
export const CRM_TABS: readonly CrmTab[] = ["calls", "upgrade", "renewal"];

export function tabFrom(value: string | undefined | null): CrmTab {
  return (CRM_TABS as readonly string[]).includes(value ?? "") ? (value as CrmTab) : "calls";
}

export interface CrmRow {
  id: string;
  businessId: string;
  displayName: string;
  licenceNumber: string;
  areaName: string | null;
  /** Masked. The whole number is a reveal, and a reveal is a row (B9). */
  phoneMasked: string | null;
  claimStatus: string;
  planId: string | null;
  signal: CrmSignalKey;
  signalValue: number;
  facts: SignalFacts;
  demandScore: number;
  state: TaskState;
  due: boolean;
  callBackAt: Date | null;
  lastTouchAt: Date | null;
  lastOutcome: string | null;
  mine: boolean;
  action: "call" | "save" | "follow_up";
  scriptId: ScriptId;
}

export interface HeldScopeBanner {
  signalRef: string;
  facts: Extract<SignalFacts, { kind: "held_page" }>;
  /** Open calls behind this page nobody has taken yet. */
  unassigned: number;
  /** Open calls behind it on my list. */
  mine: number;
}

export interface WeekNumbers {
  since: Date;
  callsMade: number;
  /** Distinct businesses sent a claim link this week. */
  linksSent: number;
  /** Of those, the ones whose claim was approved after the link. */
  claimedAfterLink: number;
  upgraded: number;
  churnSaved: number;
  churnClosed: number;
  /** Tasks that left because their signal cleared, with no call closing them. */
  clearedBySignal: number;
  wrongNumbers: number;
}

export interface ScriptRecord {
  calls: number;
  linksSent: number;
  claimed: number;
}

export interface CrmBoard {
  tab: CrmTab;
  rows: CrmRow[];
  due: number;
  assignedToMe: number;
  heldByOthers: number;
  banner: HeldScopeBanner | null;
  moreHeldScopes: number;
  week: WeekNumbers;
  scripts: Record<ScriptId, ScriptRecord>;
  lastRun: { finishedAt: Date; derived: number } | null;
  nextRun: Date;
  renewal: { fourF: number; onList: number; renewalPassed: number };
  tabCounts: Record<CrmTab, number>;
}

const OPEN = { closedAt: null } as const;

export async function crmBoard(actor: Actor, tab: CrmTab, now: Date = new Date()): Promise<CrmBoard> {
  const visible: Prisma.CrmTaskWhereInput = { ...OPEN, OR: [{ assignedToId: null }, { assignedToId: actor.id }] };
  const tabWhere: Prisma.CrmTaskWhereInput =
    tab === "upgrade" ? { signal: { in: [...PIPELINE_SIGNALS.upgrade] } } : tab === "renewal" ? { signal: { in: [...PIPELINE_SIGNALS.renewal] } } : {};

  const [tasks, assignedToMe, heldByOthers, heldTasks, week, scripts, run, renewal, tabCounts] = await Promise.all([
    prisma.crmTask.findMany({
      where: { AND: [visible, tabWhere] },
      orderBy: [{ demandScore: "desc" }, { id: "asc" }],
      select: {
        id: true,
        businessId: true,
        signal: true,
        signalValue: true,
        signalFacts: true,
        demandScore: true,
        state: true,
        callBackAt: true,
        coolingUntil: true,
        lastTouchAt: true,
        lastOutcome: true,
        assignedToId: true,
        business: {
          select: {
            displayName: true,
            licenceNumber: true,
            claimStatus: true,
            planId: true,
            locations: {
              where: { published: true },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              take: 1,
              select: { phone: true, area: { select: { name: true } } },
            },
          },
        },
      },
    }),
    prisma.crmTask.count({ where: { ...OPEN, assignedToId: actor.id } }),
    prisma.crmTask.count({ where: { AND: [OPEN, tabWhere, { assignedToId: { notIn: [actor.id] } }, { assignedToId: { not: null } }] } }),
    prisma.crmTask.findMany({
      where: { ...OPEN, signal: "held_page" },
      orderBy: [{ demandScore: "desc" }, { id: "asc" }],
      select: { signalRef: true, signalFacts: true, assignedToId: true },
    }),
    weekNumbers(now),
    scriptRecords(),
    lastSyncRun(),
    renewalCheck(now),
    tabTotals(visible),
  ]);

  const rows: CrmRow[] = tasks.map((task) => {
    const facts = task.signalFacts as unknown as SignalFacts;
    const location = task.business.locations[0];
    const state = task.state as TaskState;
    return {
      id: task.id,
      businessId: task.businessId,
      displayName: task.business.displayName,
      licenceNumber: task.business.licenceNumber,
      areaName: location?.area.name ?? null,
      phoneMasked: location?.phone ? maskPhone(location.phone) : null,
      claimStatus: task.business.claimStatus,
      planId: task.business.planId,
      signal: task.signal as CrmSignalKey,
      signalValue: task.signalValue,
      facts,
      demandScore: task.demandScore,
      state,
      due: isDue({ state, callBackAt: task.callBackAt, coolingUntil: task.coolingUntil }, now),
      callBackAt: task.callBackAt,
      lastTouchAt: task.lastTouchAt,
      lastOutcome: task.lastOutcome,
      mine: task.assignedToId === actor.id,
      action: actionOf(task.signal as CrmSignalKey, state),
      scriptId: scriptIdFor(facts, task.business.claimStatus),
    };
  });
  // Due first; inside each half, the demand the query already sorted by.
  rows.sort((a, b) => Number(b.due) - Number(a.due));

  /*
     The banner is one held page: the one with the most searches behind it,
     from the facts the same run wrote onto the rows, so the banner and the
     calls under it cannot describe two different moments.
  */
  const scopes = new Map<string, HeldScopeBanner>();
  for (const task of heldTasks) {
    const facts = task.signalFacts as unknown as SignalFacts;
    if (facts.kind !== "held_page") continue;
    const scope = scopes.get(task.signalRef) ?? { signalRef: task.signalRef, facts, unassigned: 0, mine: 0 };
    if (task.assignedToId === null) scope.unassigned += 1;
    if (task.assignedToId === actor.id) scope.mine += 1;
    scopes.set(task.signalRef, scope);
  }
  const ranked = [...scopes.values()].sort(
    (a, b) => (b.facts.monthlySearches ?? 0) - (a.facts.monthlySearches ?? 0) || a.signalRef.localeCompare(b.signalRef),
  );

  return {
    tab,
    rows,
    due: rows.filter((row) => row.due).length,
    assignedToMe,
    heldByOthers,
    banner: tab === "calls" ? (ranked[0] ?? null) : null,
    moreHeldScopes: Math.max(0, ranked.length - 1),
    week,
    scripts,
    lastRun: run ? { finishedAt: run.finishedAt, derived: run.derived } : null,
    nextRun: nextDailyRun(now),
    renewal,
    tabCounts,
  };
}

async function tabTotals(visible: Prisma.CrmTaskWhereInput): Promise<Record<CrmTab, number>> {
  const [calls, upgrade, renewal] = await Promise.all([
    prisma.crmTask.count({ where: visible }),
    prisma.crmTask.count({ where: { AND: [visible, { signal: { in: [...PIPELINE_SIGNALS.upgrade] } }] } }),
    prisma.crmTask.count({ where: { AND: [visible, { signal: { in: [...PIPELINE_SIGNALS.renewal] } }] } }),
  ]);
  return { calls, upgrade, renewal };
}

/**
 * The week so far, Monday to now in Dubai. Each rate carries the count it is a
 * rate of: `28 of 61 · 46%` rather than `46%`, which the render had once and
 * which no reader could check.
 */
async function weekNumbers(now: Date): Promise<WeekNumbers> {
  const since = dubaiWeekStart(now);
  const [callsMade, links, upgraded, churn, cleared, wrongNumbers] = await Promise.all([
    prisma.callOutcome.count({ where: { createdAt: { gte: since } } }),
    prisma.callOutcome.findMany({
      where: { createdAt: { gte: since }, kind: "claim_link_sent" },
      orderBy: [{ businessId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      distinct: ["businessId"],
      select: { businessId: true, createdAt: true },
    }),
    prisma.crmTask.count({ where: { signal: "cap_reached", state: "won", closedAt: { gte: since } } }),
    prisma.crmTask.groupBy({
      by: ["state"],
      where: { signal: "churn_risk", closedAt: { gte: since } },
      _count: { _all: true },
      orderBy: [{ state: "asc" }],
    }),
    prisma.crmTask.count({ where: { state: { in: ["won", "cleared"] }, closedAt: { gte: since }, calls: { none: {} } } }),
    prisma.crmTask.count({ where: { state: "parked", closeReason: "wrong_number", closedAt: { gte: since } } }),
  ]);

  let claimedAfterLink = 0;
  if (links.length > 0) {
    const claims = await prisma.claimSubmission.findMany({
      where: { businessId: { in: links.map((link) => link.businessId) }, status: "claimed", decidedAt: { not: null } },
      select: { businessId: true, decidedAt: true },
    });
    const linkAt = new Map(links.map((link) => [link.businessId, link.createdAt.getTime()]));
    claimedAfterLink = new Set(
      claims.filter((claim) => claim.decidedAt!.getTime() >= (linkAt.get(claim.businessId) ?? Infinity)).map((claim) => claim.businessId),
    ).size;
  }

  const churnBy = new Map(churn.map((row) => [row.state, row._count._all]));
  return {
    since,
    callsMade,
    linksSent: links.length,
    claimedAfterLink,
    upgraded,
    churnSaved: churnBy.get("won") ?? 0,
    churnClosed: churn.reduce((sum, row) => sum + row._count._all, 0),
    clearedBySignal: cleared,
    wrongNumbers,
  };
}

/**
 * Q3, answered from the log rather than asserted in the rail: per script, how
 * many calls used it, how many sent a claim link, and how many of those
 * businesses then had a claim approved.
 */
async function scriptRecords(): Promise<Record<ScriptId, ScriptRecord>> {
  const [calls, links] = await Promise.all([
    prisma.callOutcome.groupBy({
      by: ["scriptId"],
      where: { scriptId: { not: null } },
      _count: { _all: true },
      orderBy: [{ scriptId: "asc" }],
    }),
    prisma.callOutcome.findMany({
      where: { scriptId: { not: null }, kind: "claim_link_sent" },
      orderBy: [{ scriptId: "asc" }, { businessId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      distinct: ["scriptId", "businessId"],
      select: { scriptId: true, businessId: true, createdAt: true },
    }),
  ]);
  const claims = links.length
    ? await prisma.claimSubmission.findMany({
        where: { businessId: { in: [...new Set(links.map((link) => link.businessId))] }, status: "claimed", decidedAt: { not: null } },
        select: { businessId: true, decidedAt: true },
      })
    : [];

  const out = Object.fromEntries(SCRIPT_IDS.map((id) => [id, { calls: 0, linksSent: 0, claimed: 0 }])) as Record<ScriptId, ScriptRecord>;
  for (const row of calls) if (row.scriptId && row.scriptId in out) out[row.scriptId as ScriptId].calls = row._count._all;
  for (const link of links) {
    const record = out[link.scriptId as ScriptId];
    if (!record) continue;
    record.linksSent += 1;
    if (claims.some((claim) => claim.businessId === link.businessId && claim.decidedAt!.getTime() >= link.createdAt.getTime())) {
      record.claimed += 1;
    }
  }
  return out;
}

/**
 * B6: the Renewal risk tab against board 4f's churn-risk count. The two differ
 * by exactly the accounts whose renewal date has passed, and the tab says so.
 */
async function renewalCheck(now: Date): Promise<{ fourF: number; onList: number; renewalPassed: number }> {
  const [fourF, renewalPassed, onList] = await Promise.all([
    prisma.business.count({ where: stateWhere("churn_risk", now) }),
    prisma.business.count({ where: { AND: [stateWhere("churn_risk", now), { subscription: { is: { renewsAt: { lte: now } } } }] } }),
    prisma.crmTask.count({ where: { ...OPEN, signal: "churn_risk" } }),
  ]);
  return { fourF, onList, renewalPassed };
}
