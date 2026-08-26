import { contrastRatio as ratio } from "../lib/theme/contrast.js";
/**
 * Measures every foreground/background pairing the design system actually uses
 * against the §09.2 floor: body text 4.5:1, large text and UI borders 3:1.
 *
 * Reads the values out of docs/tokens.css so it cannot drift from the tokens.
 */
import { readFileSync } from "node:fs";

/*
 * The maths is `lib/theme/contrast.ts`, not a copy.
 *
 * It lived here alone while contrast was only ever audited. Criterion 5 made it
 * a rule the product enforces on a seller's own brand colour, and two
 * implementations of WCAG relative luminance is two implementations that
 * eventually disagree — with the audit saying one thing and the form saying
 * another about the same hex.
 */
const css = readFileSync("docs/tokens.css", "utf8");

function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css);
  if (!m) throw new Error(`No token --${name} in docs/tokens.css`);
  return m[1]!;
}

interface Pair {
  fg: string;
  bg: string;
  use: string;
  /** 4.5 for body text, 3 for large text and UI borders. */
  floor: number;
}

const PAIRS: Pair[] = [
  // Text on paper
  { fg: "text-ink", bg: "paper", use: "headings on paper", floor: 4.5 },
  { fg: "text-prose", bg: "paper", use: "long-form prose on paper", floor: 4.5 },
  { fg: "text-body", bg: "paper", use: "interface copy on paper", floor: 4.5 },
  { fg: "text-muted", bg: "paper", use: "secondary copy on paper", floor: 4.5 },
  { fg: "text-faint", bg: "paper", use: "labels and placeholders on paper", floor: 4.5 },

  // Text on card
  { fg: "text-ink", bg: "card", use: "headings on a card", floor: 4.5 },
  { fg: "text-body", bg: "card", use: "interface copy on a card", floor: 4.5 },
  { fg: "text-muted", bg: "card", use: "secondary copy on a card", floor: 4.5 },
  { fg: "text-faint", bg: "card", use: "labels and placeholders on a card", floor: 4.5 },

  // Text on the sunk surface — table heads, footers
  { fg: "text-muted", bg: "paper-sunk", use: "mono column heads", floor: 4.5 },
  { fg: "text-faint", bg: "paper-sunk", use: "faint text on a table head", floor: 4.5 },

  // Accent
  { fg: "text-on-ink", bg: "moss", use: "label on a primary button", floor: 4.5 },
  { fg: "moss", bg: "paper", use: "links on paper", floor: 4.5 },
  { fg: "moss", bg: "card", use: "links on a card", floor: 4.5 },
  { fg: "moss-deep", bg: "moss-wash", use: "selected segment, chips", floor: 4.5 },

  // On ink surfaces — the sidebar
  { fg: "text-on-ink", bg: "ink", use: "sidebar text", floor: 4.5 },
  { fg: "text-on-ink-muted", bg: "ink", use: "inactive sidebar item", floor: 4.5 },
  { fg: "text-on-ink-faint", bg: "ink", use: "sidebar group heading", floor: 4.5 },
  { fg: "moss-on-ink", bg: "ink", use: "accent on a dark surface", floor: 4.5 },
  { fg: "moss-on-ink-text", bg: "moss-on-ink", use: "admin mark", floor: 4.5 },

  // Status, as text on its own wash
  { fg: "ok-ink", bg: "ok-wash", use: "ok badge", floor: 4.5 },
  { fg: "warn-ink", bg: "warn-wash", use: "warn badge", floor: 4.5 },
  { fg: "bad-ink", bg: "bad-wash", use: "bad badge", floor: 4.5 },
  { fg: "info-ink", bg: "info-wash", use: "info badge", floor: 4.5 },
  { fg: "ok-ink", bg: "ok-surface", use: "ok row tint", floor: 4.5 },
  { fg: "warn-ink", bg: "warn-surface", use: "warn row tint", floor: 4.5 },
  { fg: "bad-ink", bg: "bad-surface", use: "bad row tint", floor: 4.5 },
  { fg: "text-body", bg: "warn-surface", use: "body copy on an attention row", floor: 4.5 },
  { fg: "text-body", bg: "bad-surface", use: "body copy on a blocked row", floor: 4.5 },
  { fg: "text-on-ink", bg: "bad", use: "label on a danger button", floor: 4.5 },

  // UI borders and non-text — the 3:1 floor
  { fg: "line-strong", bg: "card", use: "input border", floor: 3 },
  { fg: "line-strong", bg: "paper", use: "input border on paper", floor: 3 },
  { fg: "line", bg: "card", use: "hairline divider", floor: 3 },
  { fg: "moss", bg: "card", use: "focus ring", floor: 3 },
  { fg: "ok", bg: "card", use: "status dot", floor: 3 },
  { fg: "warn", bg: "card", use: "status dot", floor: 3 },
  { fg: "bad", bg: "card", use: "status dot", floor: 3 },
  { fg: "info", bg: "card", use: "status dot", floor: 3 },
  { fg: "disabled-text", bg: "fill", use: "disabled control text", floor: 3 },
];

const rows = PAIRS.map((pair) => {
  const fg = token(pair.fg);
  const bg = token(pair.bg);
  const r = ratio(fg, bg);
  return { ...pair, fgHex: fg, bgHex: bg, ratio: r, passes: r >= pair.floor };
});

const failures = rows.filter((r) => !r.passes);

console.log(`| pair | use | ratio | floor | |`);
console.log(`|---|---|---:|---:|---|`);
for (const r of rows) {
  console.log(
    `| \`--${r.fg}\` on \`--${r.bg}\` | ${r.use} | ${r.ratio.toFixed(2)}:1 | ${r.floor}:1 | ${r.passes ? "pass" : "**FAIL**"} |`,
  );
}
console.log("");
console.log(`${rows.length - failures.length} of ${rows.length} pairings meet the floor.`);

if (failures.length > 0) {
  console.log("");
  console.log("Failures:");
  for (const f of failures) {
    console.log(`  --${f.fg} ${f.fgHex} on --${f.bg} ${f.bgHex} = ${f.ratio.toFixed(2)}:1, needs ${f.floor}:1  (${f.use})`);
  }
}
