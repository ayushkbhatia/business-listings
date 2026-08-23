// The acceptance surface for handoff 0. Tier 1 and tier 2 components land here in
// every documented state, per handoffs/handoff-0-foundation/README.md §1.
//
// At checkpoint 1 it shows the token layer only: every swatch below is a Tailwind
// utility mapped to a CSS variable in globals.css. If a value here is wrong, the
// token is wrong — there is nowhere else for it to come from.

import {
  formatAED,
  formatCount,
  formatDate,
  formatDateRange,
  formatDuration,
  formatRelative,
  formatShifts,
  formatSize,
  formatTimeRange,
  maskPhone,
  maskTRN,
  formatPhone,
  formatTRN,
} from "@/lib/format";
import { t } from "@/lib/i18n";

type Swatch = { cls: string; token: string };

// A fixed instant, so the gallery renders the same strings on every build and a
// reviewer diffing two screenshots sees real changes only.
const NOW = new Date("2026-08-14T12:00:00+04:00");

const FORMATTERS: { call: string; out: string }[] = [
  { call: "formatAED(15624)", out: formatAED(15624) },
  { call: 'formatAED(15624, { style: "quote" })', out: formatAED(15624, { style: "quote" }) },
  { call: "formatCount(41204)", out: formatCount(41204) },
  { call: "formatDate(…)", out: formatDate(NOW) },
  { call: "formatDateRange(14 Aug, 18 Aug)", out: formatDateRange(NOW, "2026-08-18T12:00:00+04:00") },
  { call: "formatRelative(−4 min)", out: formatRelative(new Date(NOW.getTime() - 4 * 60_000), { now: NOW }) },
  { call: "formatRelative(−2 d 4 h)", out: formatRelative(new Date(NOW.getTime() - 187_200_000), { now: NOW }) },
  { call: "formatDuration(2 h 14 min)", out: formatDuration(8_040_000) },
  { call: 'formatTimeRange("08:00", "18:00")', out: formatTimeRange("08:00", "18:00") },
  { call: "formatShifts(split)", out: formatShifts([{ open: "08:00", close: "13:00" }, { open: "16:00", close: "20:00" }]) },
  { call: 'formatPhone("048834120")', out: formatPhone("048834120") },
  { call: 'maskPhone("048834120")', out: maskPhone("048834120") },
  { call: 'formatPhone("0506412288")', out: formatPhone("0506412288") },
  { call: 'maskPhone("0506412288")', out: maskPhone("0506412288") },
  { call: "formatTRN(…)", out: formatTRN("100123456783003") },
  { call: "maskTRN(…)", out: maskTRN("100123456783003") },
  { call: "formatSize({ dn: 100 })", out: formatSize({ dn: 100 }) },
  { call: "formatSize({ dn: 40 })", out: formatSize({ dn: 40 }) },
];

const STRINGS: { key: string; out: string }[] = [
  { key: "count.suppliers_in_area", out: t("count.suppliers_in_area", { count: 218, area: "Al Quoz" }) },
  { key: "count.suppliers_in_area (1)", out: t("count.suppliers_in_area", { count: 1, area: "Al Quoz" }) },
  { key: "availability.made_to_order", out: t("availability.made_to_order") },
  { key: "availability.indent", out: t("availability.indent") },
  { key: "response.median", out: t("response.median", { duration: formatDuration(8_040_000) }) },
  { key: "term.quoted_value.note", out: t("term.quoted_value.note") },
  { key: "error.phone.format", out: t("error.phone.format") },
  { key: "error.reason.required", out: t("error.reason.required") },
];

const SURFACES: Swatch[] = [
  { cls: "bg-paper", token: "--paper" },
  { cls: "bg-paper-sunk", token: "--paper-sunk" },
  { cls: "bg-fill", token: "--fill" },
  { cls: "bg-card", token: "--card" },
  { cls: "bg-ink-surface", token: "--ink" },
  { cls: "bg-ink-raised", token: "--ink-raised" },
];

const TEXT: Swatch[] = [
  { cls: "text-faint", token: "--text-faint" },
  { cls: "text-muted", token: "--text-muted" },
  { cls: "text-body", token: "--text-body" },
  { cls: "text-prose", token: "--text-prose" },
  { cls: "text-ink", token: "--text-ink" },
];

const STATUS: { tone: string; dot: string; wash: string; line: string; ink: string }[] = [
  { tone: "ok", dot: "bg-ok", wash: "bg-ok-wash", line: "border-ok-line", ink: "text-ok-ink" },
  { tone: "warn", dot: "bg-warn", wash: "bg-warn-wash", line: "border-warn-line", ink: "text-warn-ink" },
  { tone: "bad", dot: "bg-bad", wash: "bg-bad-wash", line: "border-bad-line", ink: "text-bad-ink" },
  { tone: "info", dot: "bg-info", wash: "bg-info-wash", line: "border-info-line", ink: "text-info-ink" },
];

// One class list per theme so Tailwind can see them. A template literal would be
// invisible to the scanner and the utilities would never be generated.
const THEMES = [
  "default",
  "industrial",
  "trade",
  "mono",
  "clinic",
  "salon",
] as const;

const DENSITIES = ["roomy", "comfortable", "compact"] as const;

function Section({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-mono text-eyebrow uppercase text-faint">{id}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function Gallery() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <p className="font-mono text-eyebrow uppercase text-faint">component gallery</p>
      <h1 className="mt-2 font-serif text-h1-serif text-ink">Business Listings</h1>

      <Section id="build state">
        <div className="overflow-x-auto rounded-card border border-line bg-card">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-paper-sunk">
                <th scope="col" className="px-4 py-2 text-left font-mono text-colhead uppercase text-muted">
                  group
                </th>
                <th scope="col" className="px-4 py-2 text-right font-mono text-colhead uppercase text-muted">
                  built
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                { key: "tier-1-primitives", done: 0, total: 18 },
                { key: "tier-2-structure", done: 0, total: 17 },
                { key: "shells", done: 0, total: 4 },
              ].map(({ key, done, total }) => (
                <tr key={key} className="border-t border-line">
                  <td className="px-4 py-2 font-mono text-body-sm text-body">{key}</td>
                  <td className="px-4 py-2 text-right font-mono text-body-sm text-muted">
                    {done}/{total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="surfaces">
        <div className="flex flex-wrap gap-2">
          {SURFACES.map(({ cls, token }) => (
            <div key={token} className="w-40 rounded-chip border border-line p-1">
              <div className={`h-10 rounded-tag ${cls}`} />
              <p className="mt-1 font-mono text-caption text-muted">{token}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="text ramp">
        <div className="rounded-card border border-line bg-card p-4">
          {TEXT.map(({ cls, token }) => (
            <p key={token} className={`text-body ${cls}`}>
              <span className="font-mono text-caption">{token}</span> — 218 suppliers in Al Quoz
            </p>
          ))}
        </div>
      </Section>

      <Section id="status tones">
        <div className="flex flex-wrap gap-2">
          {STATUS.map(({ tone, dot, wash, line, ink }) => (
            <div
              key={tone}
              className={`flex items-center gap-2 rounded-pill border px-3 py-1 ${wash} ${line}`}
            >
              <span className={`size-2 rounded-pill ${dot}`} aria-hidden="true" />
              <span className={`font-mono text-caption ${ink}`}>{tone}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-caption text-muted">
          status never travels as colour alone — the word rides with it
        </p>
      </Section>

      <Section id="seller storefront themes">
        <div className="flex flex-wrap gap-2">
          <div data-theme="default" className="w-36 rounded-chip border border-brand-line p-1">
            <div className="h-8 rounded-tag bg-brand" />
            <p className="mt-1 font-mono text-caption text-brand-text">default</p>
          </div>
          <div data-theme="industrial" className="w-36 rounded-chip border border-brand-line p-1">
            <div className="h-8 rounded-tag bg-brand" />
            <p className="mt-1 font-mono text-caption text-brand-text">industrial</p>
          </div>
          <div data-theme="trade" className="w-36 rounded-chip border border-brand-line p-1">
            <div className="h-8 rounded-tag bg-brand" />
            <p className="mt-1 font-mono text-caption text-brand-text">trade</p>
          </div>
          <div data-theme="mono" className="w-36 rounded-chip border border-brand-line p-1">
            <div className="h-8 rounded-tag bg-brand" />
            <p className="mt-1 font-mono text-caption text-brand-text">mono</p>
          </div>
          <div data-theme="clinic" className="w-36 rounded-chip border border-brand-line p-1">
            <div className="h-8 rounded-tag bg-brand" />
            <p className="mt-1 font-mono text-caption text-brand-text">clinic</p>
          </div>
          <div data-theme="salon" className="w-36 rounded-chip border border-brand-line p-1">
            <div className="h-8 rounded-tag bg-brand" />
            <p className="mt-1 font-mono text-caption text-brand-text">salon</p>
          </div>
        </div>
        <p className="mt-2 text-caption text-muted">
          six swatches, one <span className="font-mono">bg-brand</span> class — the scope does
          the work. {THEMES.length} presets defined.
        </p>
      </Section>

      <Section id="density">
        <div className="flex flex-wrap gap-2">
          {DENSITIES.map((d) => (
            <div
              key={d}
              data-density={d}
              className="rounded-card border border-line bg-card"
              style={{ padding: "var(--card-pad)" }}
            >
              <p className="font-mono text-caption text-muted">{d}</p>
              <div
                className="mt-2 flex items-center rounded-tag bg-fill px-2"
                style={{ height: "var(--row-h)", minHeight: "var(--row-h)" }}
              >
                <span className="font-mono text-caption text-body">--row-h</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="type scale">
        <div className="rounded-card border border-line bg-card p-4">
          <p className="font-serif text-display text-ink">AED 15,624</p>
          <p className="font-serif text-h1-serif text-ink">Instrument Serif</p>
          <p className="text-h1 text-ink">heading one</p>
          <p className="text-h2 text-ink">heading two</p>
          <p className="text-h3 text-ink">heading three</p>
          <p className="text-prose text-prose">
            prose measure caps at 640px regardless of container, so a long paragraph of
            editorial copy never runs wider than the eye can track comfortably.
          </p>
          <p className="text-body text-body">interface copy</p>
          <p className="text-body-sm text-body">interface copy, small</p>
          <p className="text-caption text-muted">caption</p>
          <p className="font-mono text-eyebrow uppercase text-faint">mono eyebrow</p>
        </div>
      </Section>

      <Section id="formatters">
        <div className="overflow-x-auto rounded-card border border-line bg-card">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-paper-sunk">
                <th scope="col" className="px-4 py-2 text-left font-mono text-colhead uppercase text-muted">
                  call
                </th>
                <th scope="col" className="px-4 py-2 text-right font-mono text-colhead uppercase text-muted">
                  output
                </th>
              </tr>
            </thead>
            <tbody>
              {FORMATTERS.map(({ call, out }) => (
                <tr key={call} className="border-t border-line">
                  <td className="px-4 py-1.5 font-mono text-caption text-faint">{call}</td>
                  <td className="px-4 py-1.5 text-right font-mono text-body-sm text-body">{out}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="strings through t()">
        <div className="overflow-x-auto rounded-card border border-line bg-card">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-paper-sunk">
                <th scope="col" className="px-4 py-2 text-left font-mono text-colhead uppercase text-muted">
                  key
                </th>
                <th scope="col" className="px-4 py-2 text-left font-mono text-colhead uppercase text-muted">
                  english
                </th>
              </tr>
            </thead>
            <tbody>
              {STRINGS.map(({ key, out }) => (
                <tr key={key} className="border-t border-line">
                  <td className="px-4 py-1.5 font-mono text-caption text-faint">{key}</td>
                  <td className="px-4 py-1.5 text-body-sm text-body">{out}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="radii and elevation">
        <div className="flex flex-wrap items-end gap-3">
          <div className="size-16 rounded-tag bg-card shadow-raised" />
          <div className="size-16 rounded-chip bg-card shadow-raised" />
          <div className="size-16 rounded-ctl bg-card shadow-raised" />
          <div className="size-16 rounded-card bg-card shadow-promoted" />
          <div className="size-16 rounded-panel bg-card shadow-overlay" />
          <div className="size-16 rounded-pill bg-card shadow-raised" />
        </div>
      </Section>
    </main>
  );
}
