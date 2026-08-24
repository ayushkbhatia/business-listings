import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Criterion 10 asks for axe clean on all eleven routes. These are the five from
 * step 3. Contrast is excluded for the reason set out in docs/contrast.md — the
 * failing pairs are token-level and enumerated there.
 */
const ROUTES = [
  "/b/al-marwan-industrial-supplies-llc",
  "/b/al-marwan-industrial-supplies-llc/products",
  "/b/al-marwan-industrial-supplies-llc/branches",
  "/b/al-manara-equipment-trading-llc/reviews",
  "/b/al-marwan-industrial-supplies-llc/p/resilient-seated-gate-valve-dn150-0",
  "/b/al-wadi-technical-services-llc",
];

for (const route of ROUTES) {
  test(`axe is clean on ${route}`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .disableRules(["color-contrast"])
      .analyze();

    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      first: v.nodes[0]?.html?.slice(0, 120),
    }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });
}
