import type { ThreadChip } from "@/components/domain";
import { tierSpec } from "@/components/domain/verification";
import { formatDate, formatDuration, formatList } from "@/lib/format";
import { t } from "@/lib/i18n";
import { spell } from "@/lib/enquiry/spell";
import {
  acceptOffer,
  canWrite,
  compareRevision,
  lastActivity,
  openingClause,
  railPreview,
  revisionPairs,
  threadState,
  timeline,
  type NegotiationQuote,
} from "@/lib/messaging/negotiation";
import {
  amountWords,
  railPreviewWords,
  railStateWords,
  relativeWords,
  threadMessageViews,
  validityWords,
} from "@/lib/messaging/negotiation-words";
import type { Negotiation } from "@/lib/messaging/negotiation-server";
import { feeOnBasis } from "@/lib/quote/proposal-words";
import { releaseSentences } from "@/lib/enquiry/release-words";
import type { AcceptControl, BuyerNegotiationProps } from "./NegotiationClient";
import type { NegotiationLayoutProps, RailRowView } from "./_view";

/**
 * Board `10h` — one negotiation, from rows to words.
 *
 * Pure, and the only path from a `Negotiation` to the screen: the page calls it
 * with what the database holds and the gallery with fixtures shaped the same, so
 * a state drawn in `/dev/gallery` is a state the page can reach.
 */
export function buildNegotiationView(
  negotiation: Negotiation,
  context: { now: Date; token: string | null; acceptError: string | null },
): { layout: Omit<NegotiationLayoutProps, "children">; thread: BuyerNegotiationProps } {
  const { enquiry, supplier, record, rail } = negotiation;
  const { now, token } = context;
  const withToken = (path: string) =>
    token ? `${path}${path.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}` : path;
  const base = `/enquiry/${encodeURIComponent(enquiry.ref)}`;
  const threadBase = `${base}/thread/${supplier.slug}`;

  /* ── The rail ─────────────────────────────────────────────────────────── */

  const rows: (RailRowView & { order: number; delivered: number })[] = rail.map((thread) => {
    const facts = {
      businessId: thread.businessId,
      releasedTo: enquiry.releasedTo,
      declinedAt: thread.declinedAt,
      latestQuote: thread.latestQuote,
      lastMessage: thread.lastMessage,
      sellerHasWritten: thread.sellerHasWritten,
      requirement: record.requirement,
    };
    const state = threadState(facts);
    const at = lastActivity(facts);
    const priced =
      thread.latestQuote && !thread.latestQuote.proposal
        ? record.requirement.length - compareRevision(thread.latestQuote, null, record.requirement).notQuoted.length
        : 0;
    const stateWords = railStateWords(state, {
      revision: thread.latestQuote?.revision ?? null,
      pricedLines: priced,
      totalLines: record.requirement.length,
    });
    const preview = railPreviewWords(railPreview(facts));
    const current = thread.businessId === supplier.id;

    return {
      key: thread.businessId,
      href: withToken(`${base}/thread/${thread.slug}`),
      name: thread.displayName,
      // B9: silence is a row of its own, never an empty one.
      preview: state === "no_reply" ? t("negotiation.rail.no_reply") : preview,
      stateLine: state === "no_reply" ? null : [stateWords, at ? relativeWords(at, now) : null].filter(Boolean).join(" · "),
      tone: state === "revised" || state === "accepted" ? "ok" : "plain",
      silent: state === "no_reply",
      current,
      unreadLabel: !current && thread.unread > 0 ? t("negotiation.rail.unread", { count: thread.unread }) : null,
      order: at ? at.getTime() : -1,
      delivered: thread.deliveredAt.getTime(),
    };
  });
  // Most recent movement first, silence last — and among the silent, the order they were sent.
  rows.sort((a, b) => b.order - a.order || a.delivered - b.delivered || a.name.localeCompare(b.name));

  /* ── The header ───────────────────────────────────────────────────────── */

  const spec = tierSpec(supplier.verificationTier);
  const subline = [
    supplier.person
      ? supplier.person.role
        ? t("negotiation.header.person", {
            name: supplier.person.name,
            role: t(`team.role.${supplier.person.role}` as "team.role.seller_sales"),
          })
        : supplier.person.name
      : null,
    supplier.responseTimeMedianMs !== null
      ? t("negotiation.header.replies", { duration: formatDuration(supplier.responseTimeMedianMs) })
      : t("negotiation.header.unmeasured"),
  ]
    .filter(Boolean)
    .join(" · ");

  /* ── The thread ───────────────────────────────────────────────────────── */

  const quotes = record.quotes;
  const latest = [...quotes].sort((a, b) => b.revision - a.revision)[0] ?? null;
  const offer = acceptOffer({
    businessId: supplier.id,
    releasedTo: enquiry.releasedTo,
    closesAt: enquiry.closesAt,
    supplierClosed: supplier.closed,
    declined: supplier.declinedAt !== null,
    latest,
    recipientCount: rail.length,
    now,
  });
  const others = rail.filter((thread) => thread.businessId !== supplier.id).map((thread) => thread.displayName);
  const previous = latest ? (revisionPairs(quotes).find((pair) => pair.quote.id === latest.id)?.previous ?? null) : null;

  const messages = threadMessageViews({
    entries: timeline(record.messages, quotes),
    viewer: "buyer",
    quotes,
    requirement: record.requirement,
    now,
    emphasisQuoteId: offer.kind === "offer" || offer.kind === "expired" ? latest?.id ?? null : null,
    pdfHref: (quote) => (quote.proposal ? undefined : withToken(`${threadBase}/quote/${quote.revision}/pdf`)),
    fileHref: (documentId) => withToken(`${threadBase}/files/${documentId}`),
  });

  const figure = (quote: NegotiationQuote) =>
    quote.proposal ? feeOnBasis(quote.proposal) : amountWords(compareRevision(quote, previous, record.requirement).totalFils);

  let accept: AcceptControl = { kind: "none" };
  const leadingChips: ThreadChip[] = [];

  if (offer.kind === "offer" && enquiry.buyerCompanyId) {
    /*
       Board `7b`: the company's rule is read before the click, on the accept
       screen, which says whether this is within the person's authority or goes
       to a colleague for approval. The button keeps its words.
    */
    accept = {
      kind: "company",
      href: `${base}/accept/${offer.quote.id}`,
      buttonLabel: t("negotiation.accept.button", { revision: offer.quote.revision, figure: figure(offer.quote) }),
      footnote: t("company.notice.thread_footnote"),
    };
  } else if (offer.kind === "offer") {
    const quote = offer.quote;
    const compared = quote.proposal ? null : compareRevision(quote, previous, record.requirement);
    accept = {
      kind: "offer",
      quoteId: quote.id,
      revision: quote.revision,
      buttonLabel: t("negotiation.accept.button", { revision: quote.revision, figure: figure(quote) }),
      footnote:
        offer.otherRecipients > 0
          ? t("negotiation.accept.footnote", {
              others: t("negotiation.accept.footnote_others", {
                count: offer.otherRecipients,
                word: spell(offer.otherRecipients),
              }),
            })
          : t("negotiation.accept.footnote_single"),
      dialog: {
        title: t("negotiation.accept.dialog_title", { revision: quote.revision, supplier: supplier.displayName }),
        description: t("negotiation.accept.dialog_description"),
        facts: [
          compared
            ? t("negotiation.accept.fact_figure", {
                figure: amountWords(compared.totalFils),
                lines: t("negotiation.accept.fact_lines", { count: compared.lines.length }),
              })
            : t("negotiation.accept.fact_figure_proposal", { figure: figure(quote) }),
          validityWords(quote, now).label,
          // Board `1n` `B9`: what is released, named as the query layer releases it.
          // A company enquiry never reaches this dialog — it accepts on `7b`'s screen.
          ...releaseSentences({ companyName: null, hasDeliveryAddress: false }, supplier.displayName),
          ...(others.length > 0 ? [t("negotiation.accept.fact_declined", { names: formatList(others) })] : []),
          t("negotiation.accept.fact_no_payment", { supplier: supplier.displayName }),
          t("negotiation.accept.fact_record"),
        ],
        warning:
          compared && compared.notQuoted.length > 0
            ? t("negotiation.accept.unaccepted_lines", { count: compared.notQuoted.length })
            : null,
        confirm: t("negotiation.accept.confirm", { revision: quote.revision }),
      },
    };
  } else if (offer.kind === "expired") {
    accept = {
      kind: "expired",
      buttonLabel: t("negotiation.accept.button_short", { revision: offer.quote.revision }),
      footnote: t("negotiation.accept.expired", {
        revision: offer.quote.revision,
        date: formatDate(offer.expiredAt),
        supplier: supplier.displayName,
      }),
    };
    leadingChips.push({ label: t("thread.chip.new_revision"), text: t("thread.chip.new_revision_text") });
  } else if (offer.kind === "accepted_here") {
    accept = { kind: "record", href: withToken(`${base}/accepted`), label: t("negotiation.accept.view_record") };
  }

  const notice: BuyerNegotiationProps["notice"] =
    offer.kind === "accepted_here"
      ? {
          tone: "ok",
          text: t("negotiation.notice.accepted_here", {
            revision: quotes.find((quote) => quote.status === "accepted")?.revision ?? latest?.revision ?? 1,
            supplier: supplier.displayName,
          }),
        }
      : offer.kind === "accepted_elsewhere"
        ? {
            tone: "neutral",
            text: enquiry.winnerName
              ? t("negotiation.notice.accepted_elsewhere", {
                  winner: enquiry.winnerName,
                  date: enquiry.releasedAt ? formatDate(enquiry.releasedAt) : "",
                  supplier: supplier.displayName,
                })
              : t("negotiation.notice.accepted_elsewhere_unnamed", {
                  date: enquiry.releasedAt ? formatDate(enquiry.releasedAt) : "",
                  supplier: supplier.displayName,
                }),
          }
        : offer.kind === "enquiry_closed"
          ? {
              tone: "neutral",
              text: t("negotiation.notice.closed", { date: formatDate(enquiry.closesAt) }),
              action: { href: withToken(`/rfq/new?resend=${encodeURIComponent(enquiry.ref)}`), label: t("negotiation.notice.resend") },
            }
          : offer.kind === "supplier_closed"
            ? { tone: "neutral", text: t("thread.supplier_closed") }
            : supplier.declinedAt
              ? {
                  tone: "neutral",
                  text: supplier.declineReason
                    ? t("negotiation.notice.declined", { supplier: supplier.displayName, reason: supplier.declineReason })
                    : t("negotiation.notice.declined_bare", { supplier: supplier.displayName }),
                }
              : record.messages.every((message) => !message.fromSeller) && quotes.length === 0
                ? { tone: "neutral", text: t("negotiation.notice.no_reply", { supplier: supplier.displayName }) }
                : null;

  return {
    layout: {
      rail: {
        heading: t("negotiation.rail.heading", {
          ref: enquiry.ref,
          threads: t("negotiation.rail.threads", { count: rail.length }),
        }),
        eyebrow: openingClause(enquiry.requirement, 40),
        label: t("negotiation.rail.label", { ref: enquiry.ref }),
        href: withToken(base),
        rows: rows.map((row) => ({
          key: row.key,
          href: row.href,
          name: row.name,
          preview: row.preview,
          stateLine: row.stateLine,
          tone: row.tone,
          silent: row.silent,
          current: row.current,
          unreadLabel: row.unreadLabel,
        })),
      },
      header: {
        name: supplier.displayName,
        categoryCode: supplier.categoryCode ?? undefined,
        tier: supplier.verificationTier,
        badgeLabel: t(spec.labelKey as never),
        badgeChecked: t(spec.checkedKey as never),
        ...(spec.dateField === "verifiedAt" && supplier.verifiedAt ? { badgeDate: formatDate(supplier.verifiedAt) } : {}),
        subline,
        storefrontHref: supplier.published ? `/b/${supplier.slug}` : null,
        storefrontLabel: t("negotiation.view_storefront"),
      },
    },
    thread: {
      enquiryId: enquiry.id,
      businessId: supplier.id,
      supplierSlug: supplier.slug,
      supplierName: supplier.displayName,
      token,
      messages,
      readOnly: !canWrite({
        businessId: supplier.id,
        releasedTo: enquiry.releasedTo,
        closesAt: enquiry.closesAt,
        supplierClosed: supplier.closed,
        now,
      }),
      notice,
      accept,
      leadingChips,
      acceptError: context.acceptError,
    },
  };
}
