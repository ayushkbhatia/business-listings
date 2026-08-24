import { expect } from "vitest";
import axe, { type RunOptions } from "axe-core";

/**
 * Assert a rendered fragment has no axe violations.
 *
 * `vitest-axe` would do this, but its matcher augments the `Vi` global
 * namespace, which Vitest 4 no longer uses, so the matcher exists at runtime
 * and not to TypeScript. Calling axe-core directly is three lines and produces
 * a better failure: the rule id, the impact, and the element, rather than
 * "expected no violations".
 */
export async function expectNoAxeViolations(
  container: Element,
  options: RunOptions = {},
): Promise<void> {
  const results = await axe.run(container, {
    // Colour contrast is measured against the real tokens in
    // scripts/contrast-audit.mts. jsdom has no layout, so axe cannot compute it
    // here and reports every node as incomplete.
    rules: { "color-contrast": { enabled: false } },
    ...options,
  });

  const failures = results.violations.map(
    (v) => `${v.id} (${v.impact ?? "unknown"}): ${v.help}\n    ${v.nodes.map((n) => n.html).join("\n    ")}`,
  );

  expect(failures, failures.join("\n\n")).toEqual([]);
}
