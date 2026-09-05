import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";
import { buyerForSeller, type SellerVisibleBuyer } from "@/lib/db/queries/seller-visibility";
import { quoteTotalAed } from "@/lib/quote/money";

/**
 * Board 3j — the list rail, and the four tabs above it.
 *
 * ## The tabs, and why they are not four filters on one column
 *
 * The board draws `Open · Quoted · Won · Lost` and the spec defines them by what
 * the seller has done: no quote yet, quote sent, outcome marked. The schema
 * disagrees in one important way — a lead can be won or lost **without the
 * seller marking anything**, because the buyer accepted somebody. That is not a
 * claim, it is a fact the platform observed:
 *
 *   - the buyer accepted this supplier → `Enquiry.contactReleasedToBusinessId`
 *   - the buyer accepted another → `EnquiryRecipient.state = declined`
 *
 * If the tabs read only the seller's own `outcome` column, every lead the buyer
 * decided would sit in `Quoted` forever and the four counts would never sum to
 * the population. So each tab is a union of what the seller said and what the
 * platform saw, and the row says which — "You marked this won" is a different
 * sentence from "The buyer accepted your quote", and conflating them is the kind
 * of quiet overstatement this directory cannot afford.
 *
 * ## Ordering
 *
 * §3: overdue band first, oldest first inside each band. That is one ordering
 * rather than two: `firstReplyAt` nulls first, then `createdAt` ascending. An
 * answered lead is never late, so it belongs after every unanswered one; and
 * within the unanswered, older *is* more overdue, so oldest-first already
 * produces breached, then approaching, then not yet due. The band is then
 * presentation rather than sort order, which is what keeps the list stable while
 * a seller works down it.
 *
 * Not value-ordered. That is board 3a's job as a triage summary; this is the
 * working list, and a list that reshuffles itself by estimated value while
 * somebody is reading it is a list nobody can work.
 */

export type LeadTab = "open" | "quoted" | "won" | "lost";
export const LEAD_TABS = ["open", "quoted", "won", "lost"] as const;

/**
 * Whose leads to show.
 *
 * `mine` and `seat` are the same query with a different id; they are separate
 * members because the default for a sales seat is *their own* and the owner
 * picking a colleague is a deliberate act, and a single `userId` field would
 * make those two indistinguishable in telemetry.
 */
export type LeadScope =
  | { kind: "all" }
  | { kind: "mine"; userId: string }
  | { kind: "seat"; userId: string }
  | { kind: "unassigned" };

/** How late a lead is, against the seller's own escalation setting. */
export type WaitBand = "breached" | "approaching" | "waiting" | "answered";

export interface LeadRailRow {
  enquiryId: string;
  ref: string;
  requirement: string;
  /** The one-line version the rail shows. Never a paraphrase — the first sentence. */
  summary: string;
  deliverToArea: string | null;
  createdAt: Date;
  closesAt: Date;
  /** Null until the seller answers. What every band below is measured from. */
  firstReplyAt: Date | null;
  band: WaitBand;
  /** Milliseconds the buyer has been waiting. Null once answered. */
  waitingMs: number | null;
  /** How long the first reply took. Null until there is one. */
  answeredInMs: number | null;
  buyer: SellerVisibleBuyer;
  lineCount: number;
  /**
   * The buyer's own budget for this enquiry, summed from the lines that carry
   * one. Null when no line does — which is most of them, and a blank is the
   * honest render. It is not an estimate of the deal: it is what the buyer said
   * they hoped to pay, and relabelling it would turn a budget into a deal size.
   */
  buyerBudgetAed: string | null;
  /** How many suppliers the buyer fanned this out to. The buyer disclosed it. */
  competing: number;
  latestQuote: { ref: string; revision: number; totalAed: string; sentAt: Date | null } | null;
  assignedTo: { id: string; name: string } | null;
  outcome: "won" | "lost" | null;
  /** True when the outcome is the buyer's decision rather than the seller's note. */
  outcomeObserved: boolean;
  /** Unread buyer messages since the seller last wrote. */
  unread: number;
}

export interface InboxCounts {
  open: number;
  quoted: number;
  won: number;
  lost: number;
  /** Open leads past their escalation threshold with no reply. The header pill. */
  overdue: number;
}

export interface InboxPage {
  rows: LeadRailRow[];
  counts: InboxCounts;
  /** Total in the active tab, so the rail footer can say "6 of 12 shown". */
  total: number;
  /** Present when more rows exist. Opaque — the caller passes it back. */
  nextCursor: string | null;
  /** The seller's own threshold, in minutes. Every band is measured against it. */
  escalationMinutes: number;
}

export const PAGE_SIZE = 25;

/** The escalation sweep's floor, repeated so the two cannot drift apart. */
const MIN_MINUTES = 5;

/**
 * The tab's `where`, built once and used by both the count and the page.
 *
 * Two readers of one definition. The alternative — a `where` for the list and a
 * slightly different one for the badge — is how a tab comes to say twelve over a
 * list of eleven.
 */
export function tabWhere(
  businessId: string,
  tab: LeadTab,
  scope: LeadScope,
): Prisma.EnquiryRecipientWhereInput {
  /*
     Written out rather than negated, and that is not a style choice.

     The first version expressed the open tabs as `NOT (won OR lost)`, which
     Postgres turns into `NOT (enquiry.contact_released_to_business_id = $1)`.
     That column is null on every enquiry nobody has accepted — which is nearly
     all of them — and `NOT (NULL = $1)` is NULL, not true. So the row matched
     nothing, and a rail over twenty-one leads rendered `Open 0 · Quoted 0`
     while `Won 2` worked, because the won clause never negates anything.

     Every comparison below is either an equality or an explicit `IS NULL`, and
     the four are mutually exclusive by construction rather than by subtraction.
  */
  const acceptedByUs: Prisma.EnquiryRecipientWhereInput = {
    enquiry: { contactReleasedToBusinessId: businessId },
  };
  const notAcceptedByUs: Prisma.EnquiryRecipientWhereInput = {
    enquiry: {
      OR: [
        { contactReleasedToBusinessId: null },
        { contactReleasedToBusinessId: { not: businessId } },
      ],
    },
  };
  /**
   * Nobody has decided this one.
   *
   * All three conditions, and the third is the one that was missing: a lead the
   * buyer gave to another supplier is decided, even though this seller never
   * marked it. While `open` was defined by `state IN (delivered, opened)` the
   * exclusion came for free; once both open tabs were defined by the quote
   * instead, a declined lead qualified as unmarked and appeared twice — once in
   * Open and once in Lost — and the four tabs stopped summing.
   */
  const unmarked: Prisma.EnquiryRecipientWhereInput = {
    AND: [{ outcome: null }, notAcceptedByUs, { state: { not: "declined" } }],
  };

  /*
     Whether a quote actually exists, rather than what the state column says.

     §3 defines the two tabs by the quote — "no quote sent yet" and "quote sent"
     — and `EnquiryRecipient.state` is a second, weaker answer to the same
     question. `sendQuoteForBusiness` sets `state = "quoted"` when it writes one,
     so in production the two agree; they disagree wherever a row was written by
     anything else, and the seed has several.

     Reading the quote directly is also what makes board 3k's reconciliation
     hold by construction: its `All` is the leads that carry a quote, and this
     screen's `Quoted` is that same set minus the decided ones. Two screens
     counting one population, which is what the 3j amendment asks for.
  */
  const hasQuote: Prisma.EnquiryRecipientWhereInput = {
    enquiry: { quotes: { some: { businessId, status: { not: "draft" } } } },
  };
  const noQuote: Prisma.EnquiryRecipientWhereInput = {
    enquiry: { quotes: { none: { businessId, status: { not: "draft" } } } },
  };

  const byTab: Record<LeadTab, Prisma.EnquiryRecipientWhereInput> = {
    // No quote sent yet. Includes leads already in conversation — a message is
    // not a quote, and §3 is explicit that Open means unquoted rather than
    // untouched.
    open: { AND: [unmarked, noQuote] },
    quoted: { AND: [unmarked, hasQuote] },
    // The seller's word first, the buyer's acceptance second. A lead the seller
    // marked won is won whatever the enquiry says; one they have not marked is
    // won when the buyer accepted them.
    won: { OR: [{ outcome: "won" }, { AND: [{ outcome: null }, acceptedByUs] }] },
    lost: {
      OR: [
        { outcome: "lost" },
        { AND: [{ outcome: null }, notAcceptedByUs, { state: "declined" }] },
      ],
    },
  };

  return { businessId, ...scopeWhere(scope), AND: [byTab[tab]] };
}

function scopeWhere(scope: LeadScope): Prisma.EnquiryRecipientWhereInput {
  switch (scope.kind) {
    case "all":
      return {};
    case "unassigned":
      return { assignedToId: null };
    case "mine":
    case "seat":
      return { assignedToId: scope.userId };
  }
}

/**
 * Which band a lead sits in.
 *
 * The definition is not invented here. `lib/enquiry/escalation-job.ts` already
 * decides what "late" means for this account — no first reply, measured from the
 * recipient row's creation, against `Business.leadEscalationMinutes` — and that
 * sweep emails the owner about it every hour. A second definition on the rail
 * would put a red row on screen for a lead the email says is fine.
 *
 * `approaching` is the second half of the same window rather than a new number,
 * for the same reason.
 */
export function bandOf(
  row: { firstReplyAt: Date | null; createdAt: Date },
  escalationMinutes: number,
  now: Date,
): WaitBand {
  if (row.firstReplyAt) return "answered";

  const minutes = Math.max(MIN_MINUTES, escalationMinutes);
  const waitedMs = now.getTime() - row.createdAt.getTime();
  const dueMs = minutes * 60_000;

  if (waitedMs >= dueMs) return "breached";
  if (waitedMs >= dueMs / 2) return "approaching";
  return "waiting";
}

/** The first sentence of the requirement, for a rail row that must not wrap twice. */
function summarise(requirement: string): string {
  const flat = requirement.replace(/\s+/g, " ").trim();
  const stop = flat.search(/[.?!]\s/);
  const first = stop > 0 ? flat.slice(0, stop) : flat;
  return first.length > 120 ? `${first.slice(0, 119).trimEnd()}…` : first;
}

/**
 * The buyer's budget for this enquiry, or nothing.
 *
 * Summed in fils from the lines that carry a target. A line without one
 * contributes nothing rather than a guess, and an enquiry where no line carries
 * one has no figure at all — which is most of them, and is the render the board
 * already draws on its fourth row.
 */
function budgetOf(lines: readonly { qty: number; targetUnitPriceAed: unknown }[]): string | null {
  const priced = lines.filter((l) => l.targetUnitPriceAed !== null);
  if (priced.length === 0) return null;
  return quoteTotalAed(
    priced.map((l) => ({ qty: l.qty, unitPrice: String(l.targetUnitPriceAed) })),
  );
}

export async function getInbox(input: {
  businessId: string;
  tab: LeadTab;
  scope: LeadScope;
  cursor?: string | null;
  now?: Date;
}): Promise<InboxPage> {
  const now = input.now ?? new Date();

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: input.businessId },
    select: { leadEscalationMinutes: true },
  });
  const escalationMinutes = Math.max(MIN_MINUTES, business.leadEscalationMinutes);

  const where = tabWhere(input.businessId, input.tab, input.scope);

  const [counts, total, recipients] = await Promise.all([
    countTabs(input.businessId, input.scope, escalationMinutes, now),
    prisma.enquiryRecipient.count({ where }),
    prisma.enquiryRecipient.findMany({
      where,
      /*
         One ordering, not two. See the header: nulls first puts every unanswered
         lead above every answered one, and oldest-first inside that is already
         breached, then approaching, then not yet due.
      */
      orderBy: [{ firstReplyAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
      take: PAGE_SIZE + 1,
      ...(input.cursor
        ? { skip: 1, cursor: { enquiryId_businessId: { enquiryId: input.cursor, businessId: input.businessId } } }
        : {}),
      select: {
        enquiryId: true,
        state: true,
        createdAt: true,
        firstReplyAt: true,
        outcome: true,
        assignedTo: { select: { id: true, fullName: true } },
        enquiry: {
          select: {
            ref: true,
            requirement: true,
            deliverToArea: true,
            closesAt: true,
            contactReleasedToBusinessId: true,
            // Masked by construction: the name column only, for a first name.
            buyer: { select: { fullName: true } },
            lines: { select: { qty: true, targetUnitPriceAed: true } },
            _count: { select: { recipients: true } },
            quotes: {
              where: { businessId: input.businessId },
              orderBy: { revision: "desc" },
              take: 1,
              select: {
                ref: true,
                revision: true,
                sentAt: true,
                lines: { select: { qty: true, unitPrice: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const page = recipients.slice(0, PAGE_SIZE);
  const nextCursor = recipients.length > PAGE_SIZE ? (page.at(-1)?.enquiryId ?? null) : null;

  const unread = await unreadCounts(
    input.businessId,
    page.map((r) => r.enquiryId),
  );

  const rows: LeadRailRow[] = page.map((r) => {
    const e = r.enquiry;
    const quote = e.quotes[0];
    const band = bandOf(r, escalationMinutes, now);
    const observedWin = e.contactReleasedToBusinessId === input.businessId;
    const observedLoss = r.state === "declined";

    return {
      enquiryId: r.enquiryId,
      ref: e.ref,
      requirement: e.requirement,
      summary: summarise(e.requirement),
      deliverToArea: e.deliverToArea,
      createdAt: r.createdAt,
      closesAt: e.closesAt,
      firstReplyAt: r.firstReplyAt,
      band,
      waitingMs: r.firstReplyAt ? null : now.getTime() - r.createdAt.getTime(),
      answeredInMs: r.firstReplyAt
        ? Math.max(0, r.firstReplyAt.getTime() - r.createdAt.getTime())
        : null,
      buyer: buyerForSeller(e.buyer, e.contactReleasedToBusinessId, input.businessId),
      lineCount: e.lines.length,
      buyerBudgetAed: budgetOf(e.lines),
      competing: e._count.recipients,
      latestQuote: quote
        ? {
            ref: quote.ref,
            revision: quote.revision,
            sentAt: quote.sentAt,
            totalAed: quoteTotalAed(
              quote.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice.toString() })),
            ),
          }
        : null,
      assignedTo: r.assignedTo
        ? { id: r.assignedTo.id, name: r.assignedTo.fullName ?? "" }
        : null,
      outcome: r.outcome ?? (observedWin ? "won" : observedLoss ? "lost" : null),
      outcomeObserved: r.outcome === null && (observedWin || observedLoss),
      unread: unread.get(r.enquiryId) ?? 0,
    };
  });

  return { rows, counts, total, nextCursor, escalationMinutes };
}

/**
 * The five numbers above the rail.
 *
 * Five counts rather than one `groupBy`, because two of the tabs read a column
 * on `enquiry` — the buyer's acceptance — and a grouped aggregate cannot join.
 * Every one of them is served by an index the leads migration added.
 */
async function countTabs(
  businessId: string,
  scope: LeadScope,
  escalationMinutes: number,
  now: Date,
): Promise<InboxCounts> {
  const [open, quoted, won, lost, overdue] = await Promise.all([
    prisma.enquiryRecipient.count({ where: tabWhere(businessId, "open", scope) }),
    prisma.enquiryRecipient.count({ where: tabWhere(businessId, "quoted", scope) }),
    prisma.enquiryRecipient.count({ where: tabWhere(businessId, "won", scope) }),
    prisma.enquiryRecipient.count({ where: tabWhere(businessId, "lost", scope) }),
    prisma.enquiryRecipient.count({
      where: {
        ...tabWhere(businessId, "open", scope),
        firstReplyAt: null,
        createdAt: { lte: new Date(now.getTime() - escalationMinutes * 60_000) },
      },
    }),
  ]);

  return { open, quoted, won, lost, overdue };
}

/**
 * Buyer messages since the seller last wrote, per lead.
 *
 * Two queries rather than one per row: the seller's last message on each thread,
 * then a count of buyer messages after it. `Message` has no read state and is
 * not gaining one — board 11b's receipts are quote-level and symmetric, and a
 * per-message read flag would be a one-way receipt on the buyer's own words.
 */
async function unreadCounts(
  businessId: string,
  enquiryIds: readonly string[],
): Promise<Map<string, number>> {
  if (enquiryIds.length === 0) return new Map();

  const lastSeller = await prisma.message.groupBy({
    by: ["enquiryId"],
    where: { businessId, enquiryId: { in: [...enquiryIds] }, sender: { businessId } },
    _max: { createdAt: true },
  });
  const lastByEnquiry = new Map(
    lastSeller.map((row) => [row.enquiryId, row._max.createdAt ?? new Date(0)]),
  );

  const buyerMessages = await prisma.message.findMany({
    // Not this business's seats — the same test `getThread` uses to decide which
    // side of the thread a message sits on, so the two cannot disagree.
    where: { businessId, enquiryId: { in: [...enquiryIds] }, NOT: { sender: { businessId } } },
    select: { enquiryId: true, createdAt: true },
  });

  const counts = new Map<string, number>();
  for (const message of buyerMessages) {
    const since = lastByEnquiry.get(message.enquiryId);
    if (since && message.createdAt.getTime() <= since.getTime()) continue;
    counts.set(message.enquiryId, (counts.get(message.enquiryId) ?? 0) + 1);
  }
  return counts;
}
