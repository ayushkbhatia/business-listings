import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { GUIDE_MIN_WORDS } from "@/lib/guides/blocks";

/**
 * Board 6f — the page matrix and content operations.
 *
 * The screen where somebody decides which of roughly eight thousand category ×
 * area pages exist. What is asserted here is the arithmetic being visible and
 * the vocabulary being honest: `have / need` in one column, five statuses that
 * route to different teams, a demand figure that renders an em dash rather than
 * a nought when nobody has recorded one, and two metric cards that say they are
 * not recorded rather than showing a plausible number.
 */

test.describe("board 6f — the page matrix", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/content/matrix");
  });

  test("shows the arithmetic rather than implying it", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Page matrix");

    const table = page.getByRole("table", { name: /Every area in this emirate/ });
    await expect(table).toBeVisible();
    // `have / need` in one column, so a reader can see which number is which.
    await expect(table.getByText(/^\d+ \/ \d+$/).first()).toBeVisible();
    // The seeded flagship pair.
    await expect(
      table.getByText("/dubai/al-quoz-industrial-1/hvac-and-ventilation"),
    ).toBeVisible();
  });

  test("says which figures it does not have, rather than showing one", async ({ page }) => {
    // Two of the five cards have no source in this product. A plausible number
    // would be the most quietly damaging thing on the screen.
    await expect(page.getByText("Not recorded").first()).toBeVisible();
    await expect(page.getByText(/No analytics or Search Console import/).first()).toBeVisible();
    // And a scope with no recorded volume renders an em dash, never a nought.
    const table = page.getByRole("table", { name: /Every area in this emirate/ });
    await expect(table.getByText("—").first()).toBeVisible();
  });

  test("separates the two states the board called Queued", async ({ page }) => {
    // Supply without copy and demand without supply route to different teams.
    const table = page.getByRole("table", { name: /Every area in this emirate/ });
    await expect(table.getByText(/Held · thin supply|Recruit ·|Queued · copy/).first()).toBeVisible();
  });

  test("states the top opportunity and defines the metric", async ({ page }) => {
    await expect(page.getByText(/Opportunity is monthly searches divided by/)).toBeVisible();
  });

  test("names the trade the rules panel edits", async ({ page }) => {
    // With no filter the panel opens on the first sector while the matrix shows
    // every trade, so the trade has to be in the sentence and not only in a
    // 9.5px eyebrow above it.
    await expect(page.getByText(/Six numbers that decide which .+ pages exist/)).toBeVisible();
    await expect(page.getByText(/A rule change takes two ops leads/).first()).toBeVisible();
  });

  test("carries all six queues with a count and a named owner", async ({ page }) => {
    const queues = page.getByRole("region", { name: /Editorial queues/ }).or(page.locator("section"));
    await expect(page.getByRole("heading", { name: "Editorial queues" })).toBeVisible();
    for (const label of [
      "Area pages awaiting copy",
      "Live pages under the word floor",
      "Curated lists due a re-audit",
      "Lists where the ranking left the prose",
      "Guides overdue a regulatory re-check",
      "Homepage slots emptied by a lost tier",
    ]) {
      await expect(queues.getByText(label).first()).toBeVisible();
    }
    await expect(page.getByText(/OWNER:/i).first()).toBeVisible();
  });

  test("counts words against this trade's own floor as staff type", async ({ page }) => {
    // The count is live, because a count that only appears after saving is a
    // count nobody uses.
    await page.getByRole("button", { name: /Write the intro for/ }).first().click();
    const field = page.getByRole("textbox", { name: "Intro" });
    await expect(field).toBeVisible();

    await field.fill("Three words only");
    await expect(page.getByText("3 words")).toBeVisible();
  });

  test("will not write anything without a reason", async ({ page }) => {
    /*
       Scoped to the editor this opened, not to the page.

       There are three intro editors and a rules panel on this screen, each with
       its own reason field and its own Save. Unscoped, `getByLabel("Why")`
       filled the rules panel's field while `getByRole("button", { name: "Save" })`
       watched a different table's button — so the test typed into one control
       and waited on another, and reported the product broken when what was
       broken was the locator.

       The editor is a named region: the row action reads "Write the intro for
       X" and the panel it opens is titled "X".
    */
    const trigger = page.getByRole("button", { name: /Write the intro for/ }).first();
    const scope = ((await trigger.textContent()) ?? "").replace(/^Write the intro for\s*/, "").trim();
    await trigger.click();

    const editor = page.getByRole("region", { name: scope });
    const save = editor.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeDisabled();
    await editor.getByLabel("Why").fill("Writing the intro for this scope.");
    await expect(save).toBeEnabled();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 6f — the category table below the matrix", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/content/matrix");
  });

  test("lists every category page with the address a visitor would type", async ({ page }) => {
    const table = page.getByRole("table", { name: /Every landing page/ });
    await expect(table).toBeVisible();
    await expect(table.getByText("/c/valves-and-fittings", { exact: true })).toBeVisible();
  });

  test("names which gate is holding a page back", async ({ page }) => {
    const table = page.getByRole("table", { name: /Every landing page/ });
    await expect(table.getByText("needs copy").first()).toBeVisible();
  });
});

test.describe("board 6f — the curated-list index a queue row opens", () => {
  test("lists every list with when it was audited and when it is due", async ({ page }) => {
    await page.goto("/admin/content/lists");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Curated lists");
    const table = page.getByRole("table", { name: /when it was last audited/ });
    await expect(table).toBeVisible();
    await expect(table.getByText(/Re-audit due|Published|Not published/).first()).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/admin/content/lists");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 12g — notification templates", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/notifications");
  });

  test("names the screen and counts what it lists", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Notifications");
    await expect(page.getByText(/\d+ templates · 4 channels/i)).toBeVisible();
    for (const tab of ["Templates", "Channels", "Delivery log", "Quiet hours"]) {
      await expect(page.getByRole("link", { name: tab, exact: true })).toBeVisible();
    }
  });

  test("reads no trade-kind language and not written differently, and names who sends each", async ({ page }) => {
    /*
     * B5: the seven that need nothing and the ones that need writing must not
     * share a state. And FIRED BY is a board id read from the code.
     */
    const table = page.getByRole("table", { name: /one row per event and channel/ });
    await expect(table.getByText("No trade-kind language").first()).toBeVisible();
    await expect(table.getByText("Not written").first()).toBeVisible();
    const expiring = table.getByRole("row").filter({ has: page.getByRole("link", { name: "Open document_expiring on Email" }) });
    await expect(expiring).toContainText("3e");
    await expect(expiring).toContainText("No trade-kind language");
  });

  test("checks a body as it is typed, with the same rules the save runs", async ({ page }) => {
    await page.getByRole("link", { name: "Open enquiry_received on In-app" }).click();
    await expect(page.getByRole("heading", { name: "enquiry_received on In-app" })).toBeVisible();

    // By role: "Body" as a label substring also names the "Which body" nav and the neutral-body checkbox.
    const body = page.getByRole("textbox", { name: /^Body/ });
    await body.fill("New enquiry {ref} worth {quotedValue}");
    await expect(page.getByText(/\{quotedValue\} — this event does not supply that/)).toBeVisible();
    await page.getByRole("textbox", { name: /^Why/ }).fill("Trying a placeholder the event does not supply.");
    await expect(page.getByRole("button", { name: /^Save as v\d+$/ })).toBeDisabled();

    // B3: a name that could only carry contact details is refused by name.
    await body.fill("Call the buyer on {buyerPhone}");
    await expect(page.getByText(/could only carry a buyer's contact details/)).toBeVisible();
  });

  test("WhatsApp goes to Meta rather than live, and says the live copy keeps sending", async ({ page }) => {
    await page.getByRole("link", { name: "Open enquiry_received on WhatsApp" }).click();
    await expect(page.getByText("WhatsApp goes through Meta")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Send v\d+ to Meta$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Save as v\d+$/ })).toHaveCount(0);
    await expect(page.getByText(/Email, SMS and in-app take effect on save/).first()).toBeVisible();
  });

  test("offers the services version where a goods body has none", async ({ page }) => {
    await page.getByRole("link", { name: "Open quote_received on In-app" }).click();
    await page.getByRole("link", { name: "Write the services version" }).click();
    await expect(page.getByRole("link", { name: "Services twin" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(/The goods body it replaces/)).toBeVisible();
  });

  test("writes a services twin live on save", async ({ page }) => {
    /*
     * Straight to the twin's URL rather than through the red panel: the panel
     * is gone once a twin exists, so a second local run would find no link to
     * click. A unique body means that run writes v2 rather than being refused
     * as unchanged.
     */
    await page.goto("/admin/notifications?t=quote_expiring.in_app&line=services");
    await page.getByRole("textbox", { name: /^Body/ }).fill(`Proposal {quoteRef} runs out {expiresAt}. Extend the terms or let it lapse. ${Date.now()}`);
    await page.getByRole("textbox", { name: /^Why/ }).fill("Service firms send proposals, not quotes.");
    await page.getByRole("button", { name: /^Save as v\d+$/ }).click();
    await expect(page.getByText(/Version \d+ is live/)).toBeVisible();
  });

  test("names who can turn a message off, and the two that ignore it", async ({ page }) => {
    await page.getByRole("link", { name: "Open document_expiring on Email" }).click();
    await expect(page.getByText("Who can turn this off")).toBeVisible();
    await expect(page.getByText(/ignores that choice on email and in-app/)).toBeVisible();
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 12g — the delivery log, channels and quiet hours", () => {
  test("lists deliveries without an address, and filters by status", async ({ page }) => {
    await page.goto("/admin/notifications/deliveries");
    const table = page.getByRole("table", { name: /Every delivery attempt/ });
    await expect(table).toBeVisible();
    await page.getByRole("link", { name: "Suppressed", exact: true }).click();
    await expect(page).toHaveURL(/status=skipped/);
    const body = (await page.textContent("main")) ?? "";
    expect(body).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]{2,}/);
    expect(body).not.toMatch(/(?:\+|00)971[\s-]?\d/);
  });

  test("names a carrier or its absence for all four channels", async ({ page }) => {
    await page.goto("/admin/notifications/channels");
    const table = page.getByRole("table", { name: /Each channel's carrier/ });
    for (const channel of ["WhatsApp", "Email", "SMS", "In-app"]) {
      await expect(table.getByRole("rowheader", { name: channel, exact: true })).toBeVisible();
    }
  });

  test("states the buyer default and the platform floor", async ({ page }) => {
    await page.goto("/admin/notifications/quiet-hours");
    await expect(page.getByText(/Licence expiry: always email and in-app/)).toBeVisible();
    await expect(page.getByRole("table", { name: /Where each buyer message goes/ })).toBeVisible();
  });

  test("is axe clean on the log", async ({ page }) => {
    await page.goto("/admin/notifications/deliveries");
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

test.describe("board 12g — redirects", () => {
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

  test("is axe clean", async ({ page }) => {
    await page.goto("/admin/content/redirects");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

/*
 * Board 6h — homepage curation.
 *
 * Serial, because the three writes below share the seed's slots and chips, and
 * each puts back what it changed: slot 4 is filled and emptied, slot 1 moved
 * and moved back, the last chip removed and added again. The seed leaves slot 4
 * empty for exactly this.
 */
test.describe("board 6h — homepage curation", () => {
  test.describe.configure({ mode: "serial" });

  const REASON = "Rotating the rail for this week's newly verified suppliers.";

  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/content/home");
  });

  test("shows the four slots, the nine rails and the chips, with the counts the rows hold", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Homepage curation");
    await expect(page.getByRole("heading", { name: "Verified this week" })).toBeVisible();

    const slots = page.getByRole("region", { name: "Verified this week" }).getByRole("listitem");
    await expect(slots).toHaveCount(4);
    // Tier 3 is gone from the ladder, so the eligibility line names Tier 2 as the top rung and nothing above it.
    await expect(page.getByText(/Only Tier 2 · Licence verified is eligible/)).toBeVisible();
    await expect(page.getByText(/Tier 3/)).toHaveCount(0);

    const rails = page.getByRole("table", { name: /home page's rails/ });
    await expect(rails.locator("tbody tr")).toHaveCount(9);
    await expect(rails.getByRole("cell", { name: "Curated here" })).toHaveCount(2);
    await expect(rails.getByRole("link", { name: "6c" })).toHaveAttribute("href", "/admin/categories");

    const chips = page.getByRole("complementary", { name: /Popular searches and what/ }).getByRole("listitem");
    const count = await chips.count();
    await expect(page.getByText(`${count} of 6`, { exact: true })).toBeVisible();
    await expect(page.getByText(/Nobody can pay to be here/i)).toBeVisible();
  });

  test("features a business in the empty slot and takes it off again, each with a reason", async ({ page }) => {
    await page.getByText("+ Add a business").click();
    let pick = page.locator("input[type=radio]:not([disabled])").first();
    if ((await pick.count()) === 0) {
      await page.getByLabel("Business name").fill("Al");
      await page.getByRole("button", { name: "Find" }).click();
      pick = page.locator("input[type=radio]:not([disabled])").first();
    }
    const name = (await page.locator(`label[for="${await pick.getAttribute("id")}"]`).innerText()).trim();
    await pick.check();

    const feature = page.getByRole("button", { name: "Feature in slot 4" });
    await expect(feature).toBeDisabled();
    await page.getByLabel(/Why this business/).fill(REASON);
    await feature.click();
    await expect(page.getByText("Featured in slot 4.", { exact: false })).toBeVisible();

    const slot = page.getByRole("listitem", { name: `Slot 4: ${name}` });
    await expect(slot).toBeVisible();
    await slot.getByRole("button", { name: `Remove ${name} from the home page` }).click();
    const remove = slot.getByRole("button", { name: "Remove from slot 4" });
    await expect(remove).toBeDisabled();
    await slot.getByLabel(/Why it comes off/).fill(REASON);
    await remove.click();
    await expect(page.getByText(/Removed\. Slot 4 is empty/)).toBeVisible();
    await expect(page.getByRole("listitem", { name: "Slot 4", exact: true })).toContainText("Empty.");
  });

  test("reorders from the keyboard and will not save without a reason, then puts it back", async ({ page }) => {
    const first = page.getByRole("listitem", { name: /^Slot 1: / });
    const label = (await first.getAttribute("aria-label"))!;
    const name = label.replace(/^Slot 1: /, "");

    await first.getByRole("button", { name: `Move ${name} down a slot` }).click();
    await expect(page.getByText("The order has changed and is not saved.")).toBeVisible();
    await expect(page.getByRole("listitem", { name: `Slot 2: ${name}` })).toBeVisible();

    const save = page.getByRole("button", { name: "Save order" });
    await expect(save).toBeDisabled();
    await page.getByLabel(/Why the new order/).fill(REASON);
    await save.click();
    await expect(page.getByText("Order saved.", { exact: false })).toBeVisible();

    await page.getByRole("listitem", { name: `Slot 2: ${name}` }).getByRole("button", { name: `Move ${name} up a slot` }).click();
    await page.getByLabel(/Why the new order/).fill("Putting the order back after checking it.");
    await page.getByRole("button", { name: "Save order" }).click();
    await expect(page.getByRole("listitem", { name: `Slot 1: ${name}` })).toBeVisible();
  });

  test("takes a chip off and types it back, and the home page links where the chip says", async ({ page }) => {
    const aside = page.getByRole("complementary", { name: /Popular searches and what/ });
    const last = aside.getByRole("listitem").last();
    const chipLabel = (await last.getByRole("link").innerText()).trim();
    const href = (await last.getByRole("link").getAttribute("href"))!;
    const before = await aside.getByRole("listitem").count();

    await last.getByRole("button", { name: `Remove ${chipLabel}`, exact: true }).click();
    await page.getByLabel(new RegExp(`Why ${chipLabel} comes off`)).fill(REASON);
    await page.getByRole("button", { name: "Remove chip", exact: true }).click();
    await expect(page.getByText("Chip removed.")).toBeVisible();
    await expect(aside.getByRole("link", { name: chipLabel, exact: true })).toHaveCount(0);

    await page.getByText("+ Add a search").click();
    await page.getByLabel(/Chip reads/).fill(chipLabel);
    await page.getByLabel(/^Runs/).fill(href);
    await expect(page.getByText(`Links to ${href}`)).toBeVisible();
    await page.getByLabel(/Why this search/).fill(REASON);
    await page.getByRole("button", { name: "Add chip" }).click();
    await expect(page.getByText("Chip added.", { exact: false })).toBeVisible();
    await expect(aside.getByRole("listitem")).toHaveCount(before);

    await page.goto("/");
    await expect(page.getByRole("link", { name: chipLabel, exact: true }).first()).toHaveAttribute("href", href);
  });

  test("is axe clean, with the search open", async ({ page }) => {
    await page.goto("/admin/content/home?find=Al");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 12c — ranking and boosts", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/search");
  });

  test("shows the six weights that decide the order", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ranking & boosts");
    for (const name of [
      "Relevance to the query",
      "Verification tier",
      "Measured reply time",
      "Spec completeness",
    ]) {
      await expect(page.getByRole("slider", { name, exact: true })).toBeVisible();
    }

    /*
       The two pinned ones carry their hint in the label, so the accessible name
       is the factor and the hint together. Asserted as written rather than as
       the factor alone: the separator between them is text, not margin, and
       that is the defect this catches if somebody puts it back.
    */
    await expect(page.getByRole("slider", { name: "Distance from the buyer · pinned" })).toBeVisible();
    await expect(
      page.getByRole("slider", { name: "Plan tier · pinned, ceiling 10" }),
    ).toBeVisible();
  });

  test("the six add to a hundred, and the panel says why", async ({ page }) => {
    await expect(page.getByText(/Six factors · live total 100/)).toBeVisible();
    await expect(page.getByText(/The six always add to 100/)).toBeVisible();
  });

  test("says why the plan weight has a ceiling", async ({ page }) => {
    /*
     * The one weight money buys is the one with a cap in the database. A
     * directory that sells its way to the top is one nobody comes back to.
     */
    await expect(page.getByText(/results start reading as bought/).first()).toBeVisible();
  });

  /**
   * `B9`. The ceiling is on the effective browse vector, and the board says so
   * before anybody presses anything — the live weights already take plan tier
   * from 6 to 9 on a page with no search box.
   */
  test("shows what the weights become on a page with no search box", async ({ page }) => {
    await expect(page.getByText(/Effective on browse pages/)).toBeVisible();
    await expect(page.getByText(/without anyone having moved the plan slider/)).toBeVisible();
  });

  test("will not save a draft without a reason", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Save draft" })).toBeDisabled();
    await page
      .getByLabel("Why", { exact: false })
      .first()
      .fill("Leaning harder on verification while the directory is young.");
    await expect(page.getByRole("button", { name: "Save draft" })).toBeEnabled();
  });

  /**
   * The three steps, in the state a board with no draft is actually in. Publish
   * is the control that reorders every result on the platform, so what it says
   * when it cannot be pressed is worth asserting.
   */
  test("publish is three steps, and says what is missing", async ({ page }) => {
    await expect(page.getByText("No draft", { exact: true })).toBeVisible();
    await expect(page.getByText(/Search is running on the live weights/)).toBeVisible();
    await expect(page.getByText("Publish needs a fresh preview.")).toBeVisible();
  });

  test("counts the searches that found nothing, and routes them to the CRM", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Searches that found nothing" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Work the gaps as a call list/ })).toHaveAttribute(
      "href",
      "/admin/crm",
    );
  });

  test("says a boost is not a sponsored slot", async ({ page }) => {
    await page.goto("/admin/search?tab=boosts");
    await expect(page.getByText(/never labelled sponsored/)).toBeVisible();
  });

  test("keeps expired boosts on the list, and says why", async ({ page }) => {
    await page.goto("/admin/search?tab=boosts");
    await expect(page.getByText(/record of why the results looked the way they did/)).toBeVisible();
  });

  /**
   * Board 12c Q7, on the screen. A boost is points added to a hundred-point
   * scale, not a percentage of it — the first render drew `+15%` and taught the
   * wrong model of the thing it was drawing.
   */
  test("boosts are points, with a budget a business can spend", async ({ page }) => {
    await page.goto("/admin/search?tab=boosts");
    await expect(page.getByText(/pts/).first()).toBeVisible();
    await expect(page.getByText(/A business can hold 25 points at once/)).toBeVisible();
    await expect(
      page.getByText(/Removing a business from results is a suspension, taken on Businesses/),
    ).toBeVisible();
  });

  test("the weight history is published changes only", async ({ page }) => {
    await page.goto("/admin/search?tab=history");
    await expect(page.getByRole("heading", { name: "Weight history" })).toBeVisible();
    await expect(
      page.getByText(/A draft that was never published is not here/),
    ).toBeVisible();
  });

  test("is axe clean on all three tabs", async ({ page }) => {
    for (const tab of ["", "?tab=boosts", "?tab=history"]) {
      await page.goto(`/admin/search${tab}`);
      const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      expect(results.violations, tab || "?tab=weights").toEqual([]);
    }
  });
});

/**
 * Board `12c-s` — the services vector, on the same board.
 *
 * Read-only on purpose. Publishing a vector reorders every services result the
 * other specs look at, and a draft left behind changes what the goods strip says
 * on the next run; the publish flow is proven against its own database in
 * `tests/integration/ranking-services.test.ts`. What only a browser shows is that
 * the toggle is one board rather than two, and what the services editor names.
 */
test.describe("board 12c-s — the services vector", () => {
  test("is a toggle on the same board, not a second screen", async ({ page }) => {
    await page.goto("/admin/search");
    const toggle = page.getByRole("link", { name: "Services vector", exact: true });
    await expect(toggle).toHaveAttribute("href", "/admin/search?vector=services");
    await toggle.click();

    await expect(page).toHaveURL(/vector=services/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ranking & boosts");
    await expect(page.getByRole("link", { name: "Goods vector", exact: true })).toHaveAttribute(
      "href",
      "/admin/search",
    );
    // The section tabs carry the vector with them.
    await expect(page.getByRole("link", { name: "Weight history" })).toHaveAttribute(
      "href",
      "/admin/search?tab=history&vector=services",
    );
  });

  test("names the two replaced factors for what they measure", async ({ page }) => {
    await page.goto("/admin/search?vector=services");
    await expect(
      page.getByRole("slider", { name: "Scope completeness · replaces spec completeness" }),
    ).toBeVisible();
    await expect(
      page.getByRole("slider", { name: "Coverage match · replaces distance, pinned" }),
    ).toBeVisible();
    await expect(page.getByRole("slider", { name: "Plan tier · pinned, ceiling 10" })).toBeVisible();
    // Neither goods measure is on the services editor.
    await expect(page.getByRole("slider", { name: "Spec completeness", exact: true })).toHaveCount(0);
    await expect(page.getByText(/Six factors · (proposed|draft|live) total 100/)).toBeVisible();
  });

  test("states the defect while it is true, with a count behind it", async ({ page }) => {
    await page.goto("/admin/search?vector=services");
    const state = page.getByText(/Services rank on a factor they cannot move|Services listings rank on this vector/);
    await expect(state).toBeVisible();
    await expect(page.getByText(/\d+ services listings?/).first()).toBeVisible();
  });

  test("says publishing one vector leaves the other alone", async ({ page }) => {
    await page.goto("/admin/search?vector=services");
    await expect(page.getByText(/Publishing one leaves the other's weights and history as they were/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Publishing this vector" })).toBeVisible();
  });

  test("keeps its own history", async ({ page }) => {
    await page.goto("/admin/search?tab=history&vector=services");
    await expect(page.getByRole("heading", { name: "Weight history" })).toBeVisible();
    await expect(
      page.getByText(/Nothing published on this vector yet|Scope \d+ · Coverage \d+/).first(),
    ).toBeVisible();
  });

  test("is axe clean on the weights and history tabs", async ({ page }) => {
    for (const path of ["/admin/search?vector=services", "/admin/search?tab=history&vector=services"]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      expect(results.violations, path).toEqual([]);
    }
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
    /*
       The number, not a tick — how much writing is left is the actionable part.

       Read from `GUIDE_MIN_WORDS` rather than written out. This assertion said
       `of 250 words` from the day it was written in August, and board 6d raised
       the floor to 1,200 — deliberately, with its own note: "250 words is the
       floor for a *paragraph* introducing a page", which is
       `DEFAULT_THRESHOLDS.minIntroWords` and was the wrong constant to borrow
       for an article. The product moved and the test did not, so it failed on
       main naming a number nothing uses.
    */
    await expect(
      table.getByText(new RegExp(`\\d+ of ${GUIDE_MIN_WORDS} words`)).first(),
    ).toBeVisible();
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

    /*
       Scoped to the rename panel. Board 4d-s put a second "How a trade is sold"
       panel on this screen whose own picker is also labelled "Trade", so an
       unscoped combobox now matches two — the same reason the Reason field
       below was already scoped.
    */
    const rename = page.getByRole("region", { name: "Move a trade's address" });
    await rename.getByRole("combobox", { name: "Trade" }).selectOption({ label: "HVAC & ventilation" });
    await page.getByLabel("New address", { exact: true }).fill("hvac-and-cooling");

    await expect(page.getByText(/\d+ addresses? move/)).toBeVisible();
  });

  test("will not rename or remove without a reason", async ({ page }) => {
    await page.goto("/admin/categories");
    /*
       Scoped to the rename panel. Board 4d-s put a second "How a trade is sold"
       panel on this screen whose own picker is also labelled "Trade", so an
       unscoped combobox now matches two — the same reason the Reason field
       below was already scoped.
    */
    const rename = page.getByRole("region", { name: "Move a trade's address" });
    await rename.getByRole("combobox", { name: "Trade" }).selectOption({ label: "HVAC & ventilation" });
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
    /*
       Scoped to the rename panel. Board 4d-s put a second "How a trade is sold"
       panel on this screen whose own picker is also labelled "Trade", so an
       unscoped combobox now matches two — the same reason the Reason field
       below was already scoped.
    */
    await page
      .getByRole("region", { name: "Move a trade's address" })
      .getByRole("combobox", { name: "Trade" })
      .selectOption({ label: "HVAC & ventilation" });
    /*
       Scoped to the region that owns the button this test then clicks. Every
       staff action on this screen writes its own audit reason, so "Reason"
       names a field in each of them — unscoped it matches two.
    */
    await page
      .getByRole("region", { name: "Move a trade's address" })
      .getByRole("textbox", { name: "Reason" })
      .fill("Checking what the refusal says.");
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
