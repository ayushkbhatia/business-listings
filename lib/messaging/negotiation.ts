import { lineTotalFils, parseAedToFils, quoteTotalFils } from "@/lib/quote/money";

/**
 * Board `10h` — the negotiation thread, as data.
 *
 * Everything on the screen that is a number, a state or a sentence built from
 * the record is decided here, from rows, and nothing here is stored. Pure: no
 * database, no `t()`, no clock but the one passed in. The words live in
 * `negotiation-words.ts`; the page and the seller's thread both read through it.
 *
 * ## The three things the handoff says are most likely built wrong
 *
 * 1. **A stored quote total (`B1`).** `15,344` shipped on two boards because it
 *    was a string on a fixture. Every total below is `quoteTotalFils` over the
 *    revision's own lines, at render.
 * 2. **A revision stored as a diff (`B2`).** Every revision row holds every line.
 *    The struck-through `198` is `compareRevision` reading r1 beside r2 — and the
 *    table it feeds shows every line the total sums (`B3`), so a total can never
 *    sit under rows that do not reach it.
 * 3. **A hand-written thread preview (`B4`).** `openingClause` is the last
 *    message's own first clause, cut. The board's corrected render still read
 *    *"Can do 191 if you take all 40 in one drop"* above a message opening *"One
 *    drop makes it easier"* — a paraphrase, which is the defect `B4` names, so
 *    this does not reproduce it.
 */

export type QuoteState = "sent" | "read" | "accepted" | "lost" | "expired";

export interface NegotiationLine {
  id: string;
  /** The requirement line this prices, when the composer linked one. */
  enquiryLineId: string | null;
  description: string;
  /** Null for a line priced as a whole. */
  qty: number | null;
  /** As stored: a Decimal string. */
  unitPrice: string;
  sortOrder: number;
}

export interface NegotiationQuote {
  id: string;
  ref: string;
  revision: number;
  status: QuoteState;
  sentAt: Date | null;
  expiresAt: Date | null;
  validityDays: number;
  /** The words the supplier sent the revision with. */
  note: string | null;
  lines: readonly NegotiationLine[];
  /** Board `3j-s`: a proposal has a fee on a basis and no lines. */
  proposal: { feeAed: string; feeBasis: string; feeBasisLabel: string } | null;
}

/** A line of the buyer's requirement, as the enquiry holds it. */
export interface RequirementLine {
  id: string;
  description: string;
  qty: number | null;
  sortOrder: number;
}

/* ── Revisions ─────────────────────────────────────────────────────────────── */

export type LineChange = "same" | "changed" | "new";

export interface ComparedLine {
  key: string;
  description: string;
  qty: number | null;
  unitFils: bigint;
  lineFils: bigint;
  /** The previous revision's unit price for this line, only when it moved. */
  previousUnitFils: bigint | null;
  /** The previous revision's quantity for this line, only when it moved. */
  previousQty: number | null;
  change: LineChange;
}

export interface DroppedLine {
  key: string;
  description: string;
  qty: number | null;
  unitFils: bigint;
}

export interface RevisionComparison {
  /** Every line in this revision, in the supplier's order. Never only the changed ones. */
  lines: ComparedLine[];
  /** The sum of `lines`, and the only total this revision has. */
  totalFils: bigint;
  /** The previous revision's own sum, when there is one on the same footing. */
  previousTotalFils: bigint | null;
  deltaFils: bigint | null;
  /** Priced last time, absent now. Not in either total's rows here, so named apart. */
  dropped: DroppedLine[];
  /**
   * Requirement lines no line of this revision prices — Emirates Valve's
   * *"gasket line is not something we stock"*. Rendered grey, never hidden, and
   * never in the total. Empty when the revision links no line to the
   * requirement: unlinked is not evidence of unpriced.
   */
  notQuoted: RequirementLine[];
}

/** How a line in one revision is found in another: the requirement line, else the same words. */
function lineKey(line: Pick<NegotiationLine, "enquiryLineId" | "description">): string {
  return line.enquiryLineId
    ? `enquiry:${line.enquiryLineId}`
    : `words:${line.description.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

function bySortOrder<T extends { sortOrder: number; id: string }>(a: T, b: T): number {
  return a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * One revision against the one before it.
 *
 * `previous` is the supplier's preceding non-draft revision, or null for r1.
 * A proposal compares on its fee elsewhere; here it has no lines and totals
 * nothing, so callers branch on `quote.proposal` before reading `totalFils`.
 */
export function compareRevision(
  current: Pick<NegotiationQuote, "lines">,
  previous: Pick<NegotiationQuote, "lines"> | null,
  requirement: readonly RequirementLine[],
): RevisionComparison {
  const ordered = [...current.lines].sort(bySortOrder);
  const before = previous ? [...previous.lines].sort(bySortOrder) : [];

  // First match wins, and a previous line is matched once: two identical rows
  // stay two rows rather than both claiming the same predecessor.
  const unclaimed = new Map<string, NegotiationLine[]>();
  for (const line of before) {
    const key = lineKey(line);
    unclaimed.set(key, [...(unclaimed.get(key) ?? []), line]);
  }

  const seen = new Map<string, number>();
  const lines: ComparedLine[] = ordered.map((line) => {
    const key = lineKey(line);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);

    const unitFils = parseAedToFils(line.unitPrice);
    const lineFils = lineTotalFils({ qty: line.qty, unitPrice: line.unitPrice });
    const candidates = unclaimed.get(key);
    const match = previous && candidates && candidates.length > 0 ? candidates.shift()! : null;

    if (!previous || !match) {
      return {
        key: `${key}#${occurrence}`,
        description: line.description,
        qty: line.qty,
        unitFils,
        lineFils,
        previousUnitFils: null,
        previousQty: null,
        // r1 has nothing to be new against.
        change: previous ? "new" : "same",
      };
    }

    const matchUnit = parseAedToFils(match.unitPrice);
    const priceMoved = matchUnit !== unitFils;
    const qtyMoved = match.qty !== line.qty;
    return {
      key: `${key}#${occurrence}`,
      description: line.description,
      qty: line.qty,
      unitFils,
      lineFils,
      previousUnitFils: priceMoved ? matchUnit : null,
      previousQty: qtyMoved ? match.qty : null,
      change: priceMoved || qtyMoved ? "changed" : "same",
    };
  });

  const dropped: DroppedLine[] = [];
  for (const [key, rest] of unclaimed) {
    rest.forEach((line, index) =>
      dropped.push({
        key: `${key}#dropped${index}`,
        description: line.description,
        qty: line.qty,
        unitFils: parseAedToFils(line.unitPrice),
      }),
    );
  }

  const linked = new Set(ordered.map((line) => line.enquiryLineId).filter((id): id is string => id !== null));
  const notQuoted =
    linked.size === 0 ? [] : [...requirement].sort(bySortOrder).filter((line) => !linked.has(line.id));

  const totalFils = quoteTotalFils(ordered.map((line) => ({ qty: line.qty, unitPrice: line.unitPrice })));
  const previousTotalFils = previous
    ? quoteTotalFils(before.map((line) => ({ qty: line.qty, unitPrice: line.unitPrice })))
    : null;

  return {
    lines,
    totalFils,
    previousTotalFils,
    deltaFils: previousTotalFils === null ? null : totalFils - previousTotalFils,
    dropped,
    notQuoted,
  };
}

/** Every non-draft revision from one supplier, oldest first, each with the one it replaced. */
export function revisionPairs<Q extends Pick<NegotiationQuote, "revision" | "lines" | "proposal">>(
  quotes: readonly Q[],
): { quote: Q; previous: Q | null }[] {
  const ordered = [...quotes].sort((a, b) => a.revision - b.revision);
  return ordered.map((quote, index) => {
    const previous = index === 0 ? null : ordered[index - 1]!;
    /*
       A goods revision compares with a goods revision and a proposal with a
       proposal on the same basis. Anything else has no previous figure: a fee
       per month after a fixed fee is not "lower" by the difference.
    */
    const comparable =
      previous !== null &&
      (quote.proposal === null) === (previous.proposal === null) &&
      (quote.proposal === null || quote.proposal.feeBasis === previous.proposal?.feeBasis);
    return { quote, previous: comparable ? previous : null };
  });
}

/* ── The rail ──────────────────────────────────────────────────────────────── */

/** Characters in a rail preview before it is cut. Two lines at the rail's width. */
export const PREVIEW_CHARS = 48;

/**
 * `B4` — the last message's opening clause, truncated. Never a summary.
 *
 * A clause ends at a sentence stop, a colon or semicolon, a dash set in spaces,
 * or a line break. Cut on a word boundary with an ellipsis when it is longer
 * than `max`, and given an ellipsis when the message goes on past the clause, so
 * a buyer can tell a whole short note from the start of a longer one.
 */
export function openingClause(body: string, max = PREVIEW_CHARS): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat === "") return "";

  const firstLine = (body.trim().split(/\n/)[0] ?? "").replace(/\s+/g, " ").trim();
  const stop = /(?<=[.?!])\s|[:;]\s|\s[—–-]\s/.exec(firstLine);
  const clause = (stop ? firstLine.slice(0, stop.index) : firstLine).replace(/[\s.:;,]+$/, "");
  const continues = clause.length < flat.replace(/[\s.:;,]+$/, "").length;

  if (clause.length <= max) return continues ? `${clause}…` : clause;
  const cut = clause.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,:;]+$/, "")}…`;
}

export type ThreadState =
  /** The buyer accepted this supplier's quote. */
  | "accepted"
  /** The buyer accepted another supplier's. `7c`'s auto-decline, said from this side. */
  | "not_chosen"
  /** The supplier declined the enquiry, in their own words. */
  | "declined"
  /** Their latest word is a revision, r2 or later. */
  | "revised"
  /** A quote that leaves requirement lines unpriced. */
  | "partial"
  | "quoted"
  /** They wrote, and have not quoted. */
  | "replied"
  /**
   * `B9` — nothing from them at all. A state, not an absence: it stays in the
   * rail, it survives the enquiry closing, and it is the signal `4f` reads.
   */
  | "no_reply";

export interface RailFacts {
  businessId: string;
  /** `Enquiry.contactReleasedToBusinessId`. */
  releasedTo: string | null;
  declinedAt: Date | null;
  /** The supplier's latest non-draft revision, if any. */
  latestQuote: Pick<NegotiationQuote, "revision" | "sentAt" | "lines" | "proposal"> | null;
  /** The last message on the thread, from either side. */
  lastMessage: { body: string; fromSeller: boolean; createdAt: Date; attachments: number } | null;
  /** Whether the supplier has said anything, message or quote. */
  sellerHasWritten: boolean;
  requirement: readonly RequirementLine[];
}

export function threadState(facts: RailFacts): ThreadState {
  if (facts.releasedTo === facts.businessId) return "accepted";
  if (facts.releasedTo !== null) return "not_chosen";
  if (facts.declinedAt) return "declined";

  const quote = facts.latestQuote;
  if (quote) {
    if (quote.revision >= 2) return "revised";
    if (!quote.proposal && compareRevision(quote, null, facts.requirement).notQuoted.length > 0) return "partial";
    return "quoted";
  }
  return facts.sellerHasWritten ? "replied" : "no_reply";
}

/** When the thread last moved: the later of its last message and its latest revision. */
export function lastActivity(facts: Pick<RailFacts, "latestQuote" | "lastMessage">): Date | null {
  const times = [facts.lastMessage?.createdAt, facts.latestQuote?.sentAt].filter(
    (at): at is Date => at instanceof Date,
  );
  if (times.length === 0) return null;
  return new Date(Math.max(...times.map((at) => at.getTime())));
}

export type RailPreview =
  | { kind: "message"; text: string; fromMe: boolean }
  /** A file with no words — the preview names the file count rather than inventing a sentence. */
  | { kind: "files"; count: number; fromMe: boolean }
  /** A revision with no message at all. Its reference and figure, which are the record's own. */
  | { kind: "quote"; revision: number; totalFils: bigint | null; proposal: { feeAed: string; feeBasisLabel: string } | null }
  | { kind: "none" };

export function railPreview(facts: Pick<RailFacts, "latestQuote" | "lastMessage">): RailPreview {
  const message = facts.lastMessage;
  const quote = facts.latestQuote;
  const quoteIsLater =
    quote?.sentAt && (!message || quote.sentAt.getTime() > message.createdAt.getTime());

  if (quote && quoteIsLater) {
    return {
      kind: "quote",
      revision: quote.revision,
      totalFils: quote.proposal ? null : quoteTotalFils(quote.lines),
      proposal: quote.proposal,
    };
  }
  if (message) {
    const text = openingClause(message.body);
    if (text) return { kind: "message", text, fromMe: !message.fromSeller };
    if (message.attachments > 0) return { kind: "files", count: message.attachments, fromMe: !message.fromSeller };
  }
  return { kind: "none" };
}

/* ── Accepting ─────────────────────────────────────────────────────────────── */

export type AcceptOffer =
  /** Nothing to accept yet. */
  | { kind: "none" }
  | { kind: "offer"; quote: NegotiationQuote; otherRecipients: number }
  /** The latest revision's window has passed. Ask for a new one here (board `10h` states). */
  | { kind: "expired"; quote: NegotiationQuote; expiredAt: Date }
  | { kind: "accepted_here"; quote: NegotiationQuote | null }
  | { kind: "accepted_elsewhere" }
  /** Closed with nothing accepted: read-only, and re-send is `10e`'s. */
  | { kind: "enquiry_closed"; closedAt: Date }
  | { kind: "supplier_closed" }
  | { kind: "declined" };

/**
 * `B6` — accepting here is `7c`'s action, so it is offered exactly where
 * `acceptQuote` would take it and refused for the reason it would give.
 *
 * `latest` is the supplier's latest non-draft revision. The button always names
 * that one (board `10h` states, *multiple revisions*); an earlier revision is
 * never offered, because the service refuses it as `revised`.
 */
export function acceptOffer(input: {
  businessId: string;
  releasedTo: string | null;
  closesAt: Date;
  supplierClosed: boolean;
  declined: boolean;
  latest: NegotiationQuote | null;
  recipientCount: number;
  now: Date;
}): AcceptOffer {
  const { latest, now } = input;
  if (input.releasedTo === input.businessId) return { kind: "accepted_here", quote: latest };
  if (input.releasedTo !== null) return { kind: "accepted_elsewhere" };
  if (input.closesAt.getTime() <= now.getTime()) return { kind: "enquiry_closed", closedAt: input.closesAt };
  if (input.supplierClosed) return { kind: "supplier_closed" };
  if (input.declined && !latest) return { kind: "declined" };
  if (!latest || latest.status === "lost") return { kind: "none" };
  if (latest.status === "expired") return { kind: "expired", quote: latest, expiredAt: latest.expiresAt ?? now };
  if (latest.expiresAt && latest.expiresAt.getTime() < now.getTime()) {
    return { kind: "expired", quote: latest, expiredAt: latest.expiresAt };
  }
  if (latest.status !== "sent" && latest.status !== "read") return { kind: "none" };
  return { kind: "offer", quote: latest, otherRecipients: Math.max(0, input.recipientCount - 1) };
}

/**
 * Whether either side may still write — the rule `postMessage` enforces, read
 * for the screen so the composer is absent exactly where a send would be refused.
 */
export function canWrite(input: {
  businessId: string;
  releasedTo: string | null;
  closesAt: Date;
  supplierClosed: boolean;
  now: Date;
}): boolean {
  if (input.supplierClosed) return false;
  if (input.releasedTo !== null) return input.releasedTo === input.businessId;
  return input.closesAt.getTime() >= input.now.getTime();
}

/* ── The timeline ──────────────────────────────────────────────────────────── */

export interface NegotiationAttachment {
  documentId: string;
  filename: string;
  bytes: number | null;
  mimeType: string | null;
}

export interface NegotiationMessage {
  id: string;
  body: string;
  fromSeller: boolean;
  senderId: string;
  createdAt: Date;
  readAt: Date | null;
  flagged: boolean;
  automatic: boolean;
  quoteRevisionId: string | null;
  attachments: readonly NegotiationAttachment[];
}

export interface TimelineEntry {
  key: string;
  at: Date;
  fromSeller: boolean;
  /** Null for a revision that arrived without a message. */
  message: NegotiationMessage | null;
  /** The revision this entry carries, if any. */
  quote: NegotiationQuote | null;
}

/**
 * Messages and revisions in the order they happened.
 *
 * A revision is sent from the lead screen and writes no message, so most arrive
 * on their own; those become an entry at their `sentAt`, carrying the supplier's
 * note as its words. A message that names a revision carries it instead, once —
 * the first message to cite a revision is where it appears, and it does not
 * appear twice.
 */
export function timeline(
  messages: readonly NegotiationMessage[],
  quotes: readonly NegotiationQuote[],
): TimelineEntry[] {
  const byId = new Map(quotes.map((quote) => [quote.id, quote]));
  const carried = new Set<string>();

  const entries: TimelineEntry[] = messages.map((message) => {
    const quote = message.quoteRevisionId ? byId.get(message.quoteRevisionId) : undefined;
    const carries = quote && !carried.has(quote.id) ? quote : null;
    if (carries) carried.add(carries.id);
    return { key: `m:${message.id}`, at: message.createdAt, fromSeller: message.fromSeller, message, quote: carries };
  });

  for (const quote of quotes) {
    if (carried.has(quote.id) || !quote.sentAt) continue;
    entries.push({ key: `q:${quote.id}`, at: quote.sentAt, fromSeller: true, message: null, quote });
  }

  return entries.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** The Dubai calendar day an instant falls on, `YYYY-MM-DD` — the key a day divider changes on. */
export function dubaiDayKey(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
