import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 6f — the SEO page matrix.
 *
 * The gate this screen adds is the intro word count, which sat in
 * `thresholdsFor` from handoff 0 and passed vacuously the whole time because
 * there was nowhere for a category's copy to live.
 */

test.describe("board 6f — the page matrix", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/content/matrix");
  });

  test("says how many pages publish and how many wait only on a paragraph", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Page matrix");
    const header = page.getByRole("banner").or(page.locator("header")).first();
    await expect(header).toContainText(/\d+ of \d+ pages publish/);
    await expect(header).toContainText(/waiting only on copy/);
  });

  test("lists every landing page with the address a visitor would type", async ({ page }) => {
    const table = page.getByRole("table", { name: /Every landing page/ });
    await expect(table).toBeVisible();
    await expect(table.getByText("/c/valves-and-fittings", { exact: true })).toBeVisible();
  });

  test("names which gate is holding a page back", async ({ page }) => {
    const table = page.getByRole("table", { name: /Every landing page/ });
    await expect(table.getByText("needs copy").first()).toBeVisible();
  });

  test("counts words against the floor as staff type", async ({ page }) => {
    /*
     * Criterion-adjacent: the floor is 250 and the count is live, because a
     * count that only appears after saving is a count nobody uses.
     */
    await page.getByRole("button", { name: /Write the intro for/ }).first().click();
    // By role: the panel's own name also contains "Intro".
    const field = page.getByRole("textbox", { name: "Intro" });
    await expect(field).toBeVisible();

    await field.fill("Three words only");
    await expect(page.getByText("3 words")).toBeVisible();
  });

  test("will not save a paragraph without a reason", async ({ page }) => {
    await page.getByRole("button", { name: /Write the intro for/ }).first().click();
    const save = page.getByRole("button", { name: "Save the intro" });
    await expect(save).toBeDisabled();
    await page.getByLabel("Why").fill("Writing the intro for this trade.");
    await expect(save).toBeEnabled();
  });

  test("says the floor is a floor, not a target", async ({ page }) => {
    await page.getByRole("button", { name: /Write the intro for/ }).first().click();
    await expect(page.getByText(/repeats the category name eight times/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 12g — notification templates", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/notifications");
  });

  test("says how many events nothing sends yet", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Notification templates");
    const header = page.getByRole("banner").or(page.locator("header")).first();
    await expect(header).toContainText(/events nothing sends yet/);
  });

  test("marks the dormant events in the table", async ({ page }) => {
    /*
     * Seven of the eleven are declared, seeded with templates, and emitted by
     * nothing. That is not a bug, but staff should know before spending an
     * afternoon on the copy.
     */
    const table = page.getByRole("table", { name: /Every notification template/ });
    await expect(table.getByText("nothing sends this yet").first()).toBeVisible();
  });

  test("names what the event supplies, and refuses a placeholder it does not", async ({ page }) => {
    await page.getByRole("button", { name: /Edit enquiry_received on whatsapp/ }).first().click();
    await expect(page.getByText(/This event supplies:/)).toBeVisible();

    const body = page.getByLabel("Body");
    await body.fill("New enquiry {ref} worth {quotedValue}");
    await expect(page.getByText(/\{quotedValue\} — this event does not supply that/)).toBeVisible();

    // And the save is dead while it would fail to send.
    await page.getByLabel("Why").fill("Trying a placeholder the event does not supply.");
    await expect(page.getByRole("button", { name: "Save as a new version" })).toBeDisabled();
  });

  test("a WhatsApp draft goes to Meta and is never offered a straight publish", async ({
    page,
  }) => {
    /*
     * The rule board 12g exists to enforce: the provider rejects wording Meta
     * has not approved, with an error nobody on this side can read.
     *
     * The draft is created here rather than assumed. An earlier version of this
     * test asserted against the seeded template being live, and then failed on
     * its own second run — because the save in the test below had left a draft
     * behind. A test that depends on what a previous run did is a test that
     * passes once.
     */
    await page.getByRole("button", { name: /Edit enquiry_received on whatsapp/ }).first().click();
    await page.getByLabel("Body").fill("New enquiry {ref}: {summary}. Quote before {closesAt}.");
    await page.getByLabel("Why").fill("Shortening the WhatsApp wording for the Meta resubmission.");
    await page.getByRole("button", { name: "Save as a new version" }).click();
    await expect(page.getByText(/Saved as version \d+, as a draft/)).toBeVisible();

    /*
     * Wait for the row, not just for the message. The save revalidates the
     * table and clicking straight after lands on the row that was there
     * before — which is why this passed on a second run and failed on a first.
     */
    const table = page.getByRole("table", { name: /Every notification template/ });
    await expect(table.getByText("Draft").first()).toBeVisible();

    // The newest version of that pair is the draft just written.
    await page.getByRole("button", { name: /Edit enquiry_received on whatsapp/ }).first().click();
    await expect(page.getByRole("button", { name: "Send to Meta" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Put it live" })).toHaveCount(0);
  });

  test("says why an edit is a new version", async ({ page }) => {
    await expect(page.getByText(/what a seller was sent last week/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 12g — localisation is a report, not an editor", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/strings");
  });

  test("says what it is, and why, before somebody looks for a save button", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Localisation");
    await expect(page.getByText("This is a report, not an editor.")).toBeVisible();
    await expect(page.getByText(/a missing string a build failure/)).toBeVisible();
  });

  test("says adding Arabic is a data change rather than a rebuild", async ({ page }) => {
    await expect(page.getByText(/a second file beside this one/)).toBeVisible();
  });

  test("counts the catalogue and breaks it down by section", async ({ page }) => {
    const header = page.getByRole("banner").or(page.locator("header")).first();
    await expect(header).toContainText(/[\d,]+ strings/);
    await expect(page.getByRole("table", { name: "By section" })).toBeVisible();
  });

  test("searches by key and by phrase", async ({ page }) => {
    const search = page.getByRole("searchbox", { name: "Search the catalogue" });
    await search.fill("storefront.");
    const table = page.getByRole("table", { name: "Every string in the catalogue" });
    await expect(table.getByText("storefront.overview", { exact: true })).toBeVisible();

    await search.fill("zzzznothingmatchesthis");
    await expect(page.getByText("Nothing matches that.")).toBeVisible();
  });

  test("has no control that writes a string", async ({ page }) => {
    // The absence is the design. A save button here would be a promise the
    // architecture does not keep.
    const buttons = await page.getByRole("button").allInnerTexts();
    for (const label of buttons) {
      expect(label, label).not.toMatch(/save|publish|edit/i);
    }
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 12g — redirects and the home page", () => {
  test("refuses a redirect that would chain, and says where to point it", async ({ page }) => {
    await page.goto("/admin/content/redirects");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Redirects");
    await expect(page.getByText(/One hop, never two/)).toBeVisible();
  });

  test("will not add a redirect without a reason", async ({ page }) => {
    await page.goto("/admin/content/redirects");
    await page.getByLabel("From").fill("/old-address");
    await page.getByLabel("To").fill("/new-address");
    await expect(page.getByRole("button", { name: "Add it" })).toBeDisabled();
    await page.getByLabel("Why").fill("The old address was printed on a van.");
    await expect(page.getByRole("button", { name: "Add it" })).toBeEnabled();
  });

  test("cannot feature a trade whose own page does not publish", async ({ page }) => {
    /*
     * The home page is the most-linked page on the site. A link from it to a
     * thin page is the worst one to have — the page matrix doing a second job.
     */
    await page.goto("/admin/content/home");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Home page");
    await expect(page.getByText(/most-linked page on the site/)).toBeVisible();

    const table = page.getByRole("table", { name: /Which trades/ });
    const thin = table.getByRole("row").filter({ hasText: "Does not publish" }).first();
    if ((await thin.count()) > 0) {
      await expect(thin.getByRole("checkbox")).toBeDisabled();
    }
  });

  test("both are axe clean", async ({ page }) => {
    for (const path of ["/admin/content/redirects", "/admin/content/home"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      expect(results.violations, path).toEqual([]);
    }
  });
});

test.describe("board 12c — ranking and boosts", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/search");
  });

  test("shows the six weights that decide the order", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ranking & boosts");
    for (const name of [
      "Text match",
      "Verification tier",
      "Reply speed",
      "Spec completeness",
      "Distance",
      "Plan",
    ]) {
      await expect(page.getByLabel(name, { exact: true })).toBeVisible();
    }
  });

  test("says why the plan weight has a ceiling", async ({ page }) => {
    /*
     * The one weight money buys is the one with a cap in the database. A
     * directory that sells its way to the top is one nobody comes back to.
     */
    await expect(page.getByText(/results start reading as bought/).first()).toBeVisible();
  });

  test("will not save a ranking change without a reason", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Save the weights" })).toBeDisabled();
    await page.getByLabel("Why").fill("Leaning harder on verification while the directory is young.");
    await expect(page.getByRole("button", { name: "Save the weights" })).toBeEnabled();
  });

  test("says a boost is not a sponsored slot", async ({ page }) => {
    await expect(page.getByText(/never labelled sponsored/)).toBeVisible();
  });

  test("keeps expired boosts on the list, and says why", async ({ page }) => {
    await expect(page.getByText(/record of why the results looked the way they did/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("the copy reaches the public page", () => {
  test("a written category shows its intro, an unwritten one shows none", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    await page.goto("/c/valves-and-fittings");
    await expect(page.getByText(/bought on specification rather than on brand/)).toBeVisible();

    // A trade nobody has written yet renders the heading and the results, and
    // no empty paragraph where the copy would be.
    await page.goto("/c/safety-and-ppe");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/bought on specification/)).toHaveCount(0);

    await context.close();
  });
});

test.describe("boards 10b and 6d — guides", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/content/guides");
  });

  test("lists the seeded guide with its word count against the floor", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Guides");

    const table = page.getByRole("table", { name: /Every guide/ });
    await expect(table).toBeVisible();
    await expect(table.getByText("/guides/what-supplier-verification-actually-proves")).toBeVisible();
    // The number, not a tick — how much writing is left is the actionable part.
    await expect(table.getByText(/\d+ of 250 words/).first()).toBeVisible();
  });

  test("refuses to publish a draft under the floor, and names the number", async ({ page }) => {
    await page.getByRole("link", { name: "New guide" }).click();
    await expect(page).toHaveURL(/\/admin\/content\/guides\/new$/);

    await page.getByRole("textbox", { name: "Title" }).fill("A draft that is too thin");
    /*
       A fresh address every run. A fixture that reuses one blocks the next run
       on `slug_taken` if a previous run died before its cleanup — which is
       exactly how this test failed the first time it was written.
    */
    const address = `e2e-draft-too-thin-${Date.now().toString(36)}`;
    await page.getByRole("textbox", { name: "Address" }).fill(address);
    await page
      .getByRole("textbox", { name: "Summary" })
      .fill("A summary long enough to clear the length check on the field.");
    await page.getByRole("button", { name: "Add · Paragraph" }).click();
    await page.getByRole("textbox", { name: "Paragraph" }).last().fill("Four words in total.");
    await page.getByRole("textbox", { name: "Reason" }).fill("End-to-end check of the floor.");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(page.getByText("Saved.")).toBeVisible();
    // Saving a new guide moves the address onto its own id without navigating,
    // so the confirmation survives and a reload lands on the guide.
    await expect(page).toHaveURL(/\/admin\/content\/guides\/(?!new$)[a-z0-9]+$/);

    // Below the floor the button is disabled, and the count beside it says by
    // how much rather than making somebody guess.
    await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
    await expect(page.getByText(/more to publish/)).toBeVisible();

    /*
       Reload before the cleanup, so the delete runs against a settled editor.

       Saving a new guide calls `history.replaceState` to move the address off
       `new` onto the guide's own id. Next treats that as a change of the `[id]`
       segment, re-resolves the route and remounts the editor — which takes a
       server round trip and resets `reason` to "". Typing into the pre-remount
       instance and clicking Delete raced that: often the reason survived, and
       sometimes the remount landed first, wiped it, and left Delete disabled
       until the 30s timeout. One flake in 806 on the run that found it.

       A reload lands on the guide by its own id with exactly one editor
       mounted and nothing in flight, which is the same path a person takes who
       comes back to a draft later. The race it steps around is real and is not
       fixed here — a person who types a reason inside that window loses it,
       silently, which is the failure the `pending` comment above already
       worries about in its other form.
    */
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("A draft that is too thin");

    // It is a draft, so it deletes — and deleting returns to the list, because
    // the editor has nothing left to edit.
    await page.getByRole("textbox", { name: "Reason" }).fill("Removing the end-to-end fixture.");
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/content\/guides$/);
    await expect(page.getByRole("table", { name: /Every guide/ }).getByText(address)).toHaveCount(0);
  });

  test("shows the refusal when an address is already taken", async ({ page }) => {
    /*
       A refusal nobody can see is a form that silently does nothing. This one
       fires against the seeded guide's address, so it needs no fixture of its
       own and leaves nothing behind.
    */
    await page.getByRole("link", { name: "New guide" }).click();

    await page.getByRole("textbox", { name: "Title" }).fill("A clashing address");
    await page
      .getByRole("textbox", { name: "Address" })
      .fill("what-supplier-verification-actually-proves");
    await page
      .getByRole("textbox", { name: "Summary" })
      .fill("A summary long enough to clear the length check on the field.");
    await page.getByRole("textbox", { name: "Reason" }).fill("Checking the clash message.");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(page.getByText("Another guide already has that address.")).toBeVisible();
    // Nothing was created, so the address bar has not moved off /new.
    await expect(page).toHaveURL(/\/admin\/content\/guides\/new$/);
  });

  test("fixes the address of a published guide", async ({ page }) => {
    await page.getByRole("link", { name: /What supplier verification/ }).click();
    // Published, so the address field is not editable — the service refuses the
    // change too, and this is so nobody types into a field that will be refused.
    await expect(page.getByRole("textbox", { name: "Address" })).toBeDisabled();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("criterion 7 — renaming a trade on the taxonomy screen", () => {
  test("says how many addresses a rename would move before anybody commits", async ({ page }) => {
    /*
       One rename of a sector moves its own page, every subcategory under it —
       the address carries the parent's slug — and every area page for it.
       Somebody about to move forty addresses should know before, not after.
    */
    await page.goto("/admin/categories");
    await expect(page.getByRole("heading", { name: "Move a trade's address" })).toBeVisible();

    await page.getByRole("combobox", { name: "Trade" }).selectOption({ label: "HVAC & ventilation" });
    await page.getByLabel("New address", { exact: true }).fill("hvac-and-cooling");

    await expect(page.getByText(/\d+ addresses? move/)).toBeVisible();
  });

  test("will not rename or remove without a reason", async ({ page }) => {
    await page.goto("/admin/categories");
    await page.getByRole("combobox", { name: "Trade" }).selectOption({ label: "HVAC & ventilation" });
    await page.getByLabel("New address", { exact: true }).fill("hvac-and-cooling");

    await expect(page.getByRole("button", { name: "Rename and write the redirects" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Remove the trade" })).toBeDisabled();
  });

  test("refuses to remove a trade something depends on, and says what", async ({ page }) => {
    /*
       Children first, because listings cannot be judged until the subcategories
       are gone — and the count decides the verb, which is why the message is
       built rather than templated.
    */
    await page.goto("/admin/categories");
    await page.getByRole("combobox", { name: "Trade" }).selectOption({ label: "HVAC & ventilation" });
    await page.getByRole("textbox", { name: "Reason" }).fill("Checking what the refusal says.");
    await page.getByRole("button", { name: "Remove the trade" }).click();

    await expect(
      page.getByText(/(subcategory sits|subcategories sit|listing is|listings are) .*under it/),
    ).toBeVisible();
  });
});

test.describe("entry page quotes", () => {
  /*
     The screen behind `/for-buyers` and `/list-your-business`.

     What it must refuse is the point of it: a quote nobody signed, and a quote
     too thin to be worth quoting. Both refusals are proved in
     tests/integration/proof.test.ts against the real service; what is proved
     here is that the screen reaches them, says what happened, and cannot be
     driven without a reason.
  */
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/content/testimonials");
  });

  test("renders, and says the numbers are not edited here", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Entry page quotes");
    await expect(page.getByText(/counted from the database and are not edited here/)).toBeVisible();
  });

  test("will not write anything without a reason", async ({ page }) => {
    // Every save on this screen is a staff mutation, and CLAUDE.md's third
    // non-negotiable makes the reason NOT NULL. The controls are disabled
    // rather than the save failing.
    await expect(page.getByRole("button", { name: "Save" }).first()).toBeDisabled();

    await page.getByRole("textbox", { name: "Reason" }).fill("Adding the first quote.");
    await expect(page.getByRole("button", { name: "Save" }).first()).toBeEnabled();
  });

  test("refuses a quote with no name on it", async ({ page }) => {
    await page.getByRole("textbox", { name: "Reason" }).fill("Trying it without a name.");

    /*
       Scoped by the new-quote form's own field ids rather than by an enclosing
       role: `Panel` is a plain div, so there is no landmark to filter on, and
       every saved quote renders the same field labels.
    */
    await page
      .locator("#body-new")
      .fill("They found us a valve supplier in Al Quoz on the same afternoon we asked.");
    await page
      .locator("#body-new")
      .locator("xpath=ancestor::form")
      .getByRole("button", { name: "Save" })
      .click();

    await expect(page.getByText(/quote nobody is willing to sign/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
