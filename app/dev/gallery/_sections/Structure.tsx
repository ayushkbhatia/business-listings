"use client";

import { useState } from "react";
import {
  Breadcrumb,
  Card,
  DataTable,
  KeyValuePanel,
  Pagination,
  Panel,
  StepHeader,
  Tabs,
  TableToolbar,
  type Column,
  type RowTone,
} from "@/components/structure";
import { Button, SearchField } from "@/components/primitives";
import { formatAED, formatCount, formatDate, formatDuration, maskPhone, maskTRN } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Frame, Section, Specimen, States } from "../_kit";

interface Row {
  id: string;
  name: string;
  ref: string;
  emirate: string;
  tier: number;
  enquiries: number;
  quoted: number;
  responseMs: number;
  tone: RowTone;
}

const ROWS: Row[] = [
  { id: "1", name: "Al Marwan Trading", ref: "DED-618402", emirate: "Dubai", tier: 3, enquiries: 41, quoted: 184_200, responseMs: 2_400_000, tone: "default" },
  { id: "2", name: "Gulf Line Industrial Supplies", ref: "SHJ-204118", emirate: "Sharjah", tier: 2, enquiries: 18, quoted: 62_400, responseMs: 9_600_000, tone: "default" },
  { id: "3", name: "Emirates Crest Equipment", ref: "ADDED-773915", emirate: "Abu Dhabi", tier: 4, enquiries: 96, quoted: 512_800, responseMs: 900_000, tone: "default" },
  { id: "4", name: "Al Sahra General Trading", ref: "AJM-118206", emirate: "Ajman", tier: 1, enquiries: 4, quoted: 8_900, responseMs: 187_200_000, tone: "attention" },
  { id: "5", name: "Northbay Technical Services", ref: "JAFZA-441027", emirate: "Dubai", tier: 0, enquiries: 0, quoted: 0, responseMs: 0, tone: "blocked" },
  { id: "6", name: "Al Wadi Building Materials", ref: "SAIF-330914", emirate: "Sharjah", tier: 2, enquiries: 27, quoted: 141_050, responseMs: 5_400_000, tone: "default" },
];

export function Structure() {
  const [selected, setSelected] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({
    key: "enquiries",
    direction: "desc",
  });
  const [page, setPage] = useState(2);
  const [tab, setTab] = useState("overview");

  const columns: Column<Row>[] = [
    { key: "name", header: "supplier", sortable: true, render: (r) => <span className="text-ink">{r.name}</span> },
    { key: "ref", header: "licence", mono: true, hideBelow: "md", render: (r) => r.ref },
    { key: "emirate", header: "emirate", hideBelow: "sm", render: (r) => r.emirate },
    { key: "tier", header: "tier", numeric: true, sortable: true, render: (r) => r.tier },
    { key: "enquiries", header: "enquiries", numeric: true, sortable: true, render: (r) => formatCount(r.enquiries) },
    {
      key: "quoted",
      header: "quoted value",
      numeric: true,
      sortable: true,
      hideBelow: "lg",
      render: (r) => formatAED(r.quoted),
    },
    {
      key: "response",
      header: "median reply",
      numeric: true,
      hideBelow: "lg",
      render: (r) => (r.responseMs ? formatDuration(r.responseMs) : "—"),
    },
  ];

  const table = (empty?: boolean, loading?: boolean) => (
    <DataTable
      caption={t("table.caption.businesses")}
      columns={columns}
      rows={empty ? [] : ROWS}
      rowKey={(r) => r.id}
      selectable
      selected={selected}
      onSelectedChange={setSelected}
      selectAllLabel={t("table.select_all")}
      selectRowLabel={(r) => t("table.select_row", { name: r.name })}
      sort={sort}
      onSortChange={setSort}
      sortLabel={(column, direction) =>
        t("table.sort_by", {
          column,
          direction: direction === "asc" ? t("table.sort_asc") : t("table.sort_desc"),
        })
      }
      rowTone={(r) => r.tone}
      rowAction={(r) => ({ label: t("table.view"), onSelect: () => void r })}
      rowMenu={(r) => [
        { key: "assign", label: t("table.assign"), onSelect: () => void r },
        { key: "export", label: t("table.export"), onSelect: () => void r },
        { key: "suspend", label: t("table.suspend"), onSelect: () => void r, destructive: true },
      ]}
      rowMenuLabel={(r) => t("table.row_menu", { name: r.name })}
      actionsHeader={t("table.actions_header")}
      loading={loading}
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{t("empty.filtered.title")}</p>
          <p className="mt-1 text-caption text-muted">{t("empty.filtered.action")}</p>
        </div>
      }
    />
  );

  return (
    <>
      <Section
        id="data-table"
        title="DataTable"
        note="real table markup, mono heads on paper-sunk, hairline dividers, no zebra, no vertical rules"
      >
        <States label="live" stack>
          <div className="w-full">
            <TableToolbar
              actions={
                <>
                  <Button variant="secondary" size="sm">
                    {t("table.export")}
                  </Button>
                  <Button size="sm">{t("action.save")}</Button>
                </>
              }
              selection={{
                count: selected.length,
                countLabel: (count) => t("table.selected", { count }),
                actions: [
                  { key: "assign", label: t("table.assign"), onSelect: () => {} },
                  { key: "export", label: t("table.export"), onSelect: () => {} },
                  { key: "suspend", label: t("table.suspend"), onSelect: () => {}, destructive: true },
                ],
                onClear: () => setSelected([]),
                clearLabel: t("table.clear_selection"),
              }}
            >
              <div className="w-64">
                <SearchField
                  size="sm"
                  label={t("search.label")}
                  clearLabel={t("search.clear")}
                  placeholder={t("search.placeholder")}
                />
              </div>
            </TableToolbar>
            {table()}
          </div>
        </States>

        <States label="row tones" stack>
          <p className="text-caption text-muted">{t("gallery.tone_note")}</p>
        </States>

        {/*
          The state this component did not have until handoff 4 step 0, and the
          one that mattered most. A failed query used to fall through to the
          empty state, so a broken queue told the person clearing it that there
          was nothing to clear.
        */}
        <States label="failed" stack>
          <div className="w-full">
            <DataTable
              caption={t("table.caption.businesses")}
              columns={columns}
              rows={[]}
              rowKey={(r) => r.id}
              error={
                <div className="text-center">
                  <p className="text-body-sm text-bad-ink">{t("table.error.title")}</p>
                  <p className="mt-1 text-caption text-muted">{t("table.error.action")}</p>
                </div>
              }
            />
          </div>
        </States>

        <States label="banded, with a total" stack>
          <div className="w-full">
            <DataTable
              caption={t("table.caption.businesses")}
              columns={columns}
              rows={ROWS}
              rowKey={(r) => r.id}
              stickyHeader
              groupBy={(r) => (r.tier >= 3 ? "verified" : "unverified")}
              groupLabel={(key, count) =>
                key === "verified"
                  ? t("table.band.verified", { count: formatCount(count) })
                  : t("table.band.unverified", { count: formatCount(count) })
              }
              footer={t("table.total", {
                count: formatCount(ROWS.length),
                value: formatAED(ROWS.reduce((sum, r) => sum + r.quoted, 0)),
              })}
            />
          </div>
        </States>
      </Section>

      <Section
        id="table-toolbar"
        title="TableToolbar"
        note="search and filters left, table actions right"
      >
        <States label="idle" stack>
          <div className="w-full">
            <TableToolbar
              actions={
                <Button variant="secondary" size="sm">
                  {t("table.export")}
                </Button>
              }
            >
              <div className="w-64">
                <SearchField
                  size="sm"
                  label={t("search.label")}
                  clearLabel={t("search.clear")}
                  placeholder={t("search.placeholder")}
                />
              </div>
            </TableToolbar>
            <div className="h-2 rounded-b-card border border-t-0 border-line bg-card" />
          </div>
        </States>
      </Section>

      <Section
        id="selection-bar"
        title="SelectionBar"
        note="it replaces the toolbar rather than stacking under it"
      >
        <States label="states" stack>
          <div className="w-full">
            <TableToolbar
              selection={{
                count: 24,
                countLabel: (count) => t("table.selected", { count }),
                actions: [
                  { key: "assign", label: t("table.assign"), onSelect: () => {} },
                  { key: "export", label: t("table.export"), onSelect: () => {} },
                  { key: "suspend", label: t("table.suspend"), onSelect: () => {}, destructive: true },
                ],
                onClear: () => {},
                clearLabel: t("table.clear_selection"),
              }}
            />
            <div className="h-2 rounded-b-card border border-t-0 border-line bg-card" />
          </div>
        </States>

        <States label="loading" stack>
          <div className="w-full">
            <TableToolbar />
            {table(false, true)}
          </div>
        </States>

        <States label="filtered to zero" stack>
          <div className="w-full">
            <TableToolbar />
            {table(true)}
          </div>
        </States>
      </Section>

      <Section id="pagination" title="Pagination" note="hidden at or below 50 rows; never infinite scroll">
        <States label="states" stack>
          <div className="w-full rounded-card border border-line bg-card">
            <Pagination
              page={page}
              pageSize={50}
              total={218}
              onPageChange={setPage}
              rangeLabel={(from, to, total) =>
                t("table.range", { from: formatCount(from), to: formatCount(to), total: formatCount(total) })
              }
              previousLabel={t("table.previous")}
              nextLabel={t("table.next")}
              pageLabel={(p) => t("table.page", { page: p })}
            />
          </div>
          <div className="w-full rounded-card border border-line bg-card">
            <Pagination
              page={7}
              pageSize={50}
              total={4_120}
              onPageChange={() => {}}
              rangeLabel={(from, to, total) =>
                t("table.range", { from: formatCount(from), to: formatCount(to), total: formatCount(total) })
              }
              previousLabel={t("table.previous")}
              nextLabel={t("table.next")}
              pageLabel={(p) => t("table.page", { page: p })}
            />
          </div>
          <p className="text-caption text-muted">{t("gallery.pagination_note")}</p>
        </States>
      </Section>

      <Section id="card" title="Card" note="promoted is one per screen, and dies the moment there are two">
        <States label="elevation">
          {(["flat", "raised", "promoted"] as const).map((elevation) => (
            <Specimen key={elevation} caption={elevation}>
              <Card elevation={elevation}>
                <p className="text-body-sm text-ink">Al Marwan Trading</p>
                <p className="font-mono text-eyebrow text-muted">DED-618402</p>
              </Card>
            </Specimen>
          ))}
          <Specimen caption="selected">
            <Card selected>
              <p className="text-body-sm text-ink">Al Marwan Trading</p>
              <p className="font-mono text-eyebrow text-moss-deep">DED-618402</p>
            </Card>
          </Specimen>
          <Specimen caption="interactive">
            <Card interactive>
              <p className="text-body-sm text-ink">Al Marwan Trading</p>
              <p className="font-mono text-eyebrow text-muted">DED-618402</p>
            </Card>
          </Specimen>
        </States>
      </Section>

      <Section id="panel" title="Panel" note="locked shows the real panel dimmed, and names what unlocks it">
        <States label="states" stack>
          <div className="w-full max-w-2xl">
            <Panel
              eyebrow="listing"
              title="Profile basics"
              description="Shown on your storefront and in search results."
              actions={<Button size="sm" variant="secondary">{t("action.save")}</Button>}
            >
              <p className="text-body-sm text-body">{t("gallery.panel_profile_body")}</p>
            </Panel>
          </div>
          <div className="w-full max-w-2xl">
            <Panel title="Sponsored placement" locked={{ label: t("gallery.locked_note"), action: <Button size="sm">{t("gallery.see_plans")}</Button> }}>
              <p className="text-body-sm text-body">{t("gallery.panel_placement_body")}</p>
            </Panel>
          </div>
          <div className="w-full max-w-2xl">
            <Panel title="Documents" footer={<span className="font-mono text-eyebrow text-muted">3 files</span>}>
              <p className="text-body-sm text-body">{t("gallery.panel_documents_body")}</p>
            </Panel>
          </div>
        </States>
      </Section>

      <Section id="key-value-panel" title="KeyValuePanel" note="an absent value is marked, never dropped">
        <Frame width="44rem">
          <KeyValuePanel
            notProvidedLabel={t("table.not_provided")}
            entries={[
              { key: "licence", label: t("trade.licence_number"), value: "DED-618402", mono: true },
              { key: "authority", label: "Licensing authority", value: "DED" },
              { key: "trn", label: t("trade.trn"), value: maskTRN("100123456783003"), mono: true },
              { key: "established", label: "Established", value: formatDate("2011-04-03T00:00:00+04:00") },
              { key: "phone", label: "Phone", value: maskPhone("048834120"), mono: true },
              { key: "team", label: "Team size", value: "51–200" },
              { key: "languages", label: "Languages", value: "English, Arabic, Hindi, Malayalam", wide: true },
              { key: "website", label: "Website" },
              { key: "whatsapp", label: "WhatsApp" },
            ]}
          />
        </Frame>
      </Section>

      <Section id="tabs" title="Tabs" note="line for sections, enclosed for a work surface">
        <States label="line" stack>
          <div className="w-full max-w-2xl">
            <Tabs
              label={t("gallery.tabs_label")}
              active={tab}
              onChange={setTab}
              items={[
                { key: "overview", label: "Overview" },
                { key: "products", label: "Products", badge: 92 },
                { key: "branches", label: "Branches", badge: 3 },
                { key: "reviews", label: "Reviews" },
                { key: "docs", label: "Documents", disabled: true },
              ]}
            />
          </div>
        </States>
        <States label="enclosed" stack>
          <Tabs
            variant="enclosed"
            label={t("gallery.tabs_label")}
            active={tab}
            onChange={setTab}
            items={[
              { key: "overview", label: "Businesses", badge: 218 },
              { key: "products", label: "Products", badge: 4_120 },
            ]}
          />
        </States>
        <States label="as links" stack>
          <div className="w-full max-w-2xl">
            <Tabs
              as="a"
              label={t("gallery.tabs_label")}
              active="overview"
              items={[
                { key: "overview", label: "Overview", href: "#tabs" },
                { key: "products", label: "Products", href: "#tabs" },
              ]}
            />
          </div>
        </States>
      </Section>

      <Section id="breadcrumb" title="Breadcrumb" note="the last crumb is the page, and is not a link">
        <States label="states" stack>
          <Breadcrumb
            label={`${t("gallery.breadcrumb_label")} — full`}
            items={[
              { label: "Directory", href: "#" },
              { label: "Valves & fittings", href: "#" },
              { label: "Gate valves", href: "#" },
              { label: "Al Marwan Trading" },
            ]}
          />
          <Breadcrumb
            label={`${t("gallery.breadcrumb_label")} — collapsed`}
            maxItems={3}
            items={[
              { label: "Directory", href: "#" },
              { label: "Valves & fittings", href: "#" },
              { label: "Gate valves", href: "#" },
              { label: "DN100", href: "#" },
              { label: "Al Marwan Trading" },
            ]}
          />
        </States>
      </Section>

      <Section id="step-header" title="StepHeader" note="numbered and named, never dots">
        <States label="states" stack>
          <div className="w-full max-w-3xl overflow-hidden rounded-card border border-line">
            <StepHeader
              label={t("shell.onboarding")}
              current={2}
              progressLabel={(current, total) => t("shell.step_progress", { current, total })}
              steps={[
                { key: "claim", label: "Find the business", href: "#" },
                { key: "verify", label: "Prove ownership", href: "#" },
                { key: "profile", label: "Profile basics" },
                { key: "locations", label: "Locations & hours" },
                { key: "plan", label: "Pick a plan" },
              ]}
            />
          </div>
        </States>
      </Section>
    </>
  );
}
