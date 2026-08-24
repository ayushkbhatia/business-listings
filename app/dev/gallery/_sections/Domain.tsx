"use client";

import {
  CompletenessMeter,
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
} from "@/components/domain";
import { formatDate, formatDuration, formatSize } from "@/lib/format";
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
    </>
  );
}
