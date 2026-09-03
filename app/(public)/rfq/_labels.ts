import type { EnquiryComposerLabels } from "@/components/domain";
import type { RfqComposerLabels } from "./RfqComposer";
import { t } from "@/lib/i18n";

/**
 * The composer's strings, in one place.
 *
 * Three routes render the same form — the storefront, the product tray and the
 * fan-out wizard — and several of these labels take an argument, which cannot
 * cross from a server component to a client one. So the client side builds
 * them, from here.
 */
export function enquiryLabels(options: {
  emirates: readonly { value: string; label: string }[];
}): EnquiryComposerLabels {
  return {
    formLabel: t("rfq.sequence"),
    steps: [t("rfq.step.need"), t("rfq.step.where"), t("rfq.step.who")],
    // StepHeader already hands this a 1-based number.
    stepOf: (current, total) => t("rfq.step_of", { current, total }),

    requirement: t("rfq.requirement"),
    requirementHint: t("rfq.requirement_hint"),
    requirementPlaceholder: t("rfq.requirement_placeholder"),

    lines: t("rfq.lines"),
    linesHint: t("rfq.lines_hint"),
    lineDescription: (n) => t("rfq.line_description_for", { number: n }),
    lineQty: (n) => t("rfq.line_qty_for", { number: n }),
    lineUnit: (n) => t("rfq.line_unit_for", { number: n }),
    lineSize: (n) => t("rfq.line_size_for", { number: n }),
    lineTarget: (n) => t("rfq.line_target_for", { number: n }),
    lineTargetHint: t("rfq.line_target_hint"),
    colDescription: t("rfq.line_description"),
    colQty: t("rfq.line_qty"),
    colUnit: t("rfq.line_unit"),
    colSize: t("rfq.line_size"),
    colTarget: t("rfq.line_target"),
    addLine: t("rfq.add_line"),
    removeLine: (n) => t("rfq.remove_line", { number: n }),

    area: t("rfq.area"),
    areaHint: t("rfq.area_hint"),
    emirate: t("rfq.emirate"),
    emirateOptions: options.emirates,
    neededBy: t("rfq.needed_by"),
    neededByHint: t("rfq.needed_by_hint"),
    terms: t("rfq.terms"),
    termsHint: t("rfq.terms_hint"),
    termsOptions: [
      { value: "", label: t("rfq.terms_any") },
      { value: "advance", label: t("terms.advance") },
      { value: "cod", label: t("terms.cod") },
      { value: "net_15", label: t("terms.net_15") },
      { value: "net_30", label: t("terms.net_30") },
      { value: "net_60", label: t("terms.net_60") },
      { value: "lc", label: t("terms.lc") },
    ],
    closes: t("rfq.closes"),
    closesHint: t("rfq.closes_hint"),
    closesOptions: [3, 5, 7, 14, 21].map((days) => ({
      value: String(days),
      label: t("rfq.closes_days", { count: days }),
    })),

    recipients: t("rfq.recipients"),
    recipientsHint: t("rfq.recipients_hint"),
    fanout: (count) => t("rfq.fanout", { count }),
    fanoutLabel: t("rfq.fanout_label"),
    fanoutNote: t("rfq.fanout_note"),
    pinned: t("rfq.pinned"),
    recipientsPreview: (count) => t("rfq.recipients_preview", { count }),
    recipientsNone: t("rfq.recipients_none"),
    privacy: t("rfq.privacy"),

    contact: t("rfq.contact"),
    contactHint: t("rfq.contact_hint"),
    contactName: t("rfq.contact_name"),
    contactNameHint: t("rfq.contact_name_hint"),

    back: t("rfq.back"),
    next: t("rfq.next"),
    submit: t("rfq.submit"),
    sending: t("rfq.sending"),

    errorRequirement: t("rfq.requirement_required"),
    errorLines: t("rfq.lines_required"),
    errorContact: t("rfq.contact_required"),
  };
}

/**
 * Board 1h's own strings, for `/rfq/new`.
 *
 * Separate from `enquiryLabels` because Composer B asks nothing Composer A
 * does not — it asks *more*: the items table, the recipient picker, the cap,
 * the fallbacks. Several take an argument, and a function cannot cross from a
 * server component to a client one, so the client builds them from here.
 */
export function rfqLabels(options: { emirateName: string }): RfqComposerLabels {
  return {
    h1: t("rfq.h1"),
    singleH1: t("rfq.single_h1"),
    sub: t("rfq.sub"),
    stepItems: t("rfq.step.items"),
    stepRequirement: t("rfq.step.requirement"),
    stepSend: t("rfq.step.send"),
    stepCompact: (current, total) => t("rfq.step_compact", { current, total }),
    sequence: t("rfq.sequence"),

    itemsTitle: t("rfq.items_title"),
    itemsCaption: t("rfq.items_caption"),
    addAnother: t("rfq.add_another"),
    colProduct: t("rfq.col_product"),
    colQty: t("rfq.col_qty"),
    colTarget: t("rfq.col_target"),
    colRemove: t("rfq.col_remove"),
    targetHint: t("rfq.target_hint"),
    unmatched: t("rfq.unmatched"),
    linePlaceholder: t("rfq.line_placeholder"),
    lineDescription: (n) => t("rfq.line_description_for", { number: n }),
    lineQty: (n) => t("rfq.line_qty_for", { number: n }),
    lineTarget: (n) => t("rfq.line_target_for", { number: n }),
    removeLine: (n) => t("rfq.remove_line", { number: n }),

    requirementTitle: t("rfq.requirement_title"),
    seededNotice: t("rfq.seeded_notice"),

    recipientsTitle: (count) => t("rfq.recipients_title", { count }),
    recipientsMatchedOn: t("rfq.recipients_matched_on"),
    recipientsEmpty: t("rfq.recipients_empty"),
    recipientsMore: (count) => t("rfq.recipients_more", { count }),
    recipientsAddAll: t("rfq.recipients_add_all"),
    recipientPick: (name) => t("rfq.recipient_pick", { name }),
    fromPage: t("rfq.from_page"),
    capNote: t("rfq.cap_note"),
    onlyOneMatch: t("rfq.only_one_match", { count: 1, emirate: options.emirateName }),
    zeroMatches: t("rfq.zero_matches"),
    routeForMe: t("rfq.route_for_me"),
    routed: t("rfq.routed"),

    howTitle: t("rfq.how_title"),
    how: [t("rfq.how_1"), t("rfq.how_2"), t("rfq.how_3")],
    send: (count) => t("rfq.send", { count }),
    sendIdle: t("rfq.send_idle"),
    sendNote: t("rfq.send_note"),
    blockedNoLines: t("rfq.blocked_no_lines"),
    blockedNoArea: t("rfq.blocked_no_area"),
    blockedNoRecipients: t("rfq.none_picked"),
    sending: t("rfq.sending"),
  };
}
