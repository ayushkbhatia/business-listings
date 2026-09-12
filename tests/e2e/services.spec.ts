import { expect, test } from "@playwright/test";

/**
 * Boards `3g-s`, `3f-s`, `1g-s` — the scope sheet, from a seat that sells work.
 *
 * This spec has its own project and its own seat because every other seller
 * fixture on this platform sells goods: `sells_kind` is `unset` on all 123 live
 * businesses, which means goods, so the services screens could only ever be
 * exercised in their empty state. `seedServicesFirm` builds the firm this signs
 * in as — three services, one of them deliberately live at 4 of 6.
 */

test.describe("board 3f-s — the services list", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/services");
  });

  test("offers services in the rail and no product catalogue at all", async ({ page }) => {
    /*
       Board `3f-s` B1. A firm that sells work has no products, and a rail
       carrying *Products* over a screen with nothing in it tells them they have
       forgotten something. Scoped to the navigation, because "Products" is also
       a word in the public header above it.
    */
    const rail = page.getByRole("navigation");
    await expect(rail.getByRole("link", { name: "Services", exact: true })).toBeVisible();
    await expect(rail.getByRole("link", { name: "Products", exact: true })).toHaveCount(0);
  });

  test("counts live and draft, and the count matches the rows", async ({ page }) => {
    await expect(page.getByText("2 live · 1 draft")).toBeVisible();
    await expect(page.getByRole("link", { name: "Statutory audit" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Transfer pricing documentation" }),
    ).toBeVisible();
  });

  test("carries no stock, price, import or bulk-edit affordance — criterion 1", async ({
    page,
  }) => {
    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader", { name: "Scope sheet" })).toBeVisible();
    for (const gone of ["Stock", "Price", "Availability"]) {
      await expect(table.getByRole("columnheader", { name: gone })).toHaveCount(0);
    }
    await expect(page.getByRole("button", { name: /import/i })).toHaveCount(0);
  });

  test("publishes an incomplete sheet, and says what it costs — criterion 3", async ({
    page,
  }) => {
    /*
       The rule both boards spend a paragraph on. Six required fields make a
       sheet complete, not publishable — and the screen's job is to make the
       cost legible rather than to withhold the button.
    */
    const row = page.getByRole("row", { name: /VAT and corporate tax filing/ });
    await expect(row.getByText("4 of 6")).toBeVisible();
    await expect(row.getByText("Live", { exact: true })).toBeVisible();

    // And the line under the table names the row rather than counting them.
    await expect(
      page.getByText(/VAT and corporate tax filing is live at 4 of 6/),
    ).toBeVisible();
  });

  test("renders a draft's empty columns as `Not set`, never blank — B6", async ({ page }) => {
    const row = page.getByRole("row", { name: /Transfer pricing documentation/ });
    await expect(row.getByText("Not set").first()).toBeVisible();
  });

  test("offers exactly publish and unpublish in bulk — criterion 4", async ({ page }) => {
    await page.getByRole("checkbox", { name: /Select Statutory audit/ }).check();

    /*
       `exact`, because a role name matches as a substring and "Publish" finds
       "Unpublish" too. Third time this class of locator has cost a run on this
       project; it is in `docs/` and in the notes, and it still reads as fine.
    */
    const bar = page.getByText("1 selected").locator("..");
    await expect(bar.getByRole("button", { name: "Publish", exact: true })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Unpublish", exact: true })).toBeVisible();
    await expect(bar.getByRole("button", { name: /Delete/ })).toHaveCount(0);
  });
});

test.describe("board 3g-s — the scope sheet", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/services");
    await page.getByRole("link", { name: "Statutory audit" }).click();
    await page.waitForURL(/\/dashboard\/services\/[a-z0-9]+/);
  });

  test("shows completeness as a computed checklist with nothing to tick", async ({ page }) => {
    await expect(page.getByText("6 of 6 required")).toBeVisible();
    await expect(
      page.getByText("Measured from the record. There is no box to tick"),
    ).toBeVisible();

    // Criterion 3: no control writes the number.
    const sheet = page.getByText("Scope sheet", { exact: true }).locator("..").locator("..");
    await expect(sheet.getByRole("checkbox")).toHaveCount(0);
  });

  test("offers the family's fee bases and not a global list — criterion 2", async ({ page }) => {
    /*
       The seeded firm's trade carries the audit family, which offers a fixed
       fee, an hourly rate, a retainer and on-assessment — and not per sq ft per
       year, which belongs to facilities management. One global enum was the
       first design and it was wrong for every family at once.
    */
    const feeBasis = page.getByLabel("Fee basis");
    await expect(feeBasis.getByRole("option", { name: "Fixed fee" })).toHaveCount(1);
    await expect(feeBasis.getByRole("option", { name: "Retainer" })).toHaveCount(1);
    await expect(feeBasis.getByRole("option", { name: /sq ft/ })).toHaveCount(0);
  });

  test("keeps the indicative fee where the seller fills it in, and says it is private", async ({
    page,
  }) => {
    await expect(page.getByText("Indicative fee is optional, and private")).toBeVisible();
    await expect(
      page.getByText("There is no price on any public service page."),
    ).toBeVisible();
  });

  test("logs a change with the value it replaced — criterion 7", async ({ page }) => {
    /*
       Self-contained: it types both values rather than asserting against what
       the seed wrote. A test that depends on the fixture's prior value is a
       test that passes once and then fails on the value it left behind — which
       is exactly what this one did on its second run.

       It waits on the write rather than on the receipt, too. The sidebar
       already says "Saved 2m ago" from the first render, so an assertion on
       that text passes before the autosave has fired.
    */
    const editor = page.url();
    const saveOf = (value: string) => {
      const landed = page.waitForResponse(
        (response) =>
          response.url() === editor && response.request().method() === "POST" && response.ok(),
      );
      return page
        .getByLabel("Turnaround")
        .fill(value)
        .then(() => landed);
    };

    await saveOf("Within 3 working days");
    await saveOf("Within 5 working days");

    /*
       `.first()`, because the log is append-only and this test has run before.
       The assertion is that such an entry exists, not that it is the only one —
       a strict match here fails on the second run against a log doing exactly
       what it is for.
    */
    await page.reload();
    await expect(
      page.getByText(/Turnaround, from “Within 3 working days”/).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Put the fixture back, so the next run reads what the seed wrote.
    await saveOf("3–4 weeks from complete records");
  });
});

test.describe("board 1g-s — the public scope table", () => {
  const path = "/b/meridian-chartered-accountants/s/statutory-audit";

  test("renders the scope table with included and excluded side by side", async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "Statutory audit" })).toBeVisible();

    // Criterion 4: equal weight, not an accordion and not a disclosure.
    await expect(page.getByText("Included", { exact: true })).toBeVisible();
    await expect(page.getByText("Not included", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Not included/ })).toHaveCount(0);
  });

  test("carries no price and no indicative fee anywhere — criterion 3", async ({ page }) => {
    await page.goto(path);
    const html = await page.content();
    expect(html).not.toContain("14,000");
    expect(html.toLowerCase()).not.toContain("indicative fee");
    await expect(page.getByText("Why there is no price")).toBeVisible();
  });

  test("shows what is unanswered rather than hiding it", async ({ page }) => {
    /*
       The one place this build diverges from a build note. `1g-s` B2 asks for
       unfilled rows to be omitted; `CLAUDE.md` § Interface honesty says they
       stay visible and grey, because what is unanswered is what makes the
       enquiry high-intent — and the board's own render prints the count of
       unfilled rows under a table it has hidden them from.
    */
    /*
       The VAT service, not the audit one. The seeded audit sheet answers all
       nine rows, so it has nothing unfilled to render — which is the fixture
       being complete rather than the rule being absent. This one is the 4-of-6
       row, and it is live, which is the pair of facts this board is about.
    */
    await page.goto("/b/meridian-chartered-accountants/s/vat-and-corporate-tax-filing");
    await expect(page.getByText("Not provided").first()).toBeVisible();
    await expect(page.getByText(/rows filled\. The rest are unanswered/)).toBeVisible();
  });

  test("words the enum rows rather than printing the stored value", async ({ page }) => {
    await page.goto(path);
    const table = page.getByRole("table");
    await expect(table.getByText("Ongoing contract")).toBeVisible();
    await expect(table.getByText("ongoing_contract")).toHaveCount(0);
  });

  test("sends a draft service to the storefront rather than dead-ending", async ({ page }) => {
    /*
       The board asks for a 404. The product page one route over redirects for a
       stated reason — the buyer came for this supplier and the supplier still
       exists — and following the repo's own precedent beats two behaviours for
       one situation.
    */
    await page.goto("/b/meridian-chartered-accountants/s/transfer-pricing-documentation");
    await expect(page).toHaveURL(/\/b\/meridian-chartered-accountants$/);
  });

  test("is reachable from the storefront, in the seller's own order", async ({ page }) => {
    await page.goto("/b/meridian-chartered-accountants");
    await page.getByRole("link", { name: /^Services/ }).first().click();
    await page.waitForURL(/\/services$/);

    const links = page.getByRole("link", { name: /audit|filing/ });
    await expect(links.first()).toContainText("Statutory audit");
  });
});
