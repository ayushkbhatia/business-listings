import type {
  ThreadAttachmentView,
  ThreadLabels,
  ThreadMessageView,
  ThreadQuoteView,
} from "@/components/domain/Thread";
import { formatAED, formatBytes, formatClock, formatCount, formatDate, formatDateShort } from "@/lib/format";
import { t } from "@/lib/i18n";
import { feeOnBasis } from "@/lib/quote/proposal-words";
import { filsToAed, parseAedToFils } from "@/lib/quote/money";
import {
  compareRevision,
  dubaiDayKey,
  revisionPairs,
  type NegotiationAttachment,
  type NegotiationQuote,
  type RailPreview,
  type RequirementLine,
  type ThreadState,
  type TimelineEntry,
} from "./negotiation";

/**
 * Board `10h` — the negotiation thread, in words.
 *
 * Every figure is formatted from a value `negotiation.ts` derived; nothing here
 * adds anything up. Both sides of a thread read through `threadMessageViews`, so
 * the buyer and the seller cannot be shown two renderings of one revision.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/* ── Figures ───────────────────────────────────────────────────────────────── */

/**
 * `AED 14,600`, or `AED 14,600.50` when there are fils.
 *
 * Whole dirhams as the board draws them; the fils when they exist, because a
 * total rounded to the dirham is a total the buyer cannot reproduce from the
 * rows above it — board 3m's lesson, on a different screen.
 */
export function amountWords(fils: bigint): string {
  const aed = filsToAed(fils < 0n ? -fils : fils);
  const style = aed.endsWith(".00") ? "display" : "exact";
  return formatAED(aed, { style });
}

/** `−AED 280`, `+AED 1,136`, with a real minus sign. */
export function deltaWords(fils: bigint): { label: string; direction: "up" | "down" | "same" } {
  if (fils === 0n) return { label: t("negotiation.delta.same"), direction: "same" };
  const direction = fils < 0n ? "down" : "up";
  return {
    label: t(direction === "down" ? "negotiation.delta.down" : "negotiation.delta.up", { amount: amountWords(fils) }),
    direction,
  };
}

/** `191.00`, for a column whose head carries the currency. */
function unitWords(fils: bigint): string {
  return formatAED(filsToAed(fils), { style: "quote" });
}

/** `Butterfly valve DN100 × 40`, or the description alone for a line priced as a whole. */
function lineWords(description: string, qty: number | null): string {
  return qty === null ? description : t("negotiation.line_qty", { description, qty: formatCount(qty) });
}

/** `19 Aug` this year, `19 Aug 2025` otherwise. */
function dayWords(at: Date, now: Date): string {
  return dubaiDayKey(at).slice(0, 4) === dubaiDayKey(now).slice(0, 4) ? formatDateShort(at) : formatDate(at);
}

/**
 * `B8` — a revision states its validity, or says it has none.
 *
 * Q2 is answered by the model rather than by copy: `validityDays` and
 * `expiresAt` are per revision, so r2 carries its own window rather than
 * inheriting r1's.
 */
export function validityWords(
  quote: Pick<NegotiationQuote, "validityDays" | "expiresAt" | "status">,
  now: Date,
): { label: string; expired: boolean } {
  if (quote.status === "expired" || (quote.expiresAt && quote.expiresAt.getTime() < now.getTime())) {
    return {
      label: quote.expiresAt
        ? t("negotiation.validity.expired", { date: dayWords(quote.expiresAt, now) })
        : t("negotiation.validity.expired_undated"),
      expired: true,
    };
  }
  if (!quote.expiresAt) return { label: t("negotiation.validity.none"), expired: false };
  return {
    label: t("negotiation.validity.held", { days: quote.validityDays, date: dayWords(quote.expiresAt, now) }),
    expired: false,
  };
}

/* ── One revision ──────────────────────────────────────────────────────────── */

export function quoteView(input: {
  quote: NegotiationQuote;
  /** The comparable revision before it, as `revisionPairs` decides. */
  previous: NegotiationQuote | null;
  requirement: readonly RequirementLine[];
  /** The latest revision renders as the priced table; an earlier one as a document. */
  latest: boolean;
  now: Date;
  pdfHref?: string | undefined;
}): ThreadQuoteView {
  const { quote, previous, now } = input;
  const validity = validityWords(quote, now);
  const base = {
    ref: quote.ref,
    revision: quote.revision,
    validityLabel: validity.label,
    expired: validity.expired,
    ...(input.pdfHref ? { pdfHref: input.pdfHref } : {}),
  };

  if (quote.proposal) {
    const change =
      previous?.proposal && previous.proposal.feeBasis === quote.proposal.feeBasis
        ? parseAedToFils(quote.proposal.feeAed) - parseAedToFils(previous.proposal.feeAed)
        : null;
    const delta = change === null ? null : deltaWords(change);
    return {
      ...base,
      presentation: "card",
      title: t("negotiation.quote.proposal_title", { revision: quote.revision, ref: quote.ref }),
      totalLabel: feeOnBasis(quote.proposal),
      ...(previous?.proposal && delta ? { previousTotalLabel: feeOnBasis(previous.proposal) } : {}),
      ...(delta ? { deltaLabel: delta.label, direction: delta.direction } : {}),
    };
  }

  const compared = compareRevision(quote, previous, input.requirement);
  const delta = compared.deltaFils === null ? null : deltaWords(compared.deltaFils);
  const table = input.latest;

  return {
    ...base,
    presentation: table ? "table" : "card",
    title: table
      ? quote.revision >= 2
        ? t("negotiation.quote.revised_title", { revision: quote.revision })
        : t("negotiation.quote.first_title", { revision: quote.revision })
      : t("negotiation.quote.document_title", { ref: quote.ref }),
    totalLabel: amountWords(compared.totalFils),
    ...(delta ? { deltaLabel: delta.label, direction: delta.direction } : {}),
    lines: compared.lines.map((line) => ({
      key: line.key,
      label: lineWords(line.description, line.qty),
      unitLabel: unitWords(line.unitFils),
      ...(line.previousUnitFils !== null ? { previousUnitLabel: unitWords(line.previousUnitFils) } : {}),
      ...(line.previousQty !== null ? { previousQtyLabel: t("negotiation.qty_only", { qty: formatCount(line.previousQty) }) } : {}),
      lineTotalLabel: unitWords(line.lineFils),
      ...(line.change === "new" ? { isNew: true } : {}),
    })),
    notQuoted: compared.notQuoted.map((line) => ({ key: `nq:${line.id}`, label: lineWords(line.description, line.qty) })),
    dropped: compared.dropped.map((line) => ({
      key: line.key,
      label: lineWords(line.description, line.qty),
      previousUnitLabel: unitWords(line.unitFils),
    })),
  };
}

/* ── The log ───────────────────────────────────────────────────────────────── */

function attachmentWords(file: NegotiationAttachment, href: string | undefined): ThreadAttachmentView {
  const kind =
    file.mimeType === "application/pdf" ? "PDF" : file.mimeType === "image/png" ? "PNG" : file.mimeType === "image/jpeg" ? "JPEG" : null;
  const meta = [kind, file.bytes !== null ? formatBytes(file.bytes) : null].filter(Boolean).join(" · ");
  return { key: file.documentId, name: file.filename, meta, ...(href ? { href } : {}) };
}

export function threadMessageViews(input: {
  entries: readonly TimelineEntry[];
  /** Which side is reading. Decides which bubbles are "mine" and where receipts show. */
  viewer: "buyer" | "seller";
  /** Every non-draft revision on this thread, for comparison. */
  quotes: readonly NegotiationQuote[];
  requirement: readonly RequirementLine[];
  now: Date;
  /** The revision drawn with the selection border — the one the accept button names. */
  emphasisQuoteId?: string | null;
  senderLabel?: (entry: TimelineEntry) => string | undefined;
  pdfHref?: (quote: NegotiationQuote) => string | undefined;
  fileHref?: (documentId: string) => string | undefined;
}): ThreadMessageView[] {
  const pairs = new Map(revisionPairs(input.quotes).map((pair) => [pair.quote.id, pair.previous]));
  const latest = [...input.quotes].sort((a, b) => b.revision - a.revision)[0] ?? null;

  return input.entries.map((entry) => {
    const fromMe = input.viewer === "buyer" ? !entry.fromSeller : entry.fromSeller;
    const message = entry.message;
    const quote = entry.quote;
    const sender = input.senderLabel?.(entry);
    const recent = input.now.getTime() - entry.at.getTime();

    return {
      id: entry.key,
      body: message?.body ?? quote?.note ?? "",
      fromMe,
      ...(sender ? { senderLabel: sender } : {}),
      at: formatClock(entry.at),
      ...(recent >= 0 && recent < DAY ? { atRelative: relativeWords(entry.at, input.now) } : {}),
      ...(fromMe && message?.readAt ? { receipt: t("negotiation.read") } : {}),
      dayKey: dubaiDayKey(entry.at),
      dayLabel: dayWords(entry.at, input.now),
      flagged: message?.flagged ?? false,
      automatic: message?.automatic ?? false,
      ...(quote
        ? {
            quote: quoteView({
              quote,
              previous: pairs.get(quote.id) ?? null,
              requirement: input.requirement,
              latest: latest?.id === quote.id,
              now: input.now,
              pdfHref: input.pdfHref?.(quote),
            }),
          }
        : {}),
      ...(message && message.attachments.length > 0
        ? { attachments: message.attachments.map((file) => attachmentWords(file, input.fileHref?.(file.documentId))) }
        : {}),
      ...(quote && input.emphasisQuoteId === quote.id ? { emphasis: true } : {}),
    };
  });
}

/**
 * `12 min ago`, `2 h ago`, `yesterday`, `19 Aug` — coarse on purpose.
 *
 * Whole units and a calendar *yesterday*, the way the board's rail reads. The
 * Dubai calendar decides which day is yesterday, not a 24-hour subtraction.
 */
export function relativeWords(at: Date, now: Date): string {
  const ms = now.getTime() - at.getTime();
  if (ms < 60_000) return t("negotiation.time.now");
  if (ms < HOUR) return t("negotiation.time.minutes", { count: Math.floor(ms / 60_000) });
  const today = dubaiDayKey(now);
  if (dubaiDayKey(at) === today) return t("negotiation.time.hours", { count: Math.floor(ms / HOUR) });
  if (dubaiDayKey(new Date(now.getTime() - DAY)) === dubaiDayKey(at)) return t("negotiation.time.yesterday");
  return dayWords(at, now);
}

/* ── The rail ──────────────────────────────────────────────────────────────── */

export function railPreviewWords(preview: RailPreview): string | null {
  switch (preview.kind) {
    case "message":
      return preview.fromMe ? t("negotiation.rail.you", { text: preview.text }) : preview.text;
    case "files":
      return t(preview.fromMe ? "negotiation.rail.files_you" : "negotiation.rail.files", { count: preview.count });
    case "quote":
      return preview.proposal
        ? t("negotiation.rail.proposal", { revision: preview.revision, figure: feeOnBasis(preview.proposal) })
        : t("negotiation.rail.quote", { revision: preview.revision, figure: amountWords(preview.totalFils ?? 0n) });
    default:
      return null;
  }
}

export function railStateWords(
  state: ThreadState,
  facts: { revision: number | null; pricedLines: number; totalLines: number },
): string | null {
  switch (state) {
    case "accepted":
      return t("negotiation.state.accepted");
    case "not_chosen":
      return t("negotiation.state.not_chosen");
    case "declined":
      return t("negotiation.state.declined");
    case "revised":
      return t("negotiation.state.revised", { revision: facts.revision ?? 2 });
    case "partial":
      return t("negotiation.state.partial", { priced: facts.pricedLines, total: facts.totalLines });
    case "quoted":
      return t("negotiation.state.quoted");
    case "replied":
      return t("negotiation.state.replied");
    default:
      return null;
  }
}

/* ── Labels ────────────────────────────────────────────────────────────────── */

/**
 * The strings `Thread` renders, for either side.
 *
 * Built where it is used — a client component — because several are functions,
 * and a function cannot cross from a server component into a client one.
 */
export function threadLabels(names: { logLabel: string; formLabel: string }, side: "buyer" | "seller"): ThreadLabels {
  return {
    heading: t("thread.heading"),
    formLabel: names.formLabel,
    logLabel: names.logLabel,
    empty: t("thread.empty"),
    composerLabel: t("thread.composer"),
    placeholder: t(side === "buyer" ? "negotiation.placeholder" : "thread.placeholder"),
    send: t("thread.send"),
    sending: t("thread.sending"),
    quickRepliesLabel: t("thread.quick_replies"),
    flagged: t("thread.flagged"),
    flaggedExplain: t("thread.flagged_explain"),
    automatic: t("thread.automatic"),
    automaticExplain: t("thread.automatic_explain"),
    colLine: t("negotiation.col.line"),
    colUnit: t("negotiation.col.unit"),
    colLineTotal: t("negotiation.col.line_total"),
    total: t("negotiation.total"),
    notQuoted: t("negotiation.not_quoted"),
    dropped: t("negotiation.dropped"),
    newLine: t("negotiation.new_line"),
    showLines: (count) => t("negotiation.show_lines", { count }),
    pdf: t("negotiation.pdf"),
    openFile: (name) => t("negotiation.open_file", { name }),
    was: (figure) => t("negotiation.was", { figure }),
  };
}
