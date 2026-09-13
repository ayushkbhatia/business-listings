import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board 12a — the licence importer, clicked, from an ops lead's session.
 *
 * The flow that matters runs through four screens: stage a file, open the run
 * it becomes, work that run's categorisation queue, and see the run's figures
 * move. It is driven here through the real controls — the upload dialog, the
 * selection bar, the category dialog — because the integration suite already
 * proves the services and cannot prove that a button does anything.
 *
 * **It stages its own file.** The seeded run under review is shared by every
 * shard and every retry, and a test that categorised its queue would leave the
 * next attempt nothing to categorise (`e2e-destructive-tests-eat-fixtures`).
 * A phrase stamped with this attempt's time is a queue group nothing else can
 * touch. Nothing here publishes, discards or rolls back a seeded run.
 *
 * 1280 × 720, the acceptance shard's width: overflow and fieldset defects only
 * exist there.
 */

test.use({ viewport: { width: 1280, height: 720 } });

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function stageFile(page: Page, tag: string) {
  const phrase = `Rope Access Gear ${tag}`;
  const csv = [
    "Trade Name,Licence No,Expiry Date,Emirate,Area,Activity,Phone",
    `Summit Rigging ${tag} LLC,DED-7${tag.slice(-6)}1,2028-01-31,Dubai,Al Quoz Industrial 1,${phrase},043331101`,
    `Harbour Rope ${tag} LLC,DED-7${tag.slice(-6)}2,2028-01-31,Dubai,Deira,${phrase},042221102`,
    `Karama Valves ${tag} LLC,DED-7${tag.slice(-6)}3,2028-01-31,Dubai,Deira,Valves & Flanges Trading,042221103`,
    `Doha Branch ${tag},DED-7${tag.slice(-6)}4,2028-01-31,Doha,,Valves & Flanges Trading,`,
  ].join("\n");

  await page.goto("/admin/ingest");
  await page.getByRole("button", { name: "New import" }).click();
  const dialog = page.getByRole("dialog", { name: "Stage a licence export" });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: `e2e-${tag}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await dialog.getByLabel("Reason").fill(`End-to-end staging ${tag}.`);
  await dialog.getByRole("button", { name: "Stage the run" }).click();

  await page.waitForURL(/\/admin\/ingest\/(?!categorise)[^/]+$/);
  return phrase;
}

test.describe("the run under review", () => {
  test("its cards sum to the file, and its grounds to the rejected card", async ({ page }) => {
    await page.goto("/admin/ingest");
    const cards = page.locator("dl").first();
    const figure = async (label: string) =>
      Number(
        (await cards.locator("div", { has: page.getByText(label, { exact: true }) }).locator("dd").first().innerText()).replace(/,/g, ""),
      );

    const file = await figure("Records in file");
    const fresh = await figure("New listings");
    const duplicates = await figure("Possible duplicates");
    const rejected = await figure("Rejected");
    expect(fresh + duplicates + rejected).toBe(file);

    const grounds = page.getByRole("table", { name: "Rejections, by reason" });
    await expect(grounds.locator("tbody tr")).toHaveCount(4);
    const counts = await grounds.locator("tbody td:nth-child(2)").allInnerTexts();
    expect(counts.reduce((sum, value) => sum + Number(value.replace(/,/g, "")), 0)).toBe(rejected);
    await expect(grounds.locator("tfoot td").first()).toHaveText(String(rejected));
  });

  test("names what it will publish and what it is holding back", async ({ page }) => {
    await page.goto("/admin/ingest");
    const publish = page.getByRole("button", { name: /^Publish [\d,]+$/ });
    await expect(publish).toBeVisible();
    const count = (await publish.innerText()).replace(/\D/g, "");
    await expect(page.getByText(new RegExp(`${Number(count).toLocaleString("en-US")} new listings? will go live`))).toBeVisible();
    // `.first()`: the closed publish dialog carries the same sentence, and a
    // closed <dialog> still counts to a locator.
    await expect(page.getByText(/more records? wait, and publish from this run/).first()).toBeVisible();

    // The confirmation repeats the verb and asks for a reason before it will go.
    await publish.click();
    const dialog = page.getByRole("dialog", { name: /Publish [\d,]+ listings? from run \d+/ });
    const confirm = dialog.getByRole("button", { name: /^Publish [\d,]+ listings?$/ });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel" }).first().click();
    await expect(dialog).toBeHidden();
  });

  test("lists the sources, every emirate, including the ones never imported", async ({ page }) => {
    await page.goto("/admin/ingest");
    const sources = page.getByRole("table", { name: "Licence imports by emirate" });
    await expect(sources.locator("tbody tr")).toHaveCount(7);
    await expect(sources.getByText("Not imported").first()).toBeVisible();
    await expect(page.getByText("No registry is connected to import on a schedule.")).toBeVisible();
  });
});

test.describe("staging a file and working its queue", () => {
  test("stages, categorises a phrase from the queue, and the run's figures move", async ({ page }) => {
    const tag = stamp();
    const phrase = await stageFile(page, tag);

    // The run it became: four records, one a rejection, two waiting on the phrase.
    const runPath = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Run \d+ · DED/);
    await expect(page.getByText("Awaiting review").first()).toBeVisible();
    await expect(page.getByText("1 categorised · 2 waiting")).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish 1", exact: true })).toBeVisible();

    // Into the queue, narrowed to this run.
    await page.getByRole("link", { name: "Categorise this run's queue" }).first().click();
    await expect(page).toHaveURL(/\/admin\/ingest\/categorise\?run=/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Categorisation queue");

    const queue = page.getByRole("table", { name: "Activities waiting on a category, most records first" });
    await queue.getByRole("checkbox", { name: `Select ${phrase}` }).check();
    await page.getByRole("button", { name: "Categorise", exact: true }).first().click();

    const dialog = page.getByRole("dialog", { name: "Categorise 2 records" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("searchbox", { name: "Filter categories" }).fill("valves & fittings");
    await dialog.getByLabel("Category").selectOption({ label: "Valves & fittings" });
    // A sector sets its own kind, so there is nothing to confirm.
    await expect(dialog.getByText("Sold as goods")).toBeVisible();
    await expect(dialog.getByText("Set on this category.")).toBeVisible();
    await dialog.getByLabel("Remember this for future imports").uncheck();
    await dialog.getByLabel("Reason").fill(`Rope access suppliers stock valves ${tag}.`);
    await dialog.getByRole("button", { name: "File 2 records" }).click();

    await expect(page.getByRole("status").filter({ hasText: "2 records filed under Valves & fittings." })).toBeVisible();
    await expect(queue.getByText(phrase)).toHaveCount(0);

    // Back on the run, nothing is waiting, all three can publish, and nothing has.
    await page.goto(runPath);
    await expect(page.getByText("3 categorised · 0 waiting")).toBeVisible();
    await expect(page.getByRole("button", { name: "Publish 3", exact: true })).toBeVisible();
    await expect(page.getByText("Awaiting review").first()).toBeVisible();
  });

  test("asks for confirmation before filing under a trade kind that is only inherited", async ({ page }) => {
    const tag = stamp();
    const phrase = await stageFile(page, tag);

    // The whole queue this time, narrowed by searching for the phrase.
    await page.goto("/admin/ingest/categorise");
    await page.getByRole("searchbox", { name: "Search activities" }).fill(tag);
    await page.getByRole("searchbox", { name: "Search activities" }).press("Enter");
    await expect(page).toHaveURL(new RegExp(`[?&]q=${tag}`));
    const queue = page.getByRole("table", { name: "Activities waiting on a category, most records first" });
    await expect(queue.locator("tbody tr")).toHaveCount(1);

    await page.getByRole("button", { name: "Categorise", exact: true }).first().click();
    const dialog = page.getByRole("dialog", { name: /Categorise \d+ records?/ });
    await expect(dialog.getByText(phrase)).toBeVisible();
    await dialog.getByLabel("Category").selectOption({ label: "Gate valves" });
    await dialog.getByLabel("Reason").fill(`Checking the inherited kind ${tag}.`);

    const confirm = dialog.getByRole("button", { name: /^File \d+ records?$/ });
    await expect(dialog.getByText(/has no trade kind of its own\. It inherits goods from/)).toBeVisible();
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("These businesses sell goods").check();
    await expect(confirm).toBeEnabled();
    await dialog.getByRole("button", { name: "Cancel" }).first().click();
  });

  test("opens a record with its raw row, and exports the run's rejects with theirs", async ({ page, request }) => {
    const tag = stamp();
    await stageFile(page, tag);
    const runPath = new URL(page.url()).pathname;

    const records = page.getByRole("table", { name: /Records in run \d+, in file order/ });
    await records.getByText(`Doha Branch ${tag}`).click();
    await expect(page).toHaveURL(/\/admin\/ingest\/records\//);
    await expect(page.getByText("Rejected: Address outside the UAE. Discard.")).toBeVisible();
    const raw = page.getByRole("table", { name: "Every column the registry sent for this record" });
    await expect(raw.getByRole("rowheader", { name: "Emirate" })).toBeVisible();
    await expect(raw.getByRole("cell", { name: "Doha", exact: true })).toBeVisible();

    const response = await request.get(`${runPath}/rejects`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toMatch(/attachment; filename="run-\d+-ded-rejects\.csv"/);
    const body = await response.text();
    expect(body.split("\r\n")[0]).toBe(
      "Row,Reason code,Rejection reason,Action,Trade Name,Licence No,Expiry Date,Emirate,Area,Activity,Phone",
    );
    expect(body).toContain(`address_outside_uae,Address outside the UAE,Discard,Doha Branch ${tag}`);
  });
});

test.describe("the importer's screens are axe clean", () => {
  test("runs, a run, the queue and a record", async ({ page }) => {
    await page.goto("/admin/ingest");
    const runLink = page.getByRole("table", { name: "Import runs, newest first" }).getByRole("row").nth(1);
    await runLink.click();
    await page.waitForURL(/\/admin\/ingest\/[^/]+$/);
    const runPath = new URL(page.url()).pathname;

    await page.getByRole("table", { name: /Records in run \d+/ }).getByRole("row").nth(1).click();
    await page.waitForURL(/\/admin\/ingest\/records\//);
    const recordPath = new URL(page.url()).pathname;

    for (const path of ["/admin/ingest", runPath, "/admin/ingest/categorise", recordPath]) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
      expect(results.violations, path).toEqual([]);
    }
  });
});
