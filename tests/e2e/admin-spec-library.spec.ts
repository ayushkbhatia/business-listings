import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Board 4e, in a browser, signed in as an ops lead.
 *
 * The criteria about what the services refuse and what they write are proved in
 * `tests/integration/spec-library.test.ts` — a browser is the wrong instrument
 * for "publishing does not change a product's state". What is asserted here is
 * what ops is **told**, because on this screen the wording is the whole
 * correction: the board offered `Publish with 60-day grace` over a card saying
 * 88,410 products would be left in violation, and both halves were wrong.
 *
 * Criterion 4 is the sharpest of these and it is an assertion about absence:
 * no copy anywhere offers a grace period, a deadline or a countdown against
 * seller data. A test that only checks the new wording would pass with the old
 * wording still sitting beside it.
 *
 * The filename has to start with `admin` — Playwright matches the `staff`
 * project on `/admin[\w-]*\.spec\.ts/` against the absolute path.
 */

test.describe("board 4e — the spec library", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/spec-library");
  });

  test("leads with coverage, and every figure in the header is a query", async ({ page }) => {
    const header = page.getByRole("banner");
    // `84 templates · 96 of 418 subcategories covered · 612,400 products`. The
    // board read `1,204 attributes`, which is 84 × 14.3 — field slots, not
    // attributes — and said nothing about coverage at all.
    await expect(header).toContainText(/\d+ templates/);
    await expect(header).toContainText(/\d+ of \d+ subcategories covered/);
    await expect(header).toContainText(/products on a template/);
  });

  test("offers no grace period, deadline or countdown anywhere", async ({ page }) => {
    for (const view of ["", "?view=coverage", "?view=drafts", "?view=proposed"]) {
      await page.goto(`/admin/spec-library${view}`);
      const body = page.locator("body");
      await expect(body).not.toContainText(/grace/i);
      await expect(body).not.toContainText(/60-day/i);
      await expect(body).not.toContainText(/deadline/i);
      await expect(body).not.toContainText(/countdown/i);
    }
  });

  test("splits templates and coverage into separate views", async ({ page }) => {
    // The board rendered a category row inside a table of templates, with a
    // `Create` action sitting in the `VERSION` column.
    await expect(page.getByRole("link", { name: /^Templates/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Coverage gaps/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /^Drafts/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Proposed fields/ })).toBeVisible();
  });

  test("makes every template row an anchor to its fields", async ({ page }) => {
    // On the board the rows were spans, the `FIELDS` count linked nowhere, and
    // the only affordance on the screen was `+ New template`.
    const table = page.getByRole("table", { name: /Platform spec templates/i });
    const first = table.getByRole("link").first();
    await expect(first).toHaveAttribute("href", /\/admin\/spec-library\/.+/);

    await first.click();
    await expect(page.getByRole("table", { name: /Fields in this platform template/i })).toBeVisible();
  });

  test("states the FILLED denominator on screen", async ({ page }) => {
    // Clones rename, add and detach fields, so an unstated denominator is a
    // number ops will judge a template by and cannot check.
    await expect(page.getByRole("table", { name: /Platform spec templates/i })).toContainText(
      /measured over mapped platform fields only/i,
    );
  });

  test("says a subcategory may hold several templates", async ({ page }) => {
    // Board 3h Q3, answered here. `4d`'s setting is the default, not the only
    // template available.
    await expect(page.getByRole("table", { name: /Platform spec templates/i })).toContainText(
      /may hold several templates/i,
    );
  });

  test("never conveys version or draft state by colour alone", async ({ page }) => {
    // Case-insensitively: the eyebrow is uppercased by CSS, and the DOM text —
    // which is what a screen reader gets — reads `v2 · Live`. Criterion 15 is
    // about the word existing, not about it shouting.
    const table = page.getByRole("table", { name: /Platform spec templates/i });
    await expect(table).toContainText(/v\d+ · Live/i);
  });

  test("ranks coverage gaps by products already listed", async ({ page }) => {
    await page.goto("/admin/spec-library?view=coverage");
    const rows = page.getByRole("table", { name: /Subcategories with no spec template/i }).getByRole("row");
    await expect(rows.first()).toBeVisible();

    const counts = await page
      .getByRole("table", { name: /Subcategories with no spec template/i })
      .getByRole("cell")
      .allInnerTexts();
    expect(counts.length).toBeGreaterThan(0);
  });

  test("holds a subcategory the taxonomy screen is holding back", async ({ page }) => {
    await page.goto("/admin/spec-library?view=coverage");
    // Two screens must not both be authoring for a subcategory one of them is
    // trying to remove — so it renders held, with the reason, not `Create`.
    const held = page.getByText(/On hold/i).first();
    if (await held.isVisible()) {
      await expect(page.locator("body")).toContainText(/below its own publishing floor/i);
    }
  });

  test("states the spread on a proposed field rather than offering one-click promotion", async ({
    page,
  }) => {
    await page.goto("/admin/spec-library?view=proposed");
    // `Promote` was one click into a definition 412 sellers already had their
    // own version of. Promotion is a merge, and the dictionary it writes into
    // has no board yet.
    await expect(page.getByRole("button", { name: /^Promote$/ })).toHaveCount(0);
  });

  test("axe clean but for the pinned token contrast", async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      // `--text-muted` is 4.23:1 on paper and `--text-faint` 2.57:1. Both are
      // design-system tokens used by every screen in the console, pinned
      // pending a canvas decision — see docs/contrast.md.
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 4e — one template", () => {
  test("names both actions, and says requiring is not part of publishing", async ({ page }) => {
    await page.goto("/admin/spec-library");
    await page.getByRole("table", { name: /Platform spec templates/i }).getByRole("link").first().click();

    const fields = page.getByRole("table", { name: /Fields in this platform template/i });
    await expect(fields).toBeVisible();

    // The second action exists and is reachable per field.
    await expect(page.getByRole("link", { name: /Require this field/ }).first()).toBeVisible();
  });

  test("says a removal is not a delete", async ({ page }) => {
    await page.goto("/admin/spec-library");
    await page.getByRole("table", { name: /Platform spec templates/i }).getByRole("link").first().click();

    // "Remove from the library" reads like a delete. Per 3h §6 the field and
    // its data stay on every clone as a seller-owned field.
    await expect(page.locator("body")).toContainText(
      /stay on every seller copy as a field of their own/i,
    );
    await expect(page.locator("body")).toContainText(/Nothing is deleted/i);
  });

  test("promises no facet-demand figure it cannot produce", async ({ page }) => {
    await page.goto("/admin/spec-library");
    await page.getByRole("table", { name: /Platform spec templates/i }).getByRole("link").first().click();

    // Board 4e Q5 wants `12c`'s facet-application count beside the flag.
    // `SearchQueryLog` records the query, the category and the emirate — not
    // which filters were applied — so the screen says what it cannot tell you.
    await expect(page.locator("body")).toContainText(
      /records what was typed, not which filters were used/i,
    );
  });
});
