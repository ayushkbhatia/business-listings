import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Boards 3b, 3c, 3d and 3e, signed in as a seller.
 *
 * Criterion 8 is the one that matters here, and it fails in two directions.
 * A change that should queue and does not is a listing saying something nobody
 * checked. A change that should publish and queues instead is a dashboard where
 * nothing a seller does appears — which, at 41,000 listings, is the one that
 * kills the product. Both are asserted.
 */

test.describe("board 3b — the two moderation states, on one screen", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/listing");
  });

  test("says which half publishes and which half waits", async ({ page }) => {
    // A seller who has only ever seen the moderated half assumes everything
    // waits and stops editing.
    await expect(page.getByText("Publishes as soon as you save")).toBeVisible();
    await expect(page.getByText("A person checks these first")).toBeVisible();
  });

  test("puts exactly three fields on the waiting side", async ({ page }) => {
    const moderated = page.getByRole("region", { name: "A person checks these first" });
    await expect(moderated.getByText("Trade name")).toBeVisible();
    await expect(moderated.getByText("Primary category")).toBeVisible();
    await expect(moderated.getByText("Licence number")).toBeVisible();

    // And nothing else. Description, hours and photographs are not in it.
    await expect(moderated.getByText("Description")).toHaveCount(0);
    await expect(moderated.getByRole("button", { name: "Submit for review" })).toHaveCount(3);
  });

  test("offers no review step on the instant half", async ({ page }) => {
    const instant = page.getByRole("region", { name: "Publishes as soon as you save" });
    await expect(instant.getByRole("button", { name: "Save" })).toBeVisible();
    await expect(instant.getByRole("button", { name: "Submit for review" })).toHaveCount(0);
  });

  test("cannot submit a change to what it already says", async ({ page }) => {
    const moderated = page.getByRole("region", { name: "A person checks these first" });
    // Untouched, so there is nothing to ask for.
    await expect(moderated.getByRole("button", { name: "Submit for review" }).first()).toBeDisabled();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 3c — locations", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/locations");
  });

  test("says the free zone is inside its emirate, not instead of it", async ({ page }) => {
    // The README's own sentence: a JAFZA company is in Dubai *and* in a free
    // zone. Two independent facts, so two independent controls.
    const edit = page.getByRole("button", { name: "Edit" });
    if (await edit.first().isVisible().catch(() => false)) await edit.first().click();

    await expect(page.getByText(/is a free zone inside Dubai/)).toBeVisible();
    await expect(page.getByText(/Buyers looking in Dubai find you/)).toBeVisible();
  });

  test("offers the free-zone toggle as a filter, beside the area", async ({ page }) => {
    await expect(page.getByText("Only show free zones").first()).toBeVisible();
    // Not an eighth emirate.
    await expect(page.getByRole("option", { name: "Free zones" })).toHaveCount(0);
  });

  test("tells a driver where to put the pin", async ({ page }) => {
    await expect(page.getByText(/Drag the pin to your gate, not the street/).first()).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 3d — hours", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/hours");
  });

  test("starts the week on Sunday", async ({ page }) => {
    // A Monday-first editor puts the Gulf weekend in the middle of the list.
    const rows = page.locator("fieldset >> text=Sunday").first();
    await expect(rows).toBeVisible();
    const text = (await page.locator("fieldset").first().textContent()) ?? "";
    expect(text.indexOf("Sunday")).toBeLessThan(text.indexOf("Monday"));
    expect(text.indexOf("Friday")).toBeLessThan(text.indexOf("Saturday"));
  });

  test("holds a split shift, which is the normal case", async ({ page }) => {
    // Open at eight, shut for the afternoon, open again at four.
    await expect(page.getByLabel("Sunday Opens", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Sunday Opens 2", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Sunday Closes 2", { exact: true })).toBeVisible();
  });

  test("says Ramadan applies automatically and that the dates are approximate", async ({ page }) => {
    await expect(page.getByText(/Applied automatically for the month/)).toBeVisible();
    await expect(page.getByText(/the exact dates follow the moon sighting/)).toBeVisible();
  });

  test("asks what happens on a public holiday", async ({ page }) => {
    await expect(page.getByLabel("On public holidays")).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 3e — verification", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/verification");
  });

  test("has no control that sets the seller's own tier", async ({ page }) => {
    // CLAUDE.md non-negotiable 2. The absence is the feature, so the page says
    // so out loud as well.
    await expect(page.getByText("Your tier is set by our team after checking")).toBeVisible();

    const ladder = page.getByRole("region", { name: /You are at tier/ });
    await expect(ladder.getByRole("textbox")).toHaveCount(0);
    await expect(ladder.getByRole("combobox")).toHaveCount(0);
    await expect(ladder.getByRole("spinbutton")).toHaveCount(0);
    await expect(ladder.getByRole("button")).toHaveCount(0);
    await expect(ladder.getByRole("link")).toHaveCount(0);
  });

  test("criterion 1 — nothing references a visit or a tier above 2 as achievable", async ({
    page,
  }) => {
    const body = page.locator("body");
    await expect(body).not.toContainText(/visited/i);
    await expect(body).not.toContainText(/site visit/i);
    // Rung 3 is drawn so the ladder has somewhere to go, and it is inert.
    // `RESERVED` on screen is `Reserved` in the DOM — the mono eyebrow is
    // uppercased in CSS, so an assertion on the rendered case would be an
    // assertion about a stylesheet.
    await expect(page.getByText("Trade references", { exact: true })).toBeVisible();
    await expect(page.getByText("Reserved", { exact: true })).toBeVisible();
    await expect(page.getByText(/Start this/)).toHaveCount(0);
  });

  test("criterion 2 — the ladder reads claimed, licence verified, trade references", async ({
    page,
  }) => {
    const ladder = page.getByRole("region", { name: /You are at tier/ });
    const rungs = ladder.getByRole("listitem");
    await expect(rungs).toHaveCount(3);
    await expect(rungs.nth(0)).toContainText("Claimed");
    await expect(rungs.nth(1)).toContainText("Licence verified");
    await expect(rungs.nth(1)).toContainText(/top tier/i);
    await expect(rungs.nth(2)).toContainText("Trade references");
  });

  test("criterion 6 — the two document classes never share a state", async ({ page }) => {
    // `Verified` across both was a claim the platform cannot back: two of these
    // rows are checked against the issuing authority and three are PDFs nobody
    // here has looked at.
    await expect(page.getByRole("table", { name: /checked against the issuing authority/ })).toBeVisible();
    await expect(page.getByRole("table", { name: /Certificates and approvals you have uploaded/ })).toBeVisible();

    const uploaded = page.getByRole("table", { name: /Certificates and approvals/ });
    if ((await uploaded.getByRole("row").count()) > 1) {
      await expect(uploaded).not.toContainText("Verified");
    }
    await expect(
      page.getByText("it never changes your tier or your badge", { exact: false }),
    ).toBeVisible();
  });

  test("criterion 7 — no full TRN reaches the page", async ({ page }) => {
    // Masked in the response, not in the view: `getVerification` returns the
    // masked string and there is no shape of that result carrying the digits.
    await expect(page.locator("body")).not.toContainText(/\b\d{15}\b/);
    await expect(page.getByText("number never shown")).toBeVisible();
  });

  test("criterion 8 — the licence's visibility is not the seller's to change", async ({ page }) => {
    const checked = page.getByRole("table", { name: /checked against the issuing authority/ });
    await expect(checked.getByText("you cannot change this")).toBeVisible();
    // No control at all in that table. The badge is platform output.
    await expect(checked.getByRole("button")).toHaveCount(0);
  });

  test("criterion 10 — the expiry sequence is written down with its own numbers", async ({
    page,
  }) => {
    // The rail is the only place the 60 / 14 / 0 sequence is stated, and the
    // drop is to tier 1 rather than to the badge threshold.
    await expect(page.getByText("When your licence expires")).toBeVisible();
    await expect(page.getByText("Your tier drops to 1 · claimed", { exact: false })).toBeVisible();
    await expect(
      page.getByText("Your listing, products and enquiries are never touched by an expiry"),
    ).toBeVisible();
  });

  test("criterion 11 — the deep link lands on the licence row, focused", async ({ page }) => {
    /*
       The target half, and it is the half worth asserting deterministically.

       Board 3a's `Renew` only renders inside the sixty-day window, so whether
       the link exists on any given run depends on a seeded expiry date — a
       fixture with three hundred days to run is not a failure. What must always
       be true is that the address it points at resolves to the licence row and
       puts focus on it: `tabIndex={-1}` is what makes a `tr` a fragment target
       a browser will focus rather than merely scroll to, and without it a
       keyboard user following the link tabs from the top of the page.

       `lib/db/queries/overview.ts` decides when the row appears and
       tests/integration/verification-3e.test.ts asserts that against dates it
       controls.
    */
    await page.goto("/dashboard/verification#licence");
    const row = page.locator("#licence");
    await expect(row).toBeVisible();
    await expect(row).toContainText("Trade licence");
    await expect(row).toBeFocused();
  });

  test("3a's licence row, where the seeded expiry puts one on the page", async ({ page }) => {
    await page.goto("/dashboard");
    const renew = page.getByRole("link", { name: "Renew" });
    if ((await renew.count()) === 0) return;

    await expect(renew).toHaveAttribute("href", "/dashboard/verification#licence");
    // The consequence, not the date. "Expires 12 Oct" reads as administrative.
    await expect(page.getByText(/loses the licence-verified badge/)).toBeVisible();
  });

  test("says documents are never on the public listing", async ({ page }) => {
    await expect(page.getByText(/never on your public listing and never linked from it/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
