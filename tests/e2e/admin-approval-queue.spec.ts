import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board 4b — the approval queue, clicked, from an ops lead's session.
 *
 * Read-only against the seed: nothing here approves, rejects or reassigns a
 * row, because the seeded submissions are shared by every retry and shard
 * (`e2e-destructive-tests-eat-fixtures`). The decisions themselves — bulk
 * approve re-checking each row on the server, a claim's owner seat, a branch
 * taken down — are proved in `tests/integration/approval-queue.test.ts`. What
 * only a browser can prove is that the screen offers them honestly: the chips
 * add up, the per-row action follows the checks, and the bulk bar refuses to
 * approve a selection it may not.
 *
 * 1280 × 720, the acceptance shard's width.
 */

test.use({ viewport: { width: 1280, height: 720 } });

const table = (page: Page) => page.getByRole("table", { name: /Submissions waiting for a decision/ });
const rowFor = (page: Page, name: string) =>
  table(page).locator("tbody tr").filter({ has: page.getByText(name, { exact: true }) });

const count = (label: string) => Number((label.match(/([\d,]+)\s*$/)?.[1] ?? "0").replace(/,/g, ""));

test("every kind has a chip, and the chips sum to All (criteria 4 and 5)", async ({ page }) => {
  await page.goto("/admin/queue");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Approval queue");

  const chips = page.getByRole("navigation", { name: "Filter by kind of submission" }).getByRole("link");
  await expect(chips).toHaveCount(7);
  const labels = await chips.allInnerTexts();
  const all = count(labels[0]!);
  const kinds = labels.slice(1).map(count);
  expect(kinds.reduce((sum, value) => sum + value, 0)).toBe(all);
  for (const name of ["New claims", "Profile edits", "Category changes", "Locations", "Credentials", "Conflicts"]) {
    await expect(chips.filter({ hasText: name })).toHaveCount(1);
  }

  // A chip's count is the rows under it.
  await chips.filter({ hasText: "New claims" }).click();
  await expect(page).toHaveURL(/kind=claim/);
  await expect(table(page).locator("tbody tr")).toHaveCount(kinds[0]!);
});

test("the per-row action follows what the checks found (criterion 6)", async ({ page }) => {
  await page.goto("/admin/queue");
  await expect(rowFor(page, "Zayed Facilities Management").getByRole("button", { name: "Approve" })).toBeVisible();
  await expect(rowFor(page, "Bright Smile Dental Clinic").getByRole("button", { name: "Request doc" })).toBeVisible();
  await expect(rowFor(page, "Aster Beauty Lounge").getByRole("button", { name: "Reject" })).toBeVisible();
  await expect(rowFor(page, "Gulf Star Auto Spare Parts").getByRole("link", { name: "Review" })).toBeVisible();

  // The check's own sentence, not a score (criterion 3).
  await expect(rowFor(page, "Bright Smile Dental Clinic").getByText(/Wrong document type detected/)).toBeVisible();
  await expect(rowFor(page, "Gulf Star Auto Spare Parts").getByText(/Licence expires in \d+ days/)).toBeVisible();
});

test("the bulk bar is bounded by the checks of what is selected (criterion 1)", async ({ page }) => {
  await page.goto("/admin/queue");
  // Nothing selected: no bar at all.
  await expect(page.getByRole("button", { name: "Approve all" })).toHaveCount(0);

  await rowFor(page, "Zayed Facilities Management").getByRole("checkbox").check();
  await expect(page.getByText("1 selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve all" })).toBeEnabled();
  await expect(page.getByText("Bulk-approve is only enabled for auto-checks that all passed")).toBeVisible();

  await rowFor(page, "Aster Beauty Lounge").getByRole("checkbox").check();
  await expect(page.getByText("2 selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve all" })).toBeDisabled();
  await expect(page.getByText("1 selected row has a check that did not pass")).toBeVisible();

  // The other three stay available: none of them publishes anything.
  for (const name of ["Request documents", "Reassign", "Reject with reason"]) {
    await expect(page.getByRole("button", { name })).toBeEnabled();
  }

  // And the approve dialog still asks for a reason before it will go.
  await rowFor(page, "Aster Beauty Lounge").getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "Approve all" }).click();
  const dialog = page.getByRole("dialog", { name: "Approve 1 submission" });
  await expect(dialog.getByRole("button", { name: "Approve 1 submission" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).first().click();
  await expect(dialog).toBeHidden();
});

test("the header counts what is over SLA, and triage walks the same list", async ({ page }) => {
  await page.goto("/admin/queue");
  await expect(page.getByText(/over SLA/).first()).toBeVisible();
  await expect(page.getByText(/Median decision time|No decisions in the last 30 days/)).toBeVisible();
  await expect(page.getByText(/% of this queue passed every automated check\./)).toBeVisible();

  await page.getByRole("link", { name: "Start triage session" }).click();
  const position = page.getByRole("navigation", { name: "Where this sits in the queue" });
  await expect(position.getByText(/^1 of [\d,]+ · every kind$/)).toBeVisible();
  await expect(position.getByRole("link", { name: "Next submission" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Automated checks" })).toBeVisible();
});

test("Assigned to me narrows the chips with the rows, and says where the rest are", async ({ page }) => {
  await page.goto("/admin/queue");
  await page.getByRole("link", { name: "Assigned to me" }).click();
  await expect(page).toHaveURL(/mine=1/);
  const chips = page.getByRole("navigation", { name: "Filter by kind of submission" }).getByRole("link");
  const labels = await chips.allInnerTexts();
  const rows = await table(page).locator("tbody tr").count();
  const all = count(labels[0]!);
  expect(labels.slice(1).map(count).reduce((sum, value) => sum + value, 0)).toBe(all);
  if (all === 0) {
    await expect(page.getByText("Nothing is assigned to you")).toBeVisible();
    await expect(page.getByRole("link", { name: "Show all submissions" }).first()).toBeVisible();
  } else {
    expect(rows).toBe(all);
  }
  await expect(page.getByRole("link", { name: "All submissions", exact: true })).toBeVisible();
});

test("a claim opens with its checks, its evidence and three decisions", async ({ page }) => {
  await page.goto("/admin/queue?kind=claim");
  const href = await rowFor(page, "Gulf Star Auto Spare Parts").getByRole("link", { name: "Review" }).getAttribute("href");
  await page.goto(href!);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Gulf Star Auto Spare Parts");
  await expect(page.getByRole("navigation", { name: "Where this sits in the queue" }).getByText(/ of [\d,]+ · Claim$/)).toBeVisible();
  await expect(page.getByRole("region", { name: "What the register says" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the document" })).toBeVisible();
  for (const name of ["Approve and apply", "Request a document", "Reject"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
});

test("tuning previews before it will apply", async ({ page }) => {
  await page.goto("/admin/queue/rules");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Auto-check rules");
  await expect(page.getByRole("button", { name: "Apply these rules" })).toBeDisabled();
  await page.getByRole("switch", { name: "Run Callback made" }).click();
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("table", { name: "Submissions passing every check, now and under these rules" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Apply these rules" })).toBeDisabled();
  await page.getByLabel("Reason").fill("Only previewing.");
  await expect(page.getByRole("button", { name: "Apply these rules" })).toBeEnabled();
});

test("the queue, a claim and the rules are axe clean", async ({ page }) => {
  for (const path of ["/admin/queue", "/admin/queue/rules"]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations, path).toEqual([]);
  }
  await page.goto("/admin/queue?kind=claim");
  const review = await rowFor(page, "Gulf Star Auto Spare Parts").getByRole("link", { name: "Review" }).getAttribute("href");
  await page.goto(review!);
  const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(results.violations, review!).toEqual([]);
});
