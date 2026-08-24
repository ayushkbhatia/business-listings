/**
 * Groups every axe colour-contrast finding on the gallery by the actual
 * foreground/background pair, so the failures are twelve token decisions
 * rather than 474 anonymous nodes.
 *
 * Needs the app running. `pnpm dev`, then `pnpm report:contrast`.
 */
import { chromium } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const axeSource: string = require("axe-core").source;

const url = process.env.CONTRAST_URL ?? "http://localhost:3000/dev/gallery";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
await page.goto(url, { waitUntil: "domcontentloaded" });
// Not networkidle: a page carrying a live map never goes quiet. Wait for the
// gallery's last section where it exists, and settle briefly otherwise.
await page
  .locator("#map-canvas")
  .waitFor({ state: "attached", timeout: 2000 })
  .catch(() => page.waitForTimeout(400));
await page.addScriptTag({ content: axeSource });

const grouped = await page.evaluate(async () => {
  // @ts-expect-error axe is injected above
  const results = await window.axe.run(document, {
    runOnly: { type: "rule", values: ["color-contrast"] },
  });

  const buckets: Record<string, { count: number; ratio: number; needed: number; sample: string }> = {};
  for (const violation of results.violations) {
    for (const node of violation.nodes) {
      for (const check of node.any ?? []) {
        const d = check.data ?? {};
        if (!d.fgColor || !d.bgColor) continue;
        const key = `${d.fgColor} on ${d.bgColor}`;
        buckets[key] ??= {
          count: 0,
          ratio: d.contrastRatio,
          needed: d.expectedContrastRatio ? parseFloat(String(d.expectedContrastRatio)) : 0,
          sample: node.html.slice(0, 90),
        };
        buckets[key].count += 1;
      }
    }
  }
  return { total: results.violations.flatMap((v: { nodes: unknown[] }) => v.nodes).length, buckets };
});

const rows = Object.entries(grouped.buckets).sort((a, b) => b[1].count - a[1].count);

console.log(`axe colour-contrast on ${url}`);
console.log(`${grouped.total} failing nodes, from ${rows.length} distinct colour pairings.\n`);
console.log("| nodes | foreground on background | measured | needed |");
console.log("|---:|---|---:|---:|");
for (const [pair, info] of rows) {
  console.log(`| ${info.count} | \`${pair}\` | ${info.ratio}:1 | ${info.needed}:1 |`);
}

console.log("");
console.log("Sample element per pairing:");
for (const [pair, info] of rows) {
  console.log(`  ${pair}\n    ${info.sample}`);
}

await browser.close();
