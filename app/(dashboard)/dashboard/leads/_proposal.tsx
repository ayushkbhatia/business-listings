import { after } from "next/server";
import { notFound } from "next/navigation";
import { PageEvent } from "@/components/telemetry";
import { can } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import { markLeadOpened } from "@/lib/db/mutations/lead";
import { getLeadDetail, type LeadDetail } from "@/lib/db/queries/seller";
import { briefFactWords } from "@/lib/enquiry/service-brief-words";
import { formatBytes, formatCount, formatCountdown, formatDate, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { assignableSeats } from "@/lib/leads/assign";
import { replyDueAt, type LeadScope, type LeadTab } from "@/lib/leads/inbox";
import { quoteFence, type QuoteFenceReason } from "@/lib/quote/fence";
import { PROPOSAL_DEFAULT_VALIDITY_DAYS, type ProposalInput } from "@/lib/quote/proposal";
import { findProposalDraft, proposalServicesFor, type ProposalService } from "@/lib/quote/proposal-server";
import { feeOnBasis, mobilisationWords, termWords, typedAmount } from "@/lib/quote/proposal-words";
import { workEnquiryOf } from "@/lib/quote/work-enquiry";
import type { SellerSeat } from "../_shell";
import { railHref } from "./_rail";
import { DeclineLead } from "./DeclineLead";
import { LeadActions } from "./LeadActions";
import { ProposalComposer, type ProposalServiceOption } from "./ProposalComposer";
import { ProposalLeadView, type BriefRow, type ProposalLeadModel, type SentProposalRow } from "./_proposal-view";

/**
 * Board `3j-s` — the lead for work, loaded.
 *
 * Everything the view needs, read once and handed over as a plain model. The
 * rules that decide the screen are the services' rules: `quoteFence` for whether
 * the composer is live, `proposalServicesFor` for which scope sheets it may
 * answer from, `findProposalDraft` for what to restore.
 */
export async function ProposalLeadPane({
  seat,
  enquiryId,
  tab,
  scope,
  now,
  suspended,
  seats,
}: {
  seat: SellerSeat;
  enquiryId: string;
  tab: LeadTab;
  scope: LeadScope;
  now: Date;
  suspended: boolean;
  seats: Awaited<ReturnType<typeof assignableSeats>>;
}) {
  const [lead, recipient, work] = await Promise.all([
    getLeadDetail(seat.businessId, enquiryId),
    prisma.enquiryRecipient.findUnique({
      where: { enquiryId_businessId: { enquiryId, businessId: seat.businessId } },
      select: {
        assignedToId: true,
        outcome: true,
        createdAt: true,
        declinedAt: true,
        declineReason: true,
        business: { select: { leadEscalationMinutes: true } },
        enquiry: {
          select: { contactReleasedToBusinessId: true, _count: { select: { recipients: true } } },
        },
      },
    }),
    workEnquiryOf(prisma, enquiryId),
  ]);
  if (!lead || !recipient || !work) notFound();

  // Reading the brief is opening the lead: the buyer's row says *Opened*.
  after(() => markLeadOpened(enquiryId, seat.businessId));

  const [services, draft] = await Promise.all([
    proposalServicesFor(seat.businessId, work),
    findProposalDraft(enquiryId, seat.businessId),
  ]);

  const fence = quoteFence(
    {
      businessId: seat.businessId,
      contactReleasedToBusinessId: recipient.enquiry.contactReleasedToBusinessId,
      recipientState: lead.state,
      outcome: recipient.outcome,
      declinedBySeller: recipient.declinedAt !== null,
      suspended,
      closesAt: lead.closesAt,
    },
    now,
  );

  const others = Math.max(0, recipient.enquiry._count.recipients - 1);
  const due = replyDueAt(recipient.createdAt, recipient.business.leadEscalationMinutes);
  const unanswered = lead.firstReplyAt === null;
  const askedService = lead.lines.find((line) => line.service !== null)?.service ?? null;
  const trade = lead.brief?.subcategoryName ?? askedService?.name ?? lead.ref;

  const model: ProposalLeadModel = {
    ref: lead.ref,
    title: lead.brief?.subcategoryName ?? askedService?.name ?? firstSentence(lead.requirement),
    replyChip: fence || !unanswered ? null : replyChip(due, now),
    othersLabel: others > 0 ? t("proposal.others_label", { count: others, formatted: formatCount(others) }) : null,
    backHref: railHref({ tab, scope }),
    brief: {
      rows: briefRows(lead),
      requirement: lead.requirement,
      attachments: lead.attachments.map((file) => ({
        id: file.id,
        filename: file.filename,
        href: `/dashboard/leads/${lead.enquiryId}/attachments/${file.id}`,
        size: file.bytes ? formatBytes(file.bytes) : null,
      })),
    },
    buyer: {
      name: lead.buyer.released ? (lead.buyer.fullName ?? lead.buyer.firstName) : lead.buyer.firstName,
      released: lead.buyer.released
        ? [lead.buyer.companyName, lead.buyer.phone, lead.buyer.email].filter((line): line is string => Boolean(line))
        : [],
    },
    state: fence
      ? readOnlyState(fence, {
          closesAt: lead.closesAt,
          declinedAt: recipient.declinedAt,
          declineReason: recipient.declineReason,
          buyerName: lead.buyer.firstName,
        })
      : services.length === 0
        ? { kind: "no_service", trade, href: "/dashboard/services" }
        : { kind: "compose" },
    sent: lead.quotes.flatMap((quote): SentProposalRow[] =>
      quote.proposal
        ? [
            {
              id: quote.id,
              ref: quote.ref,
              sentLabel: quote.sentAt ? t("lead.quote_sent_at", { when: formatRelative(quote.sentAt, { now }) }) : "",
              fee: feeOnBasis(quote.proposal),
              term: termWords(quote.proposal.termMonths),
              mobilisation: mobilisationWords(quote.proposal.mobilisationAed),
              validUntil: quote.expiresAt ? formatDate(quote.expiresAt) : t("proposal.not_stated"),
              status: t(`quotes.state.${quote.status}` as "quotes.state.sent"),
            },
          ]
        : [],
    ),
  };

  const last = lead.quotes.find((quote) => quote.proposal !== null)?.proposal ?? null;
  const nextRevision = draft?.revision ?? (lead.quotes[0]?.revision ?? 0) + 1;
  const canAssign = can(seat.actor, "routing.manage");
  const canMark = can(seat.actor, "enquiry.respond") && (canAssign || recipient.assignedToId === seat.actor.id);
  // Before any reply, and while the lead is still open to one.
  const canDecline = fence === null && lead.state !== "quoted" && canMark;

  const observedWin = recipient.enquiry.contactReleasedToBusinessId === seat.businessId;
  const outcome = recipient.outcome ?? (observedWin ? "won" : null);

  return (
    <>
      <PageEvent
        name="lead_opened"
        props={{ band: unanswered ? (now.getTime() >= due.getTime() ? "breached" : "waiting") : "answered", quoted: lead.state === "quoted" }}
      />
      <ProposalLeadView
        model={model}
        askHref={`/dashboard/leads/${lead.enquiryId}/thread`}
        askLabel={lead.state === "quoted" ? t("lead.message_buyer") : t("proposal.ask_first")}
        {...(canDecline
          ? { decline: <DeclineLead enquiryId={lead.enquiryId} buyerFirstName={lead.buyer.firstName} /> }
          : {})}
        {...(canAssign || (canMark && (lead.state === "quoted" || outcome !== null))
          ? {
              leadActions: (
                <LeadActions
                  enquiryId={lead.enquiryId}
                  threadHref={`/dashboard/leads/${lead.enquiryId}/thread`}
                  showMessage={false}
                  seats={[
                    { value: "", label: t("lead.assign_nobody") },
                    ...seats.map((s) => ({
                      value: s.id,
                      label: s.isSelf
                        ? t("lead.assign_self", { name: s.name || t("lead.assign_unnamed") })
                        : s.name || t("lead.assign_unnamed"),
                    })),
                  ]}
                  assignedToId={recipient.assignedToId}
                  outcome={outcome}
                  canAssign={canAssign}
                  // Nothing to win or lose before a proposal — `markOutcome` refuses it too.
                  canMark={canMark && (lead.state === "quoted" || outcome !== null)}
                  labels={{
                    assign: t("lead.assign"),
                    assignLabel: t("lead.assign_label"),
                    messageBuyer: t("lead.message_buyer"),
                    markWon: t("lead.mark_won"),
                    markLost: t("lead.mark_lost"),
                    reopen: t("lead.reopen"),
                    lostTitle: t("lead.mark_lost"),
                    lostReasonLabel: t("lead.lost_reason_label"),
                    lostReasonPlaceholder: t("lead.lost_reason_placeholder"),
                    lostReasonOptional: t("lead.lost_reason_optional"),
                    lostConfirm: t("lead.lost_confirm"),
                    cancel: t("lead.cancel"),
                    closeLabel: t("lead.close"),
                    noValueNote: t("lead.outcome_no_value"),
                  }}
                />
              ),
            }
          : {})}
        {...(model.state.kind === "compose"
          ? {
              composer: (
                <ProposalComposer
                  // A new revision is a new form: state typed against R1 must
                  // not survive into the composer for R2.
                  key={`${lead.enquiryId}-${nextRevision}`}
                  enquiryId={lead.enquiryId}
                  services={services.map(toOption)}
                  initial={initialInput({ draft, last, services })}
                  restoredAt={draft ? draft.updatedAt.getTime() : null}
                  revision={nextRevision}
                  others={others}
                  lateSince={unanswered && now.getTime() >= due.getTime() ? due.getTime() : null}
                />
              ),
            }
          : {})}
      />
    </>
  );
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const stop = flat.search(/[.?!]\s/);
  return stop > 0 ? flat.slice(0, stop) : flat;
}

/** `Reply due in 2 h`, or overdue. Measured against the same setting the rail bands on. */
function replyChip(due: Date, now: Date): NonNullable<ProposalLeadModel["replyChip"]> {
  const left = due.getTime() - now.getTime();
  if (left <= 0) {
    return { tone: "bad", label: t("proposal.reply_overdue", { duration: formatCountdown(due, { now }) }) };
  }
  return {
    tone: left <= 30 * 60_000 ? "warn" : "neutral",
    label: t("proposal.reply_due", { duration: formatCountdown(due, { now }) }),
  };
}

/**
 * The brief's rows, in the render's order.
 *
 * An enquiry from a service page has no brief: no site, no engagement, no start.
 * It still has a service and a scale, and those rows are what it shows — a
 * *Not provided* under a question the buyer was never asked is a gap nobody left.
 */
function briefRows(lead: LeadDetail): BriefRow[] {
  const rows: BriefRow[] = [];
  const asked = lead.lines.find((line) => line.service !== null)?.service ?? null;
  if (lead.brief) {
    const facts = briefFactWords(lead.brief);
    rows.push({ key: "site", label: t("proposal.brief_site"), value: facts.site || t("table.not_provided"), missing: !facts.site });
    rows.push({ key: "engagement", label: t("proposal.brief_engagement"), value: facts.engagement });
    rows.push({ key: "start", label: t("proposal.brief_start"), value: facts.start });
  } else if (asked) {
    rows.push({ key: "service", label: t("lead.service_asked"), value: asked.name });
  }
  /*
     B7 and the brief's own rule: a scale the buyer left empty renders as
     absent, and says what to do about it. `1n-s` must not multiply by a number
     nobody gave, and neither should the seller.
  */
  /*
     Named for the question the buyer was asked: the brief's *Roughly what
     scale?*, or the service page's *Size of the job* — the label `1d-s`'s lead
     has always shown for it.
  */
  const scaleLabel = lead.brief ? t("proposal.brief_scale") : t("lead.scale");
  rows.push(
    lead.scale
      ? { key: "scale", label: scaleLabel, value: lead.scale }
      : { key: "scale", label: scaleLabel, value: t("proposal.brief_scale_none"), missing: true },
  );
  return rows;
}

function readOnlyState(
  reason: QuoteFenceReason,
  context: { closesAt: Date; declinedAt: Date | null; declineReason: string | null; buyerName: string },
): ProposalLeadModel["state"] {
  switch (reason) {
    case "accepted_yours":
      return { kind: "read_only", tone: "ok", title: t("proposal.readonly.accepted_yours_title"), body: t("proposal.readonly.accepted_yours") };
    case "accepted_elsewhere":
    case "declined":
      // The buyer's choice is not disclosed: not the firm, not the fee.
      return { kind: "read_only", tone: "neutral", title: t("proposal.readonly.elsewhere_title"), body: t("proposal.readonly.elsewhere") };
    case "declined_by_you":
      return {
        kind: "read_only",
        tone: "neutral",
        title: t("proposal.readonly.declined_title"),
        body: context.declineReason
          ? t("proposal.readonly.declined_reason", {
              when: context.declinedAt ? formatDate(context.declinedAt) : "",
              reason: context.declineReason,
            })
          : t("proposal.readonly.declined", { when: context.declinedAt ? formatDate(context.declinedAt) : "" }),
      };
    case "marked":
      return { kind: "read_only", tone: "neutral", title: t("proposal.readonly.marked_title"), body: t("lead.readonly_outcome") };
    case "suspended":
      return { kind: "read_only", tone: "neutral", title: t("proposal.readonly.suspended_title"), body: t("lead.readonly_suspended") };
    case "closed":
      return {
        kind: "read_only",
        tone: "neutral",
        title: t("proposal.readonly.closed_title"),
        body: t("proposal.readonly.closed", { when: formatDate(context.closesAt) }),
      };
  }
}

function toOption(service: ProposalService): ProposalServiceOption {
  return {
    id: service.id,
    name: service.name,
    draft: service.status !== "live",
    basis: service.basis,
    feeBasisLabel: service.feeBasisLabel,
    editHref: `/dashboard/services/${service.id}`,
    turnaround: { label: service.turnaroundLabel ?? t("accepted.proposal.turnaround"), value: service.turnaround },
    seed: {
      scope: service.scope ?? "",
      deliverable: service.deliverable ?? "",
      deliveredWhere: service.deliveredWhere ?? "",
      exclusions: service.excluded ?? "",
    },
  };
}

/**
 * The composer's opening state, from three sources in order: the draft, then
 * the last proposal sent, then the scope sheet (B3).
 *
 * The service is the draft's or the last proposal's where it still exists, else
 * the one the buyer named, else the first on offer. A deleted service drops back
 * to the sheet the seller would pick next rather than a select with nothing
 * chosen.
 */
function initialInput({
  draft,
  last,
  services,
}: {
  draft: Awaited<ReturnType<typeof findProposalDraft>>;
  last: LeadDetail["quotes"][number]["proposal"];
  services: readonly ProposalService[];
}): ProposalInput {
  const held = draft?.proposal ?? null;
  const lastServiceId = held?.serviceId ?? null;
  const service =
    services.find((row) => row.id === lastServiceId) ??
    services.find((row) => row.named) ??
    services[0] ??
    null;
  const amount = (aed: { toString(): string } | null | undefined) => (aed ? typedAmount(aed.toString()) : "");

  if (held) {
    return {
      serviceId: service?.id ?? null,
      fee: amount(held.feeAed),
      mobilisation: amount(held.mobilisationAed),
      termMonths: held.termMonths === null ? "" : String(held.termMonths),
      validityDays: draft?.validityDays ?? PROPOSAL_DEFAULT_VALIDITY_DAYS,
      scope: held.scope,
      deliverable: held.deliverable ?? "",
      deliveredWhere: held.deliveredWhere ?? "",
      exclusions: held.exclusions ?? "",
    };
  }

  if (last) {
    return {
      serviceId: service?.id ?? null,
      fee: amount(last.feeAed),
      mobilisation: amount(last.mobilisationAed),
      termMonths: last.termMonths === null ? "" : String(last.termMonths),
      validityDays: PROPOSAL_DEFAULT_VALIDITY_DAYS,
      scope: last.scope,
      deliverable: last.deliverable ?? "",
      deliveredWhere: last.deliveredWhere ?? "",
      exclusions: last.exclusions ?? "",
    };
  }

  return {
    serviceId: service?.id ?? null,
    fee: "",
    mobilisation: "",
    termMonths: "",
    validityDays: PROPOSAL_DEFAULT_VALIDITY_DAYS,
    scope: service?.scope ?? "",
    deliverable: service?.deliverable ?? "",
    deliveredWhere: service?.deliveredWhere ?? "",
    exclusions: service?.excluded ?? "",
  };
}
