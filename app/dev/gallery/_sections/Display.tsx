"use client";

import { useState } from "react";
import {
  CategoryMark,
  FilterChip,
  FunnelBars,
  ImagePlaceholder,
  LogoTile,
  MapCanvas,
  PlanBadge,
  ProgressBar,
  ShareBars,
  StackedBar,
  StatCard,
  StatusBadge,
  StepProgress,
  Tag,
  Waterfall,
  type StatusTone,
} from "@/components/display";
import { formatAED, formatCount, formatDuration, formatPercent } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Frame, Section, Specimen, States } from "../_kit";

const TONES: StatusTone[] = ["ok", "warn", "bad", "info", "neutral"];

export function Display() {
  const [filters, setFilters] = useState(["dubai", "dn100", "tier3"]);

  return (
    <>
      <Section id="status-badge" title="StatusBadge" note="a word and a tone — never a bare colour">
        <States label="tones">
          {TONES.map((tone) => (
            <Specimen key={tone} caption={tone}>
              <StatusBadge tone={tone}>{tone}</StatusBadge>
            </Specimen>
          ))}
        </States>
        <States label="with a dot">
          <Specimen caption="in stock">
            <StatusBadge tone="ok" dot>
              {t("availability.in_stock")}
            </StatusBadge>
          </Specimen>
          <Specimen caption="expiring">
            <StatusBadge tone="warn" dot>
              {t("display.expiring")}
            </StatusBadge>
          </Specimen>
          <Specimen caption="suspended">
            <StatusBadge tone="bad" dot>
              {t("display.suspended")}
            </StatusBadge>
          </Specimen>
          <Specimen caption="out of stock">
            <StatusBadge tone="neutral" dot>
              {t("availability.out_of_stock")}
            </StatusBadge>
          </Specimen>
        </States>
        <States label="sizes and shapes">
          <Specimen caption="sm pill">
            <StatusBadge tone="ok" size="sm">
              {t("display.verified")}
            </StatusBadge>
          </Specimen>
          <Specimen caption="md chip">
            <StatusBadge tone="info" shape="chip">
              {t("display.in_review")}
            </StatusBadge>
          </Specimen>
        </States>
      </Section>

      <Section id="plan-badge" title="PlanBadge" note="quiet on a public surface, on purpose">
        <States label="tiers">
          <Specimen caption="free">
            <PlanBadge plan="free" label="Free" />
          </Specimen>
          <Specimen caption="basic">
            <PlanBadge plan="basic" label="Basic" />
          </Specimen>
          <Specimen caption="pro">
            <PlanBadge plan="pro" label="Pro" />
          </Specimen>
        </States>
      </Section>

      <Section id="tag" title="Tag" note="a Tag describes; a FilterChip filters">
        <States label="states">
          <Specimen caption="plain">
            <Tag>{t("display.material_ductile_iron")}</Tag>
          </Specimen>
          <Specimen caption="mono">
            <Tag mono>PN16</Tag>
          </Specimen>
          <Specimen caption="link">
            <Tag href="#tag">Al Quoz Industrial 1</Tag>
          </Specimen>
          <Specimen caption="small">
            <Tag size="sm" mono>
              WRAS
            </Tag>
          </Specimen>
        </States>
      </Section>

      <Section
        id="filter-chip"
        title="FilterChip"
        note="every applied facet gets one — a filter you cannot see is a filter you will not remove"
      >
        <States label="applied" stack>
          <div className="flex flex-wrap gap-1.5">
            <FilterChip fixed facet="Category">
              Valves &amp; fittings
            </FilterChip>
            {filters.includes("dubai") && (
              <FilterChip
                facet="Emirate"
                removeLabel={t("display.remove_filter", { facet: "Emirate" })}
                onRemove={() => setFilters((f) => f.filter((x) => x !== "dubai"))}
              >
                Dubai
              </FilterChip>
            )}
            {filters.includes("dn100") && (
              <FilterChip
                facet="Nominal diameter"
                removeLabel={t("display.remove_filter", { facet: "Nominal diameter" })}
                onRemove={() => setFilters((f) => f.filter((x) => x !== "dn100"))}
              >
                DN100
              </FilterChip>
            )}
            {filters.includes("tier3") && (
              <FilterChip
                facet="Verification"
                removeLabel={t("display.remove_filter", { facet: "Verification" })}
                onRemove={() => setFilters((f) => f.filter((x) => x !== "tier3"))}
              >
                Tier 3 and up
              </FilterChip>
            )}
          </div>
        </States>
      </Section>

      <Section id="category-mark" title="CategoryMark" note="two letters from the taxonomy, never generated initials">
        <States label="sizes">
          {(["sm", "md", "lg"] as const).map((size) => (
            <Specimen key={size} caption={size}>
              <CategoryMark code="VF" size={size} />
            </Specimen>
          ))}
          <Specimen caption="on ink">
            <span className="inline-flex rounded-chip bg-ink p-2">
              <CategoryMark code="PT" onInk />
            </span>
          </Specimen>
        </States>
      </Section>

      <Section id="logo-tile" title="LogoTile" note="most of the directory has no logo — the fallback is the common case">
        <States label="states">
          <Specimen caption="no logo, category mark">
            <LogoTile name="Al Marwan Trading" categoryCode="VF" />
          </Specimen>
          <Specimen caption="no logo, no category">
            <LogoTile name="Al Marwan Trading" />
          </Specimen>
          <Specimen caption="large">
            <LogoTile name="Al Marwan Trading" categoryCode="HV" size="lg" />
          </Specimen>
        </States>
      </Section>

      <Section
        id="image-placeholder"
        title="ImagePlaceholder"
        note="loading and empty are different absences and must not look alike"
      >
        <States label="kinds">
          <Specimen caption="loading — stripes, no border">
            <div className="w-44">
              <ImagePlaceholder kind="loading" />
            </div>
          </Specimen>
          <Specimen caption="empty — dashed, add something here">
            <div className="w-44">
              <ImagePlaceholder kind="empty" label={t("display.no_image")} />
            </div>
          </Specimen>
          <Specimen caption="square">
            <div className="w-28">
              <ImagePlaceholder kind="empty" ratio="1 / 1" />
            </div>
          </Specimen>
        </States>
      </Section>

      <Section id="stat-card" title="StatCard" note="the number gets the serif face — the one big number §01 allows">
        <States label="states" stack>
          <div className="grid w-full gap-3 sm:grid-cols-3">
            <StatCard
              label="enquiries"
              value={formatCount(41)}
              caption="last 30 days"
              delta={{ value: "+18%", direction: "up", label: "vs last month", sentiment: "good" }}
            />
            <StatCard
              label="median reply"
              value={formatDuration(8_040_000)}
              caption="enquiry to first reply"
              delta={{ value: "+42 min", direction: "up", label: "vs last month", sentiment: "bad" }}
            />
            <StatCard
              label="quoted value"
              value={formatAED(184_200)}
              note={t("display.self_reported")}
            />
          </div>
          <div className="w-64">
            <StatCard hero label="suppliers" value={formatCount(41_204)} caption="listed" />
          </div>
        </States>
      </Section>

      <Section id="progress-bar" title="ProgressBar" note="the value is always text as well as a bar">
        <States label="states" stack>
          <div className="w-80">
            <ProgressBar
              label={t("display.profile_strength")}
              value={72}
              valueLabel={formatPercent(0.72)}
            />
          </div>
          <div className="w-80">
            <ProgressBar
              label={t("display.spec_completeness")}
              value={14}
              max={22}
              tone="warn"
              valueLabel={t("display.fields_filled", { filled: 14, total: 22 })}
            />
          </div>
          <div className="w-80">
            <ProgressBar label={t("display.profile_strength")} value={19} tone="bad" valueLabel="19%" />
          </div>
          <div className="w-80">
            <ProgressBar label={t("display.profile_strength")} value={100} tone="ok" valueLabel="100%" />
          </div>
        </States>
      </Section>

      <Section id="step-progress" title="StepProgress" note="for where StepHeader will not fit">
        <States label="states" stack>
          <StepProgress
            completed={3}
            total={5}
            label={t("display.setup")}
            valueLabel={t("display.setup_progress", { done: 3, total: 5 })}
          />
          <StepProgress
            completed={5}
            total={5}
            label={t("display.setup")}
            valueLabel={t("display.setup_progress", { done: 5, total: 5 })}
          />
          <StepProgress
            completed={0}
            total={4}
            size="sm"
            label={t("display.setup")}
            valueLabel={t("display.setup_progress", { done: 0, total: 4 })}
          />
        </States>
      </Section>

      <Section id="stacked-bar" title="StackedBar" note="the legend carries the value, so colour is never the only channel">
        <Frame width="34rem">
          <StackedBar
            label="Verification mix"
            segments={[
              { key: "t4", label: "Tier 4", value: 1, valueLabel: formatCount(1) },
              { key: "t3", label: "Tier 3", value: 3, valueLabel: formatCount(3) },
              { key: "t2", label: "Tier 2", value: 6, valueLabel: formatCount(6) },
              { key: "t1", label: "Tier 1", value: 4, valueLabel: formatCount(4) },
              { key: "t0", label: "Unverified", value: 26, valueLabel: formatCount(26) },
            ]}
          />
        </Frame>
      </Section>

      <Section id="share-bars" title="ShareBars" note="horizontal, because the labels are words">
        <Frame width="34rem">
          <ShareBars
            label="Listings by emirate"
            rows={[
              { key: "dubai", label: "Dubai", value: 10, valueLabel: formatCount(10), href: "#share-bars" },
              { key: "sharjah", label: "Sharjah", value: 10, valueLabel: formatCount(10) },
              { key: "abu_dhabi", label: "Abu Dhabi", value: 10, valueLabel: formatCount(10) },
              { key: "ajman", label: "Ajman", value: 10, valueLabel: formatCount(10) },
            ]}
          />
        </Frame>
      </Section>

      <Section id="funnel-bars" title="FunnelBars" note="the drop between stages is printed, not inferred from two widths">
        <Frame width="34rem">
          <FunnelBars
            label="Storefront funnel"
            conversionLabel={(pct) => t("display.conversion", { pct })}
            stages={[
              { key: "impressions", label: "Search impressions", value: 4_120, valueLabel: formatCount(4_120) },
              { key: "views", label: "Storefront views", value: 862, valueLabel: formatCount(862) },
              { key: "reveals", label: "Number revealed", value: 214, valueLabel: formatCount(214) },
              { key: "enquiries", label: "Enquiries", value: 41, valueLabel: formatCount(41) },
              { key: "accepted", label: "Accepted quotes", value: 9, valueLabel: formatCount(9) },
            ]}
          />
        </Frame>
      </Section>

      <Section id="waterfall" title="Waterfall" note="the sign is in the label, not only in the tone">
        <Frame width="38rem">
          <Waterfall
            label="Subscription revenue, month on month"
            steps={[
              { key: "open", label: "Opening", value: 28_400, valueLabel: formatAED(28_400), total: true },
              { key: "new", label: "New", value: 4_190, valueLabel: `+${formatAED(4_190)}` },
              { key: "up", label: "Upgrades", value: 1_650, valueLabel: `+${formatAED(1_650)}` },
              { key: "down", label: "Downgrades", value: -900, valueLabel: `-${formatAED(900)}` },
              { key: "churn", label: "Churn", value: -1_740, valueLabel: `-${formatAED(1_740)}` },
              { key: "close", label: "Closing", value: 31_600, valueLabel: formatAED(31_600), total: true },
            ]}
          />
        </Frame>
      </Section>

      <Section
        id="map-canvas"
        title="MapCanvas"
        note="moss = head office or selected · ink = verified · outlined = unverified · a location with no coordinates never appears"
      >
        <States label="pinned" stack>
          <div className="w-full max-w-2xl">
            <MapCanvas
              label={t("display.map_label")}
              height={320}
              excluded={2}
              excludedLabel={(count) => t("display.map_excluded", { count })}
              emptyLabel={t("display.map_empty")}
              pins={[
                { id: "1", lat: 25.1412, lng: 55.2311, label: "Al Marwan Trading — head office, Al Quoz Industrial 1", kind: "head_office" },
                { id: "2", lat: 25.1783, lng: 55.3486, label: "Gulf Line Industrial — warehouse, Ras Al Khor", kind: "verified" },
                { id: "3", lat: 25.2697, lng: 55.3095, label: "Al Sahra General Trading — trade counter, Deira", kind: "unverified" },
                { id: "4", lat: 25.3197, lng: 55.4083, label: "Al Wadi Building Materials — depot, Sharjah Industrial 4", kind: "verified" },
              ]}
            />
          </div>
        </States>
        <States label="nothing to plot" stack>
          <div className="w-full max-w-2xl">
            <MapCanvas
              label={t("display.map_label")}
              height={140}
              pins={[]}
              excluded={3}
              excludedLabel={(count) => t("display.map_excluded", { count })}
              emptyLabel={t("display.map_empty")}
            />
          </div>
        </States>
      </Section>
    </>
  );
}
