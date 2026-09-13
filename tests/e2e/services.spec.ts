import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Boards `3g-s`, `3f-s`, `1g-s`, `8a-s`, `8b-s`, `8c-s`, `3h-s` — the seat that
 * sells work.
 *
 * This spec has its own project and its own seat because every other seller
 * fixture on this platform sells goods: `sells_kind` is `unset` on all 123 live
 * businesses, which means goods, so the services screens could only ever be
 * exercised in their empty state. `seedServicesFirm` builds the firm this signs
 * in as — three services, one of them deliberately live at 4 of 6, one
 * credential of the two its largest task asks for, the audit scope sheet already
 * chosen so `8c-s` step 2 is reachable, and one scope template attached to two
 * of the three services with a change waiting on each.
 *
 * ## One file, and serial, because it is one business
 *
 * `8b-s`'s tests began in a file of their own and could not stay there. The
 * suite is `fullyParallel`, so two files run at once outside CI — and while the
 * credentials tests held two credentials, the hub two files away moved the
 * credentials card into its done-summary and the card's own test failed looking
 * for a link that was correctly no longer drawn. Nothing was wrong with either
 * assertion; they were reading one listing through two windows.
 *
 * Playwright serialises within a file and not across them, so everything that
 * drives this seat lives here. CI has run this shard on one worker since #62,
 * which is why the race was invisible there — a green CI over a red local run
 * being the worst of the two outcomes.
 */
test.describe.configure({ mode: "serial" });

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

test.describe("board 3c-s — where one service is available", () => {
  const editorPath = "/dashboard/services";
  const publicPath = "/b/meridian-chartered-accountants/s/statutory-audit";

  /*
     The card and the chips. `exact` on every chip name, because a role name
     matches as a substring and "Dubai" is also inside the sentence under the
     chips and inside the firm's own coverage line — the trap this suite has
     hit four times.
  */
  const openEditor = async (page: import("@playwright/test").Page) => {
    await page.goto(editorPath);
    await page.getByRole("link", { name: "Statutory audit" }).click();
    await page.waitForURL(/\/dashboard\/services\/[a-z0-9]+/);
    return page.getByRole("group", { name: "Where this service is available" });
  };

  test("starts inherited, with the firm's coverage written out beside it", async ({ page }) => {
    const group = await openEditor(page);

    // The seed firm covers Dubai, Sharjah and Abu Dhabi, and this service has
    // no rows of its own — so it is shown all three and nothing is ticked.
    await expect(
      page.getByText("Buyers see this service in Dubai, Sharjah, Abu Dhabi, the same as the firm."),
    ).toBeVisible();
    await expect(page.getByText("Where the firm works")).toBeVisible();

    for (const chip of ["Dubai", "Sharjah", "Abu Dhabi"]) {
      await expect(group.getByRole("button", { name: chip, exact: true })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }

    // Nothing to reset while nothing is narrowed.
    await expect(page.getByRole("button", { name: "Use our coverage" })).toBeDisabled();
  });

  test("one tick narrows the service, and the buyer sees the narrowing", async ({ page }) => {
    const group = await openEditor(page);
    const dubai = group.getByRole("button", { name: "Dubai", exact: true });

    await dubai.click();
    await expect(dubai).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByText("Narrowed to 1 area: Dubai. Buyers see this service there and nowhere else."),
    ).toBeVisible();

    /*
       The firm's own line is unchanged, which is B6: narrowing one service is
       not an edit of the listing. It is read below the chips, where the card
       writes the default out in full.
    */
    await expect(page.getByText("Dubai, Sharjah, Abu Dhabi")).toBeVisible();

    // And the public page follows — this is the only reason the column exists.
    await page.goto(publicPath);
    const coverage = page.getByRole("region", {
      name: "Where this service is available",
    });
    await expect(coverage.getByText("Dubai", { exact: true })).toBeVisible();
    await expect(coverage.getByText("Sharjah", { exact: true })).toHaveCount(0);

    // Put the fixture back — the next test, and the next run, read the seed.
    const back = await openEditor(page);
    await back.getByRole("button", { name: "Dubai", exact: true }).click();
    await expect(
      page.getByText("Buyers see this service in Dubai, Sharjah, Abu Dhabi, the same as the firm."),
    ).toBeVisible();
  });

  test("`Use our coverage` puts a narrowed service back to inheriting", async ({ page }) => {
    const group = await openEditor(page);
    await group.getByRole("button", { name: "Sharjah", exact: true }).click();
    await expect(page.getByText(/Narrowed to 1 area: Sharjah/)).toBeVisible();

    await page.getByRole("button", { name: "Use our coverage" }).click();
    await expect(
      page.getByText("Buyers see this service in Dubai, Sharjah, Abu Dhabi, the same as the firm."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Use our coverage" })).toBeDisabled();
    await expect(group.getByRole("button", { name: "Sharjah", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  test("the card passes axe where it sits", async ({ page }) => {
    await openEditor(page);
    const result = await new AxeBuilder({ page }).include("main").analyze();
    expect(result.violations).toEqual([]);
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

test.describe("board 8a-s — the setup hub", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/setup");
  });

  test("offers four tasks, credentials first and photographs last", async ({ page }) => {
    /*
       Four where goods has three, in weight order. The inversion is the board:
       a warehouse photograph is evidence for a parts supplier and decoration
       for an audit practice, so credentials lead at 32 and photographs fall
       to 4.
    */
    /*
       Open cards plus the collapsed done row. A finished task is never removed
       — sellers look for evidence that the work they did was recorded — so the
       four live in two places and the count has to read both.
    */
    const open = await page.getByRole("listitem").getByRole("heading", { level: 3 }).allInnerTexts();

    /*
       `allInnerTexts`, never `innerText`.

       The done row exists only once a task is finished, and `innerText()` on a
       locator that matches nothing waits for it to appear — with no action
       timeout set, that is until the test's own 30 seconds run out, and the
       `.catch()` after it never gets a turn. It passed locally against a
       fixture that happened to have a finished task and timed out three times
       in CI against one that did not. `allInnerTexts` returns `[]` at once.
    */
    const done = (await page.getByText(/^Done: /).allInnerTexts()).flatMap((row) =>
      row.replace(/^Done: /, "").split(", "),
    );

    expect(open[0]).toContain("credentials");
    expect(open.at(-1)).toMatch(/photographs/i);

    const all = [...open, ...done.filter(Boolean)];
    expect(all).toHaveLength(4);
    // And no product card anywhere: a practice has no catalogue.
    expect(all.some((title) => /spec template/i.test(title))).toBe(false);
  });

  test("sends both new cards to their own task screens", async ({ page }) => {
    /*
       `/dashboard/setup/credentials`, board `8b-s`, since that shipped.

       It pointed at `/dashboard/verification` — board 3e — while `8b-s` was
       unbuilt, because a dead card was the worse of the two and 3e is the
       nearest thing: it splits what the platform checked from what the seller
       uploaded. The two stay distinct. 3e is documents and their public
       visibility; this is typed credentials with a tier assigned from the kind.
    */
    const credentials = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: /Add your credentials/ }) });
    await expect(credentials.getByRole("link")).toHaveAttribute(
      "href",
      "/dashboard/setup/credentials",
    );

    /*
       And services points at `/dashboard/setup/services`, board `8c-s`, since
       that shipped. It pointed at `/dashboard/services` — `3f-s` — while `8c-s`
       was unbuilt, which was the nearest thing and the wrong shape: that screen
       manages a catalogue a firm already has, and this task asks a firm with
       none to pick a scope sheet and type its first three.
    */
    const services = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: /Publish your first three services/ }) });
    await expect(services.getByRole("link")).toHaveAttribute(
      "href",
      "/dashboard/setup/services",
    );
  });

  test("shows what a partly done task still pays, and its progress beside it", async ({
    page,
  }) => {
    /*
       The seeded practice has two of three services live. The badge is what
       this seller would still gain — 7 of the 20 — and the progress line is
       where "2 of 3" lives. Board `8a-s` B3 asks for the full weight on the
       badge; the shipped behaviour is kept and the reason is written twice in
       the repository already: showing the weight tells a seller who has done
       half of something that they can earn it all again.
    */
    const card = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: /Publish your first three services/ }) });
    await expect(card.getByText("+7%")).toBeVisible();
    await expect(card.getByText(/2 OF 3/i)).toBeVisible();
  });

  test("publishes the weighting rather than making sellers ask for it", async ({ page }) => {
    await expect(page.getByText("Weighted for a practice")).toBeVisible();
    /*
       Sixteen of thirty-two, because `8b-s` gives the fixture one credential of
       the two the lever asks for. Every row is this seller's own arithmetic
       rather than the component's weight — a constant would read zero over a
       firm that had done half the task — and this is the row that says so.
    */
    await expect(page.getByText(/Credentials on file/)).toBeVisible();
    await expect(page.getByText(/16 of 32 points/)).toBeVisible();
    // Every number in the closing line is this seller's own, not a constant.
    await expect(page.getByText(/the inversion is the whole point/)).toBeVisible();
  });

  test("names the licence as a lever and never as a task — the one staff own", async ({
    page,
  }) => {
    /*
       `verificationTier` is writable only by an `ops_lead`, so the licence can
       never be a card: a task the seller cannot finish is what made this hub
       uncompletable before the site visit was withdrawn. Everything they *can*
       do sums to exactly the threshold.
    */
    await expect(page.getByText(/Trade licence checked against the issuing authority/)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /licence/i, level: 3 }),
    ).toHaveCount(0);
  });

  test("offers no catalogue concierge — criterion 9", async ({ page }) => {
    // `8a`'s offer is somebody keying a spreadsheet of products in for you, and
    // there is no services equivalent: six scope sheets typed by hand is the
    // fast path, which is why `3f-s` suppresses the importer on the same ground.
    await expect(page.getByText("Send us your catalogue")).toHaveCount(0);
  });
});

const CREDENTIALS = "/dashboard/setup/credentials";

/** The submit. "Add" is also the suggestion rows' verb, so scope it. */
const submit = (page: import("@playwright/test").Page) =>
  page.locator("form").getByRole("button", { name: "Add", exact: true });

/**
 * Board `8b-s` — setup task 1 for a firm that sells work.
 *
 * The fixture holds exactly one credential: professional indemnity, a claim.
 * One rather than two is the useful state — it leaves the task at 1 of 2, so
 * these tests can add the second and watch it tick, and it leaves a claim on
 * screen so the tier labelling has something to be wrong about.
 *
 * Every test that writes removes what it wrote. The seed is shared with every
 * other shard, and a spec that consumes a fixture row is a defect this
 * repository has paid for more than once.
 */
test.describe("board 8b-s — credentials", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(CREDENTIALS);
  });

  test("the sidebar table is `8a-s`'s — 32 / 20 / 8 / 4, totalling 64 — criterion 7", async ({
    page,
  }) => {
    const rail = page.getByRole("region", { name: "The four tasks" });
    await expect(rail).toContainText("64 pts");

    /*
       Every one of these is looked up from the weight table rather than typed
       into this screen, so the assertion is that the two screens agree — which
       is the whole of B8. If a weight moves and only one screen moves with it,
       this fails.
    */
    for (const [task, points] of [
      ["Credentials & accreditations", "32 pts"],
      ["Scope sheet + 3 services", "20 pts"],
      ["Invite your team", "8 pts"],
      ["Office, team & certificates", "4 pts"],
    ]) {
      const row = rail.getByRole("listitem").filter({ hasText: task! });
      await expect(row).toContainText(points!);
    }
  });

  test("the trade licence is read-only and is never asked for again — criterion 4", async ({
    page,
  }) => {
    const onFile = page.getByRole("region", { name: "ALREADY ON FILE" });
    await expect(onFile).toContainText("DED-884112");
    await expect(onFile).toContainText("verified against the issuing authority");

    // No control inside it at all: no edit, no re-upload, no remove.
    await expect(onFile.getByRole("button")).toHaveCount(0);
    await expect(onFile.getByRole("textbox")).toHaveCount(0);

    // And it is not offered as something to add, because it is not a credential
    // row — it lives on the business.
    const kinds = page.getByRole("combobox", { name: "What is it" });
    await expect(kinds.getByRole("option", { name: /trade licence/i })).toHaveCount(0);
  });

  test("the seller cannot choose a tier, and nothing offers one — criterion 3", async ({
    page,
  }) => {
    for (const word of ["Verified", "Tier", "Trust level"]) {
      await expect(page.getByRole("combobox", { name: word })).toHaveCount(0);
    }

    /*
       And the seeded claim wears the claim's words. The register badge is
       reserved for a row a register answered for, and no register has: the
       only "verified" sentence on this page belongs to the trade licence,
       which is not a credential row and is not the seller's to set either.
    */
    const claim = page.getByRole("listitem").filter({ hasText: "Professional indemnity" });
    await expect(claim).toContainText("Your own claim");
    await expect(claim.getByText("VERIFIED AGAINST THE ISSUING AUTHORITY")).toHaveCount(0);
  });

  test("there is no reminder, tracking or renewal surface — criterion 5", async ({ page }) => {
    // The commitment, in both places the screen makes it.
    await expect(
      page.getByText("We do not remind you and nothing changes when it passes"),
    ).toBeVisible();
    await expect(page.getByText("We do not hold a compliance record on you")).toBeVisible();

    /*
       Controls rather than words: the page says "we do not chase renewals", so
       an assertion on the *word* renewal would fail on the sentence that makes
       the promise. What must not exist is something to press — `3e-s` was the
       expiry tracker and it was cut, and this is the shape it would come back in.
    */
    for (const gone of [/renew/i, /remind me/i, /track/i]) {
      await expect(page.getByRole("button", { name: gone })).toHaveCount(0);
      await expect(page.getByRole("link", { name: gone })).toHaveCount(0);
      await expect(page.getByRole("switch", { name: gone })).toHaveCount(0);
    }
    // And the expiry field is optional, which is the rule underneath all of it.
    const expires = page.getByRole("textbox", { name: "Expires" });
    await expect(expires).not.toHaveAttribute("required", /.*/);
  });

  test("saves with every field but the kind left blank — criterion 1", async ({ page }) => {
    // Enabled before anything is typed, and it stays that way.
    await expect(submit(page)).toBeEnabled();

    await page.getByRole("combobox", { name: "What is it" }).selectOption("other");
    await expect(submit(page)).toBeEnabled();
    await submit(page).click();

    const row = page.getByRole("listitem").filter({ hasText: "Something else" });
    await expect(row).toBeVisible();
    // Nothing hidden because it is empty. The seller sees the thinness a buyer
    // would — `CLAUDE.md` § Interface honesty.
    await expect(row).toContainText("Not provided");

    await row.getByRole("button", { name: /^Remove/ }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "Something else" })).toHaveCount(0);
  });

  test("an FTA number saves as a claim and says so inline — criteria 2 and 10", async ({
    page,
  }) => {
    /*
       The fixture holds one, and this test is written on that. A local database
       that has drifted fails here with the reason in the message rather than
       four assertions later with an arithmetic that looks wrong.
    */
    await expect(page.getByText("1 added, 16 points earned")).toBeVisible();

    await page.getByRole("combobox", { name: "What is it" }).selectOption("fta_tax_agent");
    await page.getByRole("textbox", { name: "Number" }).fill("20034512");
    await submit(page).click();

    /*
       No register is configured, so the honest answer is that nobody has
       checked it. The row is saved either way — Q2's position, and the reason
       is stronger with no register than with one: a hard block on a call that
       cannot be made is a screen nobody can finish.
    */
    await expect(page.getByText("Saved as your own claim")).toBeVisible();

    const row = page.getByRole("listitem").filter({ hasText: "FTA tax agent number" });
    await expect(row).toContainText("Your own claim");
    await expect(row).toContainText("20034512");
    await expect(row.getByText("VERIFIED AGAINST THE ISSUING AUTHORITY")).toHaveCount(0);

    // Two held, so the task closes and the chrome says so rather than "Save".
    await expect(page.getByRole("link", { name: "Done — back to setup" })).toBeVisible();
    await expect(page.getByText("2 added, 32 points earned")).toBeVisible();

    await row.getByRole("button", { name: /^Remove/ }).click();
    await expect(page.getByText("1 added, 16 points earned")).toBeVisible();
  });

  test("skipping costs the points and not the listing — criterion 8", async ({ page }) => {
    await page.getByRole("link", { name: "Skip for now" }).click();
    await expect(page).toHaveURL(/\/dashboard\/setup$/);

    // The card is still open on the hub. Skip is not dismissal — B9.
    await expect(page.getByText("Add your credentials")).toBeVisible();
  });

  test("has no axe violations", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});


const SETUP_SERVICES = "/dashboard/setup/services";

/**
 * Board `8c-s` — setup task 2, and the screen that started the service track.
 *
 * The fixture arrives with its sheet chosen and three services: 6 of 6 live,
 * 4 of 6 live, 2 of 6 draft. So two count, one more would finish the task, and
 * the thin-service state is one publish away — which is what the counting test
 * does and undoes.
 */
test.describe("board 8c-s — the scope sheet and the first services", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(SETUP_SERVICES);
  });

  test("counts the sheets rather than claiming a number", async ({ page }) => {
    /*
       The board writes "Seven trades are authored so far" and `4e-s`'s tracker
       note says five families. This tree holds three, one of which is the blank
       sheet — so the sentence counts the cards. `CLAUDE.md`: every number is a
       query, and if a sentence states a count, count the elements.
    */
    const cards = page.getByRole("listitem").filter({ hasText: /required · \d+ filterable|generic row set/ });
    const drawn = await cards.count();
    await expect(page.getByText(`${drawn} trades are authored so far`)).toBeVisible();
  });

  test("states each sheet's shape from its own rows — criterion 2", async ({ page }) => {
    const audit = page.getByRole("listitem").filter({ hasText: "Professional services" });
    await expect(audit).toContainText("9 rows · 6 required · 5 filterable");
    // A live count, and zero is rendered as zero rather than hidden.
    await expect(audit).toContainText(/used by \d+ firm/);
    await expect(
      page.getByRole("listitem").filter({ hasText: "On-site maintenance" }),
    ).toContainText("no firms on it yet");
  });

  test("badges the sheet the seller's own services match — criterion 2", async ({ page }) => {
    const audit = page.getByRole("listitem").filter({ hasText: "Professional services" });
    await expect(audit).toContainText("MATCHES YOUR SERVICES");
    await expect(
      page.getByRole("listitem").filter({ hasText: "On-site maintenance" }),
    ).not.toContainText("MATCHES");
  });

  test("collects no fee amount anywhere on the screen — criterion 7", async ({ page }) => {
    // Fee *basis* is a column; the amount lives on `3g-s` and is private.
    await expect(page.getByRole("columnheader", { name: "Fee basis" })).toBeVisible();
    for (const banned of [/AED/, /indicative fee/i, /price/i]) {
      await expect(page.getByText(banned)).toHaveCount(0);
    }
    await expect(page.getByText("Fee on enquiry")).toBeVisible();
  });

  test("carries no availability column, waitlist card or chip — criterion 10", async ({
    page,
  }) => {
    /*
       D11 closed as **no** on 11 Sep, before this board was handed over. The
       `TAKING WORK` column, the *Waitlist is a real answer* card, the `1g-s`
       chip and `3g-s`'s `Capacity` field went at once, so there is nothing here
       to leave out — the criterion is satisfied by construction and this is the
       test that keeps it that way.
    */
    await expect(page.getByRole("columnheader", { name: /taking work/i })).toHaveCount(0);
    for (const gone of [/waitlist/i, /accepting new clients/i, /at capacity/i]) {
      await expect(page.getByText(gone)).toHaveCount(0);
    }
  });

  test("previews through the real service page, not a mock — criterion 9", async ({ page }) => {
    const preview = page.getByText("This is the real page, not a mock-up.");
    await expect(preview).toBeVisible();

    /*
       The same rows, in the same order, as the public page renders — one
       component and one loader. If the two drift the preview lies at the worst
       possible moment, which is B11's whole reason for existing.
    */
    const rows = await page
      .getByRole("row")
      .filter({ has: page.getByRole("rowheader") })
      .allInnerTexts();
    expect(rows.join(" ")).toContain("Engagement type");
    expect(rows.join(" ")).toContain("Fee basis");
    expect(rows.join(" ")).not.toContain("AED");
  });

  test("a thin service publishes and does not count — criteria 3, 4 and 5", async ({ page }) => {
    await expect(page.getByText("2 live · 1 more to finish this task")).toBeVisible();
    await expect(page.getByText("+13% so far")).toBeVisible();

    /*
       Make one thin from this screen rather than through another, which is both
       the shorter path and the one that exercises the inline editing: the VAT
       row is live at 4 of 6, and emptying its turnaround takes it to 3 —
       below the bar — without unpublishing it. Publishing and counting are two
       rules, and this is the state that separates them.

       Turnaround rather than the fee basis, because the placeholder option on a
       `Select` is disabled on purpose: a seller cannot choose "not set" back,
       which is board `3g-s`'s own correction against a select that invented
       data on save. There is no path through this screen that clears a fee
       basis, and that is the intended behaviour rather than a gap in the test.
    */
    const vat = page.getByRole("row", { name: /VAT and corporate tax filing/ });
    const turnaround = vat.getByRole("textbox", { name: "Turnaround" });
    const wasTurnaround = (await turnaround.inputValue()).trim();
    expect(wasTurnaround.length).toBeGreaterThan(0);

    await turnaround.fill("");
    await turnaround.blur();
    await expect(vat.getByText("3 of 6")).toBeVisible();

    /*
       Still live and still findable — nothing about publication changed. What
       changed is what it pays.

       The tally is the assertion rather than a specific percentage: the shares
       are distributed by largest remainder so that the levers sum to exactly a
       hundred, which means the spare point moves between components as the rest
       of the profile changes. `tests/integration/setup-services-8cs.test.ts`
       pins 7, 13 and 20 against a controlled fixture, where the number is a
       property of the rule rather than of this seller's whole record.
    */
    await expect(page.getByText("2 live · 2 more to finish this task")).toBeVisible();
    await expect(page.getByText("+13% so far")).toHaveCount(0);
    await expect(page.getByText(/^\+\d+% so far$/)).toBeVisible();

    /*
       And the callout names the fields. "Turnaround, where it is delivered and
       deliverable are the ones missing" is an instruction; "this service is
       incomplete" is a nag.
    */
    await expect(page.getByText("VAT and corporate tax filing is thin")).toBeVisible();
    const body = page.getByText(/3 of 6 required rows means/);
    await expect(body).toContainText("Turnaround");
    await expect(body).toContainText("deliverable");

    // Put the fixture back the way it was found.
    await turnaround.fill(wasTurnaround);
    await turnaround.blur();
    await expect(vat.getByText("4 of 6")).toBeVisible();
    await expect(page.getByText("2 live · 1 more to finish this task")).toBeVisible();
    await expect(page.getByText("+13% so far")).toBeVisible();
  });

  test("step 2 is inert until a sheet is chosen — criterion 1", async ({ page }) => {
    // Switch sheets, which is the reachable half: the fixture has one chosen,
    // and the locked state is what a seller sees before they ever pick.
    const fm = page.getByRole("listitem").filter({ hasText: "On-site maintenance" });
    await fm.getByRole("button", { name: "Choose this sheet" }).click();
    await expect(fm).toContainText("Chosen");

    /*
       Services keep everything typed — the board's §States. A seller correcting
       a wrong first choice must not lose the afternoon they spent on it.
    */
    await expect(page.getByRole("row").filter({ hasText: "Statutory audit" })).toBeVisible();
    await expect(page.getByText("Your services keep everything you have typed")).toBeVisible();

    // Back to the sheet the fixture came with.
    const audit = page.getByRole("listitem").filter({ hasText: "Professional services" });
    await audit.getByRole("button", { name: "Choose this sheet" }).click();
    await expect(audit).toContainText("Chosen");
  });

  test("has no axe violations", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});


const TEMPLATES = "/dashboard/scope-templates";

/**
 * Board `3h-s` — scope templates, and the rule that scope is never one of them.
 *
 * The fixture holds one template used by two of the three services, with the
 * template deliberately disagreeing with both — so the screen arrives with
 * changes waiting, which is B4 in its only visible state.
 *
 * These tests write. Each puts back what it moved, and the file is serial.
 */
test.describe("board 3h-s — scope templates", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEMPLATES);
  });

  test("travels five fields and blanks four — criterion 1", async ({ page }) => {
    const prefilled = page.getByRole("heading", { name: "PRE-FILLED FOR EVERY SERVICE THAT USES IT" });
    await expect(prefilled).toBeVisible();

    for (const field of ["Engagement type", "Fee basis", "Delivered where", "Deliverable", "Accreditation"]) {
      await expect(page.getByRole("term").filter({ hasText: field })).toBeVisible();
    }

    /*
       And the four are rendered rather than omitted. A template that simply did
       not mention scope would read as one that forgot; § Interface honesty asks
       for the unfilled to stay visible, and here it is also the argument.
    */
    await expect(page.getByRole("heading", { name: "LEFT BLANK PER SERVICE" })).toBeVisible();
    for (const field of ["Service name", "Scope", "Excluded", "Turnaround"]) {
      await expect(page.getByRole("term").filter({ hasText: field })).toBeVisible();
    }
    await expect(
      page.getByText("a pre-filled exclusions line is the one that ends up in a dispute"),
    ).toBeVisible();
  });

  test("offers no control that could template scope or exclusions — criterion 2", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Edit the template" }).click();

    /*
       Scoped to the form, and `exact`. Unscoped, "Service name" finds the
       clone box further down — which correctly has one — and "Scope" finds
       *Which scope sheet is it based on* in the aside, because a role name
       matches as a substring. Fourth time that locator has cost a run here.
    */
    const form = page.locator("form").filter({
      has: page.getByRole("textbox", { name: "Template name", exact: true }),
    });

    for (const gone of ["Scope", "Excluded", "Turnaround", "Service name"]) {
      await expect(form.getByRole("textbox", { name: gone, exact: true })).toHaveCount(0);
      await expect(form.getByRole("combobox", { name: gone, exact: true })).toHaveCount(0);
    }
    await expect(form.getByRole("combobox", { name: "Engagement type", exact: true })).toBeVisible();
    await expect(form.getByRole("textbox", { name: "Accreditation", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("names the services it is used by, and counts them — criterion 6", async ({ page }) => {
    await expect(page.getByText(/Used by \d+ services?/)).toBeVisible();
    await expect(page.getByText("VAT and corporate tax filing · Transfer pricing documentation")).toBeVisible();
  });

  test("an edit offers rather than writes through — criteria 3 and 4", async ({ page }) => {
    /*
       The rule stated on the screen, and then the mechanism under it. A seller
       who changes a template sees rows appear saying which services would take
       it — and nothing has changed until they press one.
    */
    await expect(page.getByText("Editing a template does not rewrite live services")).toBeVisible();

    const waiting = page.getByRole("listitem").filter({ hasText: "Transfer pricing documentation" });
    const offer = waiting.getByRole("listitem").filter({ hasText: "Engagement type" });
    await expect(offer).toContainText("One-off job → Ongoing contract");

    // Decline it: the service keeps its value and the offer stops.
    await offer.getByRole("button", { name: "Decline" }).click();
    await expect(page.getByText("It will be offered again if you change the template")).toBeVisible();
    await expect(
      waiting.getByRole("listitem").filter({ hasText: "Engagement type" }),
    ).toHaveCount(0);

    // And the service is untouched — the editor still says what it always said.
    await page.goto("/dashboard/services");
    const row = page.getByRole("row", { name: /Transfer pricing documentation/ });
    await expect(row.getByText("2 of 6")).toBeVisible();
  });

  test("a clone arrives as a draft one field short — criterion 5", async ({ page }) => {
    await expect(page.getByText(/turnaround is the one left/i)).toBeVisible();

    await page.getByRole("textbox", { name: "Service name" }).fill("Excise tax return");
    await page.getByRole("button", { name: "Add the service" }).click();
    await expect(page.getByText(/Added as a draft at \d+ of 6/)).toBeVisible();

    // Draft, and one required field short — turnaround.
    await page.goto("/dashboard/services");
    const row = page.getByRole("row", { name: /Excise tax return/ });
    await expect(row.getByText("Draft")).toBeVisible();
    await expect(row.getByText("5 of 6")).toBeVisible();

    /*
       Put the fixture back, through the row menu. `3f-s` has no bulk delete —
       its own test asserts the absence — so deleting is one row at a time
       behind a confirmation, which is the right shape for an irreversible act.

       `summary`, not a role: `DataTable`'s row menu is a disclosure rather than
       a menu widget, deliberately — `role="menu"` without arrow-key navigation
       is a promise the markup does not keep — so it has no `button` or
       `menuitem` role to find it by.
    */
    await row.locator("summary").click();
    const remove = row.getByRole("button", { name: "Delete", exact: true });
    await expect(remove).toBeVisible();
    await remove.click();

    // Wait for the dialog rather than racing it: the confirm is rendered by a
    // `Modal`, so it is not in the DOM at the moment the menu item is pressed.
    const confirm = page.getByRole("button", { name: "Delete this service" });
    await expect(confirm).toBeVisible();
    await confirm.click();
    await expect(confirm).toBeHidden();

    // Reloaded rather than waiting on the optimistic table: the assertion is
    // that the row is gone from the database, which is what the next test needs.
    await page.reload();
    await expect(page.getByRole("row", { name: /Excise tax return/ })).toHaveCount(0);
  });

  test("has no axe violations", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
