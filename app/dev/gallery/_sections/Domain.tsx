"use client";

import {
  CompletenessMeter,
  EnquiryComposer,
  Thread,
  QuoteLineEditor,
  ListingCard,
  ProductCard,
  ResponseTime,
  SpecTable,
  VerificationBadge,
  VerificationLadder,
  TIERS,
  tierSpec,
  type Availability,
  type ListingCardBusiness,
  type ListingContext,
  type EnquiryComposerLabels,
  type ThreadLabels,
  type ThreadMessageView,
  type QuoteLineDraft,
  type QuoteLineEditorLabels,
} from "@/components/domain";
import { formatAED, formatDate, formatDuration, formatSize } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Frame, Section, Specimen, States } from "../_kit";

const THEMES = ["default", "industrial", "trade", "mono", "clinic", "salon"] as const;

const BUSINESS: ListingCardBusiness = {
  slug: "al-marwan-trading",
  displayName: "Al Marwan Trading",
  categoryName: "Valves & fittings",
  categoryCode: "VF",
  areaName: "Al Quoz Industrial 1",
  emirateName: "Dubai",
  verificationTier: 3,
  visitedAt: "2026-06-02T00:00:00+04:00",
  verifiedAt: "2026-03-14T00:00:00+04:00",
  productCount: 92,
  reviewCount: 4,
  responseTimeMedianMs: 8_040_000,
  responseDurationLabel: formatDuration(8_040_000),
  establishedYear: 2011,
  branchCount: 3,
};

const UNCLAIMED: ListingCardBusiness = {
  slug: "northbay-technical-services",
  displayName: "Northbay Technical Services",
  categoryName: "Electrical & cable",
  categoryCode: "EC",
  areaName: "Jebel Ali Free Zone",
  emirateName: "Dubai",
  verificationTier: 0,
};

const AVAILABILITIES: Availability[] = ["in_stock", "made_to_order", "indent", "out_of_stock"];

export function Domain() {
  return (
    <>
      <Section
        id="verification-badge"
        title="VerificationBadge"
        note="states what was checked and when — and never takes a seller theme colour"
      >
        <States label="tiers" stack>
          {TIERS.map((spec) => (
            <VerificationBadge
              key={spec.tier}
              tier={spec.tier}
              label={t(spec.labelKey as never)}
              checked={t(spec.checkedKey as never)}
              date={spec.dateField === "none" ? undefined : formatDate("2026-06-02T00:00:00+04:00")}
              tierLabel={t("verify.tier", { tier: spec.tier })}
            />
          ))}
        </States>

        <States label="compact">
          {TIERS.map((spec) => (
            <Specimen key={spec.tier} caption={`tier ${spec.tier}`}>
              <VerificationBadge
                compact
                tier={spec.tier}
                label={t(spec.labelKey as never)}
                checked={t(spec.checkedKey as never)}
                tierLabel={t("verify.tier", { tier: spec.tier })}
              />
            </Specimen>
          ))}
        </States>

        <States label="sizes">
          {(["sm", "md", "lg"] as const).map((size) => (
            <Specimen key={size} caption={size}>
              <VerificationBadge
                compact
                size={size}
                tier={3}
                label={t("verify.t3")}
                checked={t("verify.t3.checked")}
              />
            </Specimen>
          ))}
        </States>

        {/*
          Acceptance criterion 8. Six themes, one badge, and the badge must be
          pixel-identical in all six. A test asserts the computed colours match.
        */}
        <States label="theme proof" stack>
          <div id="theme-proof" className="flex flex-wrap gap-3">
            {THEMES.map((theme) => (
              <div
                key={theme}
                data-theme={theme}
                className="rounded-card border border-brand-line bg-card p-3"
              >
                <p className="mb-2 font-mono text-eyebrow uppercase text-brand-text">{theme}</p>
                <p className="mb-2 text-body-sm text-brand">Al Marwan Trading</p>
                <span data-theme-proof="badge">
                  <VerificationBadge
                    compact
                    tier={3}
                    label={t("verify.t3")}
                    checked={t("verify.t3.checked")}
                  />
                </span>
              </div>
            ))}
          </div>
          <p className="max-w-prose text-caption text-muted">{t("gallery.theme_proof")}</p>
        </States>
      </Section>

      <Section
        id="verification-ladder"
        title="VerificationLadder"
        note="shows the rungs above as well as below — that is the mechanism, not decoration"
      >
        <States label="at tier 2" stack>
          <Frame width="34rem">
            <VerificationLadder
              label={`${t("verify.ladder")} — at tier 2`}
              reachedLabel={t("verify.reached")}
              current={2}
              rungs={[1, 2, 3, 4].map((tier) => ({
                tier,
                label: t(tierSpec(tier).labelKey as never),
                requirement: t(`verify.requirement.t${tier}` as never),
                date: tier <= 2 ? formatDate("2026-03-14T00:00:00+04:00") : undefined,
              }))}
            />
          </Frame>
        </States>
        <States label="at tier 4" stack>
          <Frame width="34rem">
            <VerificationLadder
              label={`${t("verify.ladder")} — at tier 4`}
              reachedLabel={t("verify.reached")}
              current={4}
              rungs={[1, 2, 3, 4].map((tier) => ({
                tier,
                label: t(tierSpec(tier).labelKey as never),
                requirement: t(`verify.requirement.t${tier}` as never),
                date: formatDate("2026-06-02T00:00:00+04:00"),
              }))}
            />
          </Frame>
        </States>
      </Section>

      <Section
        id="response-time"
        title="ResponseTime"
        note="measured from enquiry-to-first-reply timestamps — there is no seller field behind it"
      >
        <States label="bands">
          {[
            { ms: 2_400_000, caption: "under 4 h — green" },
            { ms: 32_400_000, caption: "under a day — amber" },
            { ms: 187_200_000, caption: "over a day — red" },
            { ms: null, caption: "unmeasured" },
          ].map(({ ms, caption }) => (
            <Specimen key={caption} caption={caption}>
              <ResponseTime
                medianMs={ms}
                durationLabel={ms ? formatDuration(ms) : undefined}
                label={ms ? t("response.median", { duration: formatDuration(ms) }) : undefined}
                unmeasuredLabel={t("response.unmeasured")}
              />
            </Specimen>
          ))}
        </States>
        <States label="bare, for a table cell">
          {[2_400_000, 32_400_000, 187_200_000].map((ms) => (
            <Specimen key={ms} caption={formatDuration(ms)}>
              <ResponseTime bare medianMs={ms} durationLabel={formatDuration(ms)} unmeasuredLabel="" />
            </Specimen>
          ))}
        </States>
      </Section>

      <Section id="completeness-meter" title="CompletenessMeter" note="derived from the template, so it cannot be gamed">
        <States label="states" stack>
          {[
            [20, 22],
            [15, 22],
            [6, 22],
          ].map(([filled, total]) => (
            <div key={filled} className="w-80">
              <CompletenessMeter
                label={t("display.spec_completeness")}
                filled={filled!}
                total={total!}
                valueLabel={t("display.fields_filled", { filled: filled!, total: total! })}
              />
            </div>
          ))}
        </States>
        <States label="bare">
          <CompletenessMeter
            bare
            label={t("display.spec_completeness")}
            filled={14}
            total={22}
            valueLabel={t("display.fields_filled", { filled: 14, total: 22 })}
          />
        </States>
      </Section>

      <Section
        id="spec-table"
        title="SpecTable"
        note="unfilled template rows stay visible in faint grey — dropping them would let a thin listing look complete"
      >
        <Frame width="38rem">
          <SpecTable
            caption={t("product.spec")}
            notProvidedLabel={t("table.not_provided")}
            filterableLabel={t("product.spec_filterable")}
            rows={[
              { key: "dn", label: "Nominal diameter", value: formatSize({ dn: 100 }), filterable: true, mono: true },
              { key: "pn", label: "Pressure rating", value: "PN16", filterable: true, mono: true },
              { key: "body", label: "Body material", value: "Ductile iron", filterable: true },
              { key: "end", label: "End connection", value: "Flanged" },
              { key: "op", label: "Operation", value: "Handwheel" },
              { key: "cert", label: "Certification", value: "WRAS, EN 1074", filterable: true },
              { key: "temp", label: "Maximum temperature", value: null, unit: "°C" },
              { key: "coating", label: "Coating", value: null },
            ]}
          />
        </Frame>
      </Section>

      <Section
        id="listing-card"
        title="ListingCard"
        note="four contexts, one component — a context prop, never four components"
      >
        {(["search", "grid", "map"] as ListingContext[]).map((context) => (
          <States key={context} label={context} stack>
            <div className={context === "map" ? "w-80" : "w-full max-w-2xl"}>
              <ListingCard business={BUSINESS} context={context} />
            </div>
          </States>
        ))}
        <States label="sponsored" stack>
          <div className="w-full max-w-2xl">
            <ListingCard
              business={{ ...BUSINESS, sponsored: true }}
              context="search"
              sponsoredLabel={t("gallery.sponsored")}
            />
          </div>
        </States>
        <States label="unclaimed" stack>
          <div className="w-full max-w-2xl">
            <ListingCard business={UNCLAIMED} context="unclaimed" />
          </div>
        </States>
        <States label="selected" stack>
          <div className="w-80">
            <ListingCard business={BUSINESS} context="map" selected />
          </div>
        </States>
      </Section>

      <Section
        id="product-card"
        title="ProductCard"
        note="no price on any of them — availability leads, and out of stock becomes Notify me"
      >
        <States label="availability, grid" stack>
          <div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {AVAILABILITIES.map((availability) => (
              <ProductCard
                key={availability}
                product={{
                  slug: `gate-valve-${availability}`,
                  businessSlug: "al-marwan-trading",
                  name: "Resilient seated gate valve DN100",
                  sku: "ALM-1000",
                  availability,
                  stockQty: availability === "in_stock" ? 214 : null,
                  leadTimeDays:
                    availability === "made_to_order" ? 14 : availability === "indent" ? 56 : null,
                  minOrderQty: 10,
                  sizeLabel: formatSize({ dn: 100 }),
                  specFilled: 6,
                  specTotal: 8,
                }}
              />
            ))}
          </div>
        </States>
        <States label="row" stack>
          <div className="flex w-full max-w-2xl flex-col gap-2">
            {AVAILABILITIES.slice(0, 2).map((availability) => (
              <ProductCard
                key={availability}
                layout="row"
                product={{
                  slug: `butterfly-${availability}`,
                  businessSlug: "al-marwan-trading",
                  name: "Wafer butterfly valve DN200, gear operated",
                  sku: "ALM-1021",
                  availability,
                  leadTimeDays: availability === "made_to_order" ? 21 : null,
                  sizeLabel: formatSize({ dn: 200 }),
                  specFilled: 8,
                  specTotal: 8,
                }}
              />
            ))}
          </div>
        </States>
      </Section>

      <EnquiryComposerSpecimens />

      <ThreadSpecimens />

      <Section
        id="quote-line-editor"
        title="QuoteLineEditor"
        note="tier 4 · seller side · an unmatched line is flagged, never silently blank"
      >
        <States label="two matched lines and one the catalogue cannot place" stack>
          <Frame>
            <QuoteLineEditor
              lines={QUOTE_LINES}
              labels={{ ...QUOTE_LABELS, formLabel: "Quote lines — three lines" }}
              formatTotal={(aed) => formatAED(aed, { style: "quote" })}
            />
          </Frame>
        </States>

        <States label="a single line, nothing matched at all" stack>
          <Frame>
            <QuoteLineEditor
              lines={[QUOTE_LINES[2]!]}
              labels={{ ...QUOTE_LABELS, formLabel: "Quote lines — nothing matched" }}
              formatTotal={(aed) => formatAED(aed, { style: "quote" })}
            />
          </Frame>
        </States>

        <States label="a revision, pre-filled from the last quote sent" stack>
          <Frame>
            <QuoteLineEditor
              lines={QUOTE_LINES.map((line, i) => ({
                ...line,
                initialUnitPrice: ["62.00", "655.00", "19750.00"][i]!,
                initialLeadTimeDays: [0, 2, 84][i]!,
                ...(line.suggested ? { initialProductId: line.suggested.productId } : {}),
              }))}
              labels={{ ...QUOTE_LABELS, formLabel: "Quote lines — a revision" }}
              initialNote="Revised after your call. Both stock sizes held at the same price."
              initialValidityDays={10}
              formatTotal={(aed) => formatAED(aed, { style: "quote" })}
            />
          </Frame>
        </States>

        <States label="submitting, and a failure the server sent back" stack>
          <Frame>
            <QuoteLineEditor
              lines={[QUOTE_LINES[0]!]}
              labels={{ ...QUOTE_LABELS, formLabel: "Quote lines — sending" }}
              busy
              formatTotal={(aed) => formatAED(aed, { style: "quote" })}
            />
          </Frame>
          <Frame>
            <QuoteLineEditor
              lines={[QUOTE_LINES[0]!]}
              labels={{ ...QUOTE_LABELS, formLabel: "Quote lines — refused by the server" }}
              error={t("quote.error.closed", { when: "20 Aug 2026" })}
              formatTotal={(aed) => formatAED(aed, { style: "quote" })}
            />
          </Frame>
        </States>
      </Section>
    </>
  );
}

/**
 * The step 1 checkpoint state, as data: two lines the seller stocks — one of
 * them catalogued in inches against a metric enquiry line — and one nothing on
 * the shelf can answer.
 */
const QUOTE_LINES: QuoteLineDraft[] = [
  {
    key: "l1",
    description: "Brass ball valve",
    qty: 40,
    unit: "pcs",
    size: "DN25",
    targetUnitPriceAed: "65.00",
    suggested: {
      productId: "p1",
      name: "Brass ball valve DN25",
      sku: "ALM-1028",
      availabilityLabel: t("availability.indent"),
      stockLabel: null,
      leadTimeDays: 56,
      reasons: ["size", "wording"],
    },
    alternatives: [],
  },
  {
    key: "l2",
    description: "Cast iron gate valve",
    qty: 12,
    unit: "pcs",
    size: "DN150",
    targetUnitPriceAed: "670.00",
    suggested: {
      // The buyer wrote DN150. The seller catalogued it as 6". Same valve.
      productId: "p2",
      name: 'Cast iron gate valve 6"',
      sku: "ALM-90",
      availabilityLabel: t("availability.in_stock"),
      stockLabel: t("product.in_stock_qty", { qty: "64" }),
      leadTimeDays: null,
      reasons: ["size", "wording"],
    },
    alternatives: [
      {
        productId: "p3",
        name: "Resilient seated gate valve DN150",
        sku: "ALM-1000",
        availabilityLabel: t("availability.in_stock"),
        stockLabel: t("product.in_stock_qty", { qty: "212" }),
        leadTimeDays: null,
        reasons: ["size", "wording"],
      },
    ],
  },
  {
    key: "l3",
    description: "API 6D trunnion mounted ball valve, full bore, fire safe, flanged RF",
    qty: 4,
    unit: "pcs",
    size: "DN600",
    targetUnitPriceAed: "18500.00",
    suggested: null,
    alternatives: [],
  },
];

const QUOTE_LABELS: QuoteLineEditorLabels = {
  formLabel: t("quote.editor.form"),
  caption: t("quote.editor.caption"),
  colLine: t("quote.col.line"),
  colProduct: t("quote.col.product"),
  colQty: t("quote.col.qty"),
  colUnitPrice: t("quote.col.unit_price"),
  colLeadTime: t("quote.col.lead_time"),
  colTotal: t("quote.col.total"),
  manualFlag: t("quote.manual_flag"),
  manualHelp: t("quote.manual_help"),
  matchedBy: (reasons) => {
    if (reasons.includes("sku")) return t("quote.matched_by.sku");
    const size = reasons.includes("size");
    const wording = reasons.includes("wording");
    if (size && wording) return t("quote.matched_by.size_and_wording");
    if (size) return t("quote.matched_by.size");
    return t("quote.matched_by.wording");
  },
  priceByHand: t("quote.price_by_hand"),
  chooseProduct: t("quote.choose_product"),
  targetPrice: (amountAed) => t("quote.target_price", { amount: formatAED(amountAed) }),
  leadTimeSuffix: t("quote.lead_time_suffix"),
  unitPriceLabel: (line) => t("quote.unit_price_for", { line }),
  leadTimeLabel: (line) => t("quote.lead_time_for", { line }),
  productLabel: (line) => t("quote.product_for", { line }),
  includeLabel: (line) => t("quote.product_for", { line }),
  excluded: t("quote.excluded"),
  excludeAction: t("quote.exclude"),
  includeAction: t("quote.include"),
  totalLabel: t("quote.total"),
  currencyNote: t("quote.currency_note"),
  noteLabel: t("quote.note_label"),
  notePlaceholder: t("quote.note_placeholder"),
  validityLabel: t("quote.validity_label"),
  validityHelp: t("quote.validity_help"),
  validityDayOptions: [7, 10, 14, 21, 30, 45, 60].map((days) => ({
    value: String(days),
    label: t("quote.validity_days", { count: days }),
  })),
  submit: t("quote.send"),
  submitting: t("quote.sending"),
  unpricedError: (lines) => t("quote.error.unpriced", { count: lines.length, lines: lines.join("; ") }),
  badPriceError: (line) => t("quote.error.bad_price", { line }),
  nothingIncludedError: t("quote.error.nothing_included"),
};

/**
 * The composer's two shapes. Both are the same form; the difference is how much
 * of it is on screen at once.
 */
const ENQUIRY_LABELS: EnquiryComposerLabels = {
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
  emirateOptions: [
    { value: "dubai", label: "Dubai" },
    { value: "sharjah", label: "Sharjah" },
  ],
  neededBy: t("rfq.needed_by"),
  neededByHint: t("rfq.needed_by_hint"),
  terms: t("rfq.terms"),
  termsHint: t("rfq.terms_hint"),
  termsOptions: [
    { value: "", label: t("rfq.terms_any") },
    { value: "net_30", label: t("terms.net_30") },
  ],
  closes: t("rfq.closes"),
  closesHint: t("rfq.closes_hint"),
  closesOptions: [{ value: "7", label: t("rfq.closes_days", { count: 7 }) }],
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

const ENQUIRY_RECIPIENTS = [
  {
    businessId: "b1",
    displayName: "Al Marwan Industrial Supplies LLC",
    areaName: "Al Quoz Industrial 1",
    verificationTier: 3,
    responseLabel: t("response.median", { duration: formatDuration(7_200_000) }),
    pinned: true,
  },
  {
    businessId: "b2",
    displayName: "Desert Anchor General Trading LLC",
    areaName: "Industrial Area 4",
    verificationTier: 2,
    responseLabel: t("response.unmeasured"),
  },
];

export function EnquiryComposerSpecimens() {
  return (
    <Section
      id="enquiry-composer"
      title="EnquiryComposer"
      note="tier 4 · buyer side · one form, two shapes"
    >
      <States label="single seller — the composer on a storefront" stack>
        <Frame>
          <EnquiryComposer
            shape="single"
            labels={{ ...ENQUIRY_LABELS, formLabel: "Enquiry — single seller" }}
            recipients={[ENQUIRY_RECIPIENTS[0]!]}
          />
        </Frame>
      </States>

      <States label="the fan-out wizard, on its first step" stack>
        <Frame>
          <EnquiryComposer
            shape="wizard"
            labels={{ ...ENQUIRY_LABELS, formLabel: "Enquiry — fan-out wizard" }}
            recipients={ENQUIRY_RECIPIENTS}
          />
        </Frame>
      </States>

      <States label="lines carried in from a product tray" stack>
        <Frame>
          <EnquiryComposer
            shape="single"
            labels={{ ...ENQUIRY_LABELS, formLabel: "Enquiry — lines from a tray" }}
            initialRequirement="Three items off your catalogue, for a plant room at Mussafah."
            initialLines={[
              { key: "a", description: "Resilient seated gate valve DN100", qty: 24, unit: "pcs", size: "DN100", targetUnitPriceAed: "" },
              { key: "b", description: "Wafer butterfly valve DN200", qty: 6, unit: "pcs", size: "DN200", targetUnitPriceAed: "" },
            ]}
            recipients={[ENQUIRY_RECIPIENTS[0]!]}
          />
        </Frame>
      </States>

      <States label="sending, and a failure the server sent back" stack>
        <Frame>
          <EnquiryComposer
            shape="single"
            labels={{ ...ENQUIRY_LABELS, formLabel: "Enquiry — sending" }}
            busy
          />
        </Frame>
        <Frame>
          <EnquiryComposer
            shape="single"
            labels={{ ...ENQUIRY_LABELS, formLabel: "Enquiry — refused by the server" }}
            error={t("rfq.recipients_none")}
          />
        </Frame>
      </States>
    </Section>
  );
}

/** Board 10h and 11b are two views of this. The chips and the notice differ. */
const THREAD_LABELS: ThreadLabels = {
  heading: t("thread.heading"),
  formLabel: t("thread.composer_form"),
  logLabel: t("thread.log", { supplier: "Al Marwan Industrial Supplies" }),
  empty: t("thread.empty"),
  composerLabel: t("thread.composer"),
  placeholder: t("thread.placeholder"),
  send: t("thread.send"),
  sending: t("thread.sending"),
  quickRepliesLabel: t("thread.quick_replies"),
  flagged: t("thread.flagged"),
  flaggedExplain: t("thread.flagged_explain"),
  revisionOf: (revision) => t("thread.revision_of", { revision }),
  wasLabel: t("thread.was"),
};

const THREAD_MESSAGES: ThreadMessageView[] = [
  {
    id: "m1",
    body: "Can you bring the DN150 lead time inside two weeks?",
    fromMe: false,
    senderLabel: "Rashid",
    at: "23 Aug 2026, 14:12",
    flagged: false,
  },
  {
    id: "m2",
    body: "We can do seven days if you confirm this week. Revised quote attached.",
    fromMe: true,
    senderLabel: "Al Marwan Industrial Supplies",
    at: "23 Aug 2026, 16:40",
    flagged: false,
    quote: {
      ref: "QT-8841-R2",
      revision: 2,
      totalLabel: "AED 21,128",
      previousTotalLabel: "AED 21,600",
      deltaLabel: t("thread.delta_down", { amount: "AED 472", percent: "2.2" }),
      direction: "down",
    },
  },
];

export function ThreadSpecimens() {
  return (
    <Section id="thread" title="Thread" note="boards 10h and 11b · one component, two sides">
      <States label="a revision, with the previous total struck through" stack>
        <Frame width="34rem">
          <Thread
            messages={THREAD_MESSAGES}
            labels={{ ...THREAD_LABELS, logLabel: "Messages — revision", formLabel: "Reply — revision" }}
            quickReplies={[t("thread.chip.validity"), t("thread.chip.datasheets")]}
          />
        </Frame>
      </States>

      <States label="a flagged message, with the seller's warning above it" stack>
        <Frame width="34rem">
          <Thread
            labels={{ ...THREAD_LABELS, logLabel: "Messages — flagged", formLabel: "Reply — flagged" }}
            quickReplies={[t("thread.chip.hold_price"), t("thread.chip.site_survey")]}
            notice={
              <div className="rounded-ctl border border-line bg-paper-sunk px-3 py-2.5">
                <p className="text-body-sm text-ink">{t("thread.seller_warning_title")}</p>
                <p className="mt-1 text-caption text-muted">{t("thread.seller_warning_body")}</p>
              </div>
            }
            messages={[
              {
                id: "m3",
                body: "To lock the stock please transfer the 50% advance to AE070331234567890123456 today.",
                fromMe: true,
                senderLabel: "Al Marwan Industrial Supplies",
                at: "24 Aug 2026, 09:02",
                flagged: true,
              },
            ]}
          />
        </Frame>
      </States>

      <States label="nothing said yet, and a closed thread" stack>
        <Frame width="34rem">
          <Thread messages={[]} labels={{ ...THREAD_LABELS, logLabel: "Messages — empty", formLabel: "Reply — empty" }} />
        </Frame>
        <Frame width="34rem">
          <Thread
            readOnly
            messages={[THREAD_MESSAGES[0]!]}
            labels={{ ...THREAD_LABELS, logLabel: "Messages — closed" }}
          />
        </Frame>
      </States>
    </Section>
  );
}
