import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board 12b — the dedupe queue, clicked, from an ops lead's session.
 *
 * **It stages its own pair.** The seeded pairs are shared by every shard and
 * every retry, and a test that resolved them would leave the next attempt an
 * empty queue (`e2e-destructive-tests-eat-fixtures`). The file staged here
 * carries one record: a branch of a seeded listing, its licence root and name
 * and a suffix stamped from this attempt, so the importer pairs it in the
 * manual band — and `?run=` narrows the queue to it.
 *
 * Nothing here merges or bulk merges. Keeping a pair separate and discarding a
 * record from this attempt's own run change no listing another spec reads.
 *
 * 1280 × 720, the acceptance shard's width.
 */

test.use({ viewport: { width: 1280, height: 720 } });

async function stageBranch(page: Page) {
  const tag = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  // A suffix of at most three digits is what the matcher reads as a branch.
  const suffix = tag.slice(-3);
  const csv = [
    "Trade Name,Licence No,Expiry Date,Emirate,Area,Activity,Phone",
    `Technopump Trading (Branch),DED-700000-${suffix},2028-01-31,Dubai,Al Quoz Industrial 1,Pumps & Motors Trading,`,
  ].join("\n");

  await page.goto("/admin/ingest");
  await page.getByRole("button", { name: "New import" }).click();
  const dialog = page.getByRole("dialog", { name: "Stage a licence export" });
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles({
    name: `e2e-dedupe-${tag}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await dialog.getByLabel("Reason").fill(`End-to-end dedupe staging ${tag}.`);
  await dialog.getByRole("button", { name: "Stage the run" }).click();
  await page.waitForURL(/\/admin\/ingest\/(?!categorise|dedupe)[^/]+$/);
  return new URL(page.url()).pathname.split("/").pop()!;
}

test.describe("a pair from a staged run", () => {
  test("is decided from the keyboard, put back, and decided again", async ({ page }) => {
    const runId = await stageBranch(page);

    // The run's duplicates card says where its pair stands.
    await expect(page.getByText("1 waiting in dedupe, 0 decided")).toBeVisible();

    await page.goto(`/admin/ingest/dedupe?run=${runId}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Dedupe queue");
    await expect(page.getByRole("link", { name: "Dedupe queue" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Pair 1 of 1 needing a decision" })).toBeVisible();

    // Record A is the listing that survives, and the consequence is drawn.
    await expect(page.getByRole("heading", { name: "Technopump Trading", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Technopump Trading (Branch)" })).toBeVisible();
    await expect(page.getByText(/usually means a branch, not a separate company/)).toBeVisible();
    const signals = page.getByRole("region", { name: "Match signals" });
    await expect(signals.getByText("Licence root identical")).toBeVisible();

    // 2 chooses "keep separate" and rewrites the prefilled reason to match.
    await page.getByRole("heading", { level: 1 }).click();
    await page.keyboard.press("2");
    await expect(page.getByRole("radio", { name: /Keep as separate listings/ })).toBeChecked();
    // Scoped: the closed reason dialogs on this page carry a "Reason" field too.
    const workspace = page.getByRole("region", { name: "Pair 1 of 1 needing a decision" });
    await expect(workspace.getByLabel("Reason")).toHaveValue(/^Kept separate:/);

    // Control+Enter decides it, and the manual band for this run is empty.
    await page.keyboard.press("Control+Enter");
    await expect(page.getByText("Kept separate from Technopump Trading.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No pair needs a decision" })).toBeVisible();

    // Reversible, and the reversal puts the pair back in the queue.
    const row = page
      .getByRole("table", { name: "Decisions inside the thirty-day window, newest first" })
      .getByRole("row", { name: /Technopump Trading and Technopump Trading \(Branch\) kept separate/ })
      .first();
    await row.getByRole("button", { name: "Put it back" }).click();
    const dialog = page.getByRole("dialog", { name: "Put this decision back" });
    await dialog.getByLabel("Reason").fill("Reopened by the end-to-end suite.");
    await dialog.getByRole("button", { name: "Put it back" }).click();
    await expect(page.getByText("Put back. The pair is in the queue again.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pair 1 of 1 needing a decision" })).toBeVisible();

    // Decided again with the mouse, so this attempt leaves nothing pending.
    await page.getByRole("radio", { name: /Discard B/ }).check();
    await page.getByRole("button", { name: "Discard B", exact: true }).click();
    await expect(page.getByText("Discarded. Technopump Trading is unchanged.")).toBeVisible();
  });
});

test.describe("tuning the lines", () => {
  test("previews the queue before anything can be applied", async ({ page }) => {
    await page.goto("/admin/ingest/dedupe");
    await page.getByRole("button", { name: "Tune matching" }).click();
    const dialog = page.getByRole("dialog", { name: "Tune matching" });
    await expect(dialog.getByRole("button", { name: "Apply these lines" })).toBeDisabled();

    await dialog.getByLabel("Floor").fill("65");
    await dialog.getByRole("button", { name: "Preview" }).click();
    const table = dialog.getByRole("table", { name: "The queue now and under the proposed lines" });
    await expect(table).toBeVisible({ timeout: 30_000 });
    for (const band of ["Safe to bulk merge", "Needs a decision", "Withdrawn under the floor"]) {
      await expect(table.getByRole("rowheader", { name: band })).toBeVisible();
    }
    // Still refused without a reason, and refused again once the lines move.
    await expect(dialog.getByRole("button", { name: "Apply these lines" })).toBeDisabled();
    await dialog.getByLabel("Reason").fill("Only previewing.");
    await expect(dialog.getByRole("button", { name: "Apply these lines" })).toBeEnabled();
    await dialog.getByLabel("Floor").fill("66");
    await expect(dialog.getByText("The lines changed since this preview.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Apply these lines" })).toBeDisabled();

    await dialog.getByRole("button", { name: "Cancel" }).first().click();
    await expect(dialog).toBeHidden();
  });
});

test("the dedupe queue is axe clean", async ({ page }) => {
  await page.goto("/admin/ingest/dedupe");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Dedupe queue");
  const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(results.violations).toEqual([]);
});
