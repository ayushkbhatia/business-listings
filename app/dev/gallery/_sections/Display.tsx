"use client";

import { useState } from "react";
import { Button } from "@/components/primitives";
import {
  Alert,
  CategoryMark,
  ChipLink,
  Eyebrow,
  FilterChip,
  RatingMarks,
  FunnelBars,
  ImagePlaceholder,
  LogoTile,
  MapCanvas,
  ResultsMap,
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
import { formatAED, formatCount, formatDecimal, formatDuration, formatPercent, formatRating } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Frame, Section, Specimen, States } from "../_kit";

const TONES: StatusTone[] = ["ok", "warn", "bad", "info", "neutral"];

/*
   Enough pins that the clusterer has something to do, spread across three
   emirates. Board 1c caps the real query at 200 and clusters past that; a
   gallery that only ever showed four would never render the fourth pin state.
*/
const GALLERY_PINS = [
  { id: "b1", locationId: "l1", lat: 25.1412, lng: 55.2311, label: "Al Marwan Trading — Al Quoz Industrial 1", kind: "head_office" as const },
  { id: "b2", locationId: "l2", lat: 25.1783, lng: 55.3486, label: "Gulf Line Industrial — Ras Al Khor", kind: "verified" as const },
  { id: "b3", locationId: "l3", lat: 25.2697, lng: 55.3095, label: "Al Sahra General Trading — Deira", kind: "unverified" as const },
  { id: "b4", locationId: "l4", lat: 25.3197, lng: 55.4083, label: "Al Wadi Building Materials — Sharjah Industrial 4", kind: "verified" as const },
  { id: "b5", locationId: "l5", lat: 25.1355, lng: 55.2280, label: "Technopump Trading — Al Quoz Industrial 3", kind: "verified" as const },
  { id: "b6", locationId: "l6", lat: 25.1390, lng: 55.2265, label: "Emirates Valve Centre — Al Quoz Industrial 3", kind: "unverified" as const },
  { id: "b7", locationId: "l7", lat: 25.1401, lng: 55.2299, label: "Desert Cooling Systems — Al Quoz Industrial 2", kind: "head_office" as const },
  { id: "b8", locationId: "l8", lat: 24.9857, lng: 55.0654, label: "Jebel Ali Pipe & Fittings — JAFZA South", kind: "verified" as const },
  { id: "b9", locationId: "l9", lat: 24.9902, lng: 55.0701, label: "Gulf Cool Technical — JAFZA South", kind: "unverified" as const },
];

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

      <Section
        id="chip-link"
        title="ChipLink"
        note="a pill that navigates — FilterChip is the one you remove"
      >
        <States label="sm — the popular-search row under the home hero">
          <div className="flex flex-wrap gap-2">
            {["HVAC maintenance AMC", "Steel fabrication", "Pallet racking"].map((query) => (
              <ChipLink key={query} size="sm" href={`/search?q=${encodeURIComponent(query)}`}>
                {query}
              </ChipLink>
            ))}
          </div>
        </States>
        <States label="md, with a live count">
          <Specimen caption="default">
            <ChipLink href="/search?emirate=dubai" count={formatCount(18940)}>
              Dubai
            </ChipLink>
          </Specimen>
          <Specimen caption="selected — only on a stated preference">
            <ChipLink selected href="/search?emirate=dubai" count={formatCount(18940)}>
              Dubai
            </ChipLink>
          </Specimen>
          <Specimen caption="dashed — a filter, not a place">
            <ChipLink dashed href="/search?freeZone=1" count={formatCount(2410)}>
              Free zones only
            </ChipLink>
          </Specimen>
          <Specimen caption="zero, which is a real answer">
            <ChipLink href="/search?emirate=fujairah" count={formatCount(0)}>
              Fujairah
            </ChipLink>
          </Specimen>
        </States>
        <States label="focus">
          <Specimen caption="focus-visible">
            <ChipLink data-force="focus" href="/search?emirate=sharjah" count={formatCount(6205)}>
              Sharjah
            </ChipLink>
          </Specimen>
        </States>
      </Section>

      <Section
        id="eyebrow"
        title="Eyebrow"
        note="§08 allows uppercase in exactly two places — this is one of them"
      >
        <States label="surfaces">
          <Specimen caption="on paper">
            <Eyebrow>{t("home.emirate_eyebrow")}</Eyebrow>
          </Specimen>
          <Specimen caption="on ink">
            <span className="inline-flex rounded-chip bg-ink-surface px-3 py-2">
              <Eyebrow onInk>{t("home.footer_buyers")}</Eyebrow>
            </span>
          </Specimen>
        </States>
        <States label="carrying a live count" stack>
          <Eyebrow as="h2">{t("categories.matrix_eyebrow", { pages: 84 })}</Eyebrow>
        </States>
      </Section>

      <Section id="category-mark" title="CategoryMark" note="two letters from the taxonomy, never generated initials">
        <States label="sizes">
          {(["sm", "md", "lg", "xl"] as const).map((size) => (
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

      <Section id="stat-card" title="StatCard" note="the number gets the serif face — the one big number §01 allows, except in the console">
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
          {/*
            The console face. The handoff-4 README says no serif anywhere in
            admin, and the alternative to a prop was a second stat component
            saying the same thing differently.
          */}
          <div className="w-64">
            <StatCard
              face="sans"
              label="monthly recurring"
              value={formatAED(409_300 / 100)}
              caption="ACTIVE AND PAST DUE"
            />
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

      <Section
        id="rating-marks"
        title="RatingMarks"
        note="68 · board 1m · squares, never stars, and never a partial mark"
      >
        <States label="whole" stack>
          {[5, 4, 3, 2, 1].map((value) => (
            <div key={value} className="flex items-center gap-3">
              <RatingMarks
                value={value}
                label={t("reviewpage.rating_label", { rating: formatDecimal(value) })}
              />
              <span className="font-mono text-eyebrow tabular-nums text-muted">
                {formatDecimal(value)}
              </span>
            </div>
          ))}
        </States>

        {/*
           4.6 draws four marks and prints 4.6. The decimal lives in the
           numeral, never in a half-filled square: a partial mark is a figure a
           reader has to decode, and it is wrong at any width narrower than the
           difference between 4.6 and 4.7.
        */}
        <States label="decimals" stack>
          {[4.6, 4.2, 3.5].map((value) => (
            <div key={value} className="flex items-center gap-3">
              <RatingMarks
                value={value}
                label={t("reviewpage.rating_label", { rating: formatRating(value) })}
              />
              <span className="font-mono text-eyebrow tabular-nums text-muted">
                {formatRating(value)}
              </span>
            </div>
          ))}
        </States>

        <States label="sizes">
          <Specimen caption="MD · SUMMARY CARD">
            <RatingMarks value={4} label={t("reviewpage.rating_label", { rating: "4" })} />
          </Specimen>
          <Specimen caption="SM · REVIEW ROW">
            <RatingMarks size="sm" value={4} label={t("reviewpage.rating_label", { rating: "4" })} />
          </Specimen>
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
              excludedLabel={t("display.map_excluded", { count: 2 })}
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
              excludedLabel={t("display.map_excluded", { count: 3 })}
              emptyLabel={t("display.map_empty")}
            />
          </div>
        </States>
      </Section>

      <Section
        id="results-map"
        title="ResultsMap"
        note="board 1c · clusters past ~44px · moss = hovered or selected · ink = verified · outlined = unverified · legend names all three in words, never colour alone"
      >
        <States label="clustered, with the overlay and legend" stack>
          <div className="h-96 w-full max-w-3xl overflow-hidden rounded-card border border-line">
            <ResultsMap
              label={t("map.results_label")}
              excluded={3}
              excludedLabel={t("map.excluded", { count: 3 })}
              labels={{
                searchArea: t("map.search_area"),
                freeZones: t("map.free_zones"),
                legend: t("map.legend"),
                legendVisited: t("map.legend_visited"),
                legendVerified: t("map.legend_verified"),
                legendUnverified: t("map.legend_unverified"),
                empty: t("map.empty"),
              }}
              onSearchArea={() => {}}
              freeZones={[
                { id: "jafza", name: "Jebel Ali Free Zone", lat: 25.0107, lng: 55.0632 },
                { id: "dic", name: "Dubai Investment Park", lat: 24.9857, lng: 55.1745 },
              ]}
              pins={GALLERY_PINS}
            />
          </div>
        </States>
        <States label="nothing in this view" stack>
          <div className="h-64 w-full max-w-3xl overflow-hidden rounded-card border border-line">
            <ResultsMap
              label={t("map.results_label")}
              pins={[]}
              labels={{
                searchArea: t("map.search_area"),
                freeZones: t("map.free_zones"),
                legend: t("map.legend"),
                legendVisited: t("map.legend_visited"),
                legendVerified: t("map.legend_verified"),
                legendUnverified: t("map.legend_unverified"),
                empty: t("map.empty"),
              }}
            />
          </div>
        </States>
      </Section>

      <Section
        id="alert"
        title="Alert"
        note="65 · §05.1 · five tones, one optional action, no icon — the copy carries the tone"
      >
        <States label="the five tones" stack>
          <Frame>
            <div className="flex flex-col gap-3">
              <Alert tone="ok" live="polite">
                Saved and live.
              </Alert>
              <Alert tone="info">{t("overview.free_is_free")}</Alert>
              <Alert
                tone="warn"
                action={
                  <Button size="sm" variant="secondary">
                    Edit your spec template
                  </Button>
                }
              >
                62 products have no filterable specs. Buyers filter on those fields, so those
                products are listed but not found.
              </Alert>
              <Alert
                tone="bad"
                live="assertive"
                fix="Use 24-hour times like 08:00 and 17:30."
              >
                &quot;8am&quot; is not a time.
              </Alert>
              <Alert tone="neutral">{t("billing.not_live")}</Alert>
            </div>
          </Frame>
        </States>

        <States label="a title, and a problem that carries its fix" stack>
          <Frame>
            <div className="flex flex-col gap-3">
              <Alert
                tone="warn"
                title="Somebody else has claimed this listing"
                fix="Submit below and carry on setting up. Nothing you fill in is lost if the claim takes a day to resolve."
              >
                We are taking your submission anyway. If a former employee or an agency claimed
                it, this is how it gets put right — a person will look at both.
              </Alert>
              {/*
                The rule the inventory states outright: a notice describing a
                problem must also carry the action that fixes it. A bad or warn
                Alert with neither logs an error in development.
              */}
              <Alert
                tone="bad"
                action={
                  <Button size="sm" variant="secondary">
                    Reload
                  </Button>
                }
              >
                That template has changed since this page opened.
              </Alert>
            </div>
          </Frame>
        </States>
      </Section>
    </>
  );
}
