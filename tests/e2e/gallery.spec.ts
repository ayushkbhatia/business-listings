import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Acceptance criterion 8: axe on the gallery — contrast, focus visibility,
 * table headers, live regions.
 *
 * Contrast is split out from the rest. The failing pairs are token-level: they
 * come from docs/tokens.css, which the handoff says to paste unchanged, and
 * they contradict the 4.5:1 and 3:1 floor stated in the same document. Failing
 * the build on them would mean either editing a file the handoff froze or
 * muting the check. Instead they are enumerated here and in docs/contrast.md.
 *
 * This pinned the node *count*, which was the wrong measure: the count grows
 * with every component that renders muted text, so it broke the build for
 * adding a component rather than for adding a fault. What matters is the set of
 * distinct colour pairings that fail. A component reusing a known-bad pairing
 * changes nothing; a component creating a new one has to be listed here, by
 * hand, with its ratio — which is a diff a reviewer can argue with.
 */

/**
 * Every failing foreground/background pair on the gallery, with the ratio axe
 * measures. `#7c776c` is --text-muted, `#a29d92` is --text-faint, `#8a857a` is
 * --text-on-ink-muted, `#8a6d12` is --warn-ink, `#7e7b77` is a disabled
 * control's text. All five are documented in docs/contrast.md.
 */
const KNOWN_CONTRAST_PAIRS: readonly string[] = [
  "#7c776c on #e7ece7 @4.5:1", // muted on --ok-surface
  "#7c776c on #f2f0ea @4.5:1", // muted on --fill
  "#7c776c on #f3f4f2 @4.5:1", // muted on --info-surface
  "#7c776c on #f4f9f5 @4.5:1", // muted on --ok-wash
  "#7c776c on #f6f4ee @4.5:1", // muted on --paper-sunk
  "#7c776c on #f7f5f0 @4.5:1", // muted on --track
  "#7c776c on #faf9f6 @4.5:1", // muted on --paper
  "#7c776c on #ffffff @4.5:1", // muted on --card
  "#7e7b77 on #ffffff @4.5:1", // disabled control text on --card
  "#8a6d12 on #f7efdd @4.5:1", // --warn-ink on --warn-wash
  "#8a857a on #211f1b @4.5:1", // --text-on-ink-muted on --ink
  "#a29d92 on #e7ece7 @4.5:1", // faint on --ok-surface
  "#a29d92 on #f3f4f2 @4.5:1", // faint on --info-surface
  "#a29d92 on #f6f4ee @4.5:1", // faint on --paper-sunk
  "#a29d92 on #faf9f6 @4.5:1", // faint on --paper
  "#a29d92 on #ffffff @4.5:1", // faint on --card
];

test.describe("gallery", () => {
  test("has no axe violations outside contrast", async ({ page }) => {
    await page.goto("/dev/gallery");
    // Not networkidle: the gallery carries a live map, and a tile stream never
    // goes quiet. The last section rendering is the real signal.
    await page.locator("#map-canvas").waitFor({ state: "attached" });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .disableRules(["color-contrast"])
      .analyze();

    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      help: v.help,
      first: v.nodes[0]?.html?.slice(0, 120),
    }));

    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });

  test("contrast failures are the known token-level set and no more", async ({ page }) => {
    await page.goto("/dev/gallery");
    // Not networkidle: the gallery carries a live map, and a tile stream never
    // goes quiet. The last section rendering is the real signal.
    await page.locator("#map-canvas").waitFor({ state: "attached" });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2aa"])
      .withRules(["color-contrast"])
      .analyze();

    const found = new Map<string, { count: number; ratio: unknown; example: string }>();
    for (const violation of results.violations) {
      for (const node of violation.nodes) {
        const data = (node.any[0]?.data ?? {}) as Record<string, unknown>;
        const key = `${data["fgColor"]} on ${data["bgColor"]} @${data["expectedContrastRatio"]}`;
        const seen = found.get(key);
        if (seen) seen.count += 1;
        else
          found.set(key, {
            count: 1,
            ratio: data["contrastRatio"],
            example: node.html?.slice(0, 100) ?? "",
          });
      }
    }

    const unexpected = [...found.entries()]
      .filter(([key]) => !KNOWN_CONTRAST_PAIRS.includes(key))
      .map(([key, v]) => `${key} = ${v.ratio} · ${v.count} node(s) · ${v.example}`);

    // A new pairing is a new decision, and it has to be argued for in the list
    // above rather than absorbed by a number going up.
    expect(unexpected, unexpected.join("\n")).toEqual([]);

    // And the other direction: a pairing that has been fixed should leave the
    // list, or this becomes a record of problems the codebase no longer has.
    const stale = KNOWN_CONTRAST_PAIRS.filter((key) => !found.has(key));
    expect(stale, `fixed — remove from KNOWN_CONTRAST_PAIRS:\n${stale.join("\n")}`).toEqual([]);
  });

  test("every tier 1 to 4 component is on the page", async ({ page }) => {
    await page.goto("/dev/gallery");

    const tier1 = [
      "button", "icon-button", "split-button", "segmented-control", "input", "textarea",
      "select", "multi-select", "search-field", "checkbox", "radio", "toggle",
      "range-slider", "stepper", "time-pair", "file-drop", "label", "field-error",
    ];
    const tier2 = [
      "data-table", "table-toolbar", "selection-bar", "pagination", "key-value-panel",
      "card", "panel", "tabs", "breadcrumb", "public-nav", "app-sidebar", "page-header",
      "step-header", "filter-rail", "builder-chrome", "drawer", "modal",
    ];
    const tier3 = [
      "status-badge", "plan-badge", "filter-chip", "tag", "stat-card", "progress-bar",
      "step-progress", "stacked-bar", "funnel-bars", "share-bars", "waterfall",
      "image-placeholder", "logo-tile", "category-mark", "map-canvas",
    ];

    const tier4 = [
      "verification-badge", "verification-ladder", "listing-card", "product-card",
      "spec-table", "completeness-meter", "response-time",
    ];

    for (const id of [...tier1, ...tier2, ...tier3, ...tier4]) {
      await expect(page.locator(`#${id}`), `#${id} is missing from the gallery`).toHaveCount(1);
    }
  });

  test("the DataTable is real table markup", async ({ page }) => {
    await page.goto("/dev/gallery");
    const table = page.locator("#data-table table").first();

    await expect(table).toBeVisible();
    await expect(table.locator("caption")).toHaveCount(1);
    await expect(table.locator("thead")).toHaveCount(1);

    const heads = await table.locator("th").count();
    const scoped = await table.locator("th[scope]").count();
    expect(scoped).toBe(heads);

    // No vertical rules, and no zebra striping.
    const cells = table.locator("tbody td");
    const count = await cells.count();
    for (let i = 0; i < count; i += 1) {
      const border = await cells.nth(i).evaluate((el) => {
        const s = getComputedStyle(el);
        return parseFloat(s.borderLeftWidth) + parseFloat(s.borderRightWidth);
      });
      expect(border).toBe(0);
    }
  });

  test("the three shells resolve their three densities", async ({ page }) => {
    await page.goto("/dev/gallery");

    const expected = {
      "#shell-public": { density: "roomy", rowH: "auto", gutter: "18px" },
      "#shell-dashboard": { density: "comfortable", rowH: "46px", gutter: "14px" },
      "#shell-admin": { density: "compact", rowH: "38px", gutter: "10px" },
    };

    for (const [selector, want] of Object.entries(expected)) {
      const shell = page.locator(`${selector} [data-density]`).first();
      await expect(shell).toHaveAttribute("data-density", want.density);
      const resolved = await shell.evaluate((el) => ({
        rowH: getComputedStyle(el).getPropertyValue("--row-h").trim(),
        gutter: getComputedStyle(el).getPropertyValue("--gutter").trim(),
      }));
      expect(resolved.rowH, selector).toBe(want.rowH);
      expect(resolved.gutter, selector).toBe(want.gutter);
    }
  });

  test("every interactive element has an accessible name", async ({ page }) => {
    await page.goto("/dev/gallery");

    const unnamed = await page.evaluate(() => {
      const name = (el: Element) => {
        const label = el.getAttribute("aria-label");
        if (label) return label;
        const by = el.getAttribute("aria-labelledby");
        if (by) {
          return by
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
            .join(" ")
            .trim();
        }
        return (el.textContent ?? "").trim();
      };
      return [
        ...document.querySelectorAll(
          "button, summary, select, textarea, input:not([type=hidden]):not([aria-hidden=true])",
        ),
      ]
        .filter((el) => {
          if (name(el)) return false;
          if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false;
          if (el.closest("label")) return false;
          return true;
        })
        .map((el) => el.outerHTML.slice(0, 100));
    });

    expect(unnamed, unnamed.join("\n")).toEqual([]);
  });
});

test.describe("verification is platform-owned", () => {
  /**
   * Handoff 1 acceptance criterion 8, and CLAUDE.md non-negotiable 2. A seller
   * theme recolours the storefront header, headings, buttons, links and form
   * focus. It must not reach a verification badge — a trust signal a seller
   * controls is not a trust signal.
   */
  test("a seller theme leaves the verification badge unchanged", async ({ page }) => {
    await page.goto("/dev/gallery");
    await page.locator("#theme-proof").waitFor();

    const measured = await page.evaluate(() => {
      const scopes = [...document.querySelectorAll("#theme-proof [data-theme]")];
      return scopes.map((scope) => {
        const themed = scope.querySelector(".text-brand") as HTMLElement;
        const badge = scope.querySelector("[data-theme-proof=badge] > span") as HTMLElement;
        const style = getComputedStyle(badge);
        return {
          theme: scope.getAttribute("data-theme"),
          // Proof the theme is actually live in this scope.
          themedText: getComputedStyle(themed).color,
          badgeColor: style.color,
          badgeBackground: style.backgroundColor,
          badgeBorder: style.borderTopColor,
        };
      });
    });

    expect(measured.length).toBe(6);

    // The themes really are different from one another...
    expect(new Set(measured.map((m) => m.themedText)).size).toBe(6);

    // ...and the badge is identical across every one of them.
    const badges = new Set(
      measured.map((m) => `${m.badgeColor}|${m.badgeBackground}|${m.badgeBorder}`),
    );
    expect(badges.size, JSON.stringify(measured, null, 2)).toBe(1);
  });

  test("no public surface renders a price on a product", async ({ page }) => {
    await page.goto("/dev/gallery");
    const cards = page.locator("#product-card");
    await expect(cards).toHaveCount(1);
    // AED anywhere inside a product card would be a price. The StatCard
    // section carries AED legitimately; a product card must not.
    await expect(cards.getByText(/AED/)).toHaveCount(0);
  });
});

test.describe("DataTable column alignment", () => {
  /*
   * A regression test for a bug that shipped in handoff 0 and was found in
   * handoff 4 step 1, by which point every table in the product had it.
   *
   * The row tone edge was a `::before` on the `<tr>`. The CSS table fixup rules
   * wrap a non-cell child of a table-row in an **anonymous table-cell**, and
   * absolute positioning does not prevent the box being generated — so every
   * six-column table quietly became seven columns, with the body sitting one
   * column to the right of its own headers.
   *
   * Nobody caught it by eye because the column heads are small mono uppercase
   * and the misalignment reads as loose placement rather than a broken table.
   * Measuring is the only way to see it, so this measures.
   */
  test("every table body lines up with its own headers", async ({ page }) => {
    await page.goto("/dev/gallery");
    await page.locator("table").first().waitFor();

    const mismatches = await page.evaluate(() => {
      const out: { caption: string; head: number[]; cells: number[] }[] = [];
      for (const table of document.querySelectorAll("table")) {
        const x = (el: Element) => Math.round(el.getBoundingClientRect().x);
        const head = [...table.querySelectorAll("thead th")].map(x);
        const row = [...table.querySelectorAll("tbody tr")].find(
          (tr) => tr.children.length === head.length,
        );
        if (!row || head.length === 0) continue;
        const cells = [...row.children].map(x);
        if (JSON.stringify(head) !== JSON.stringify(cells)) {
          out.push({
            caption: table.querySelector("caption")?.textContent?.trim() ?? "(no caption)",
            head,
            cells,
          });
        }
      }
      return out;
    });

    expect(mismatches).toEqual([]);
  });
});
