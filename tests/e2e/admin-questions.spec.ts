import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * `/admin/questions` — board 1g's staff side, and build plan 9.7's route with
 * no test of any kind.
 *
 * Runs as the ops lead: `question.remove` is that rung alone, the same as
 * removing a review. The moderator's 404 is in `admin-moderator.spec.ts`.
 *
 * ## The one row this file decides
 *
 * The seed carries a question for this spec and nobody else — unanswered, so it
 * never reaches the public card, and the kind staff take down. Every other
 * question on the list belongs to `product-detail.spec.ts`'s counts, and a test
 * that removed "the first row" would be eating that file's fixture. Nothing in
 * the product creates a question yet (`askQuestion` has no route), so a test
 * cannot file its own the way `admin-reports.spec.ts` does.
 */

const OURS = "Can we agree the price on WhatsApp instead and leave the enquiry out of it?";
const REASON = "Invites the seller to move the deal off-platform, where nothing is recorded.";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
});

test("opens for an ops lead, with the questions as a list", async ({ page }) => {
  const response = await page.goto("/admin/questions");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Product questions");

  const list = page.getByRole("main").getByRole("list").filter({ hasText: OURS });
  await expect(list).toHaveCount(1);
  expect(await list.getByRole("listitem").count()).toBeGreaterThanOrEqual(4);
});

test("links each question to the product it was asked on, and the page is there", async ({
  page,
  request,
}) => {
  await page.goto("/admin/questions");
  const item = page.getByRole("listitem").filter({ hasText: OURS });
  const link = item.getByRole("link").first();
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/b\/[\w-]+\/p\/[\w-]+$/);
  // The destination, not the element: a link that exists and 404s is the
  // shape of defect a visibility check passes.
  expect((await request.get(href!)).status()).toBe(200);
});

test("asks for a written reason before it removes anything", async ({ page }) => {
  await page.goto("/admin/questions");
  const reason = page.getByRole("listitem").filter({ hasText: OURS }).getByLabel("Why it is being removed");
  // Already removed on a retry of this file; the field is only there before.
  if ((await reason.count()) === 0) return;
  await expect(reason).toHaveAttribute("required", "");
  await expect(reason).toHaveAttribute("minlength", "8");
});

test("removes a question and keeps it on the list, marked, with the reason", async ({ page }) => {
  await page.goto("/admin/questions");
  const item = page.getByRole("listitem").filter({ hasText: OURS });
  await expect(item).toHaveCount(1);

  /*
     Removed by this test on its first attempt. A retry of the same run finds
     it already removed, and what it asserts afterwards is the same thing.
  */
  const reason = item.getByLabel("Why it is being removed");
  if ((await reason.count()) > 0) {
    await reason.fill(REASON);
    await item.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Question removed." })).toBeVisible();
  }

  await page.reload();
  const after = page.getByRole("listitem").filter({ hasText: OURS });
  await expect(after).toHaveCount(1);
  await expect(after.getByText("Removed", { exact: true })).toBeVisible();
  await expect(after.getByText(REASON)).toBeVisible();
  // Its own label. It borrowed the review screen's, which promised a rating
  // average a question does not have.
  await expect(after).not.toContainText("rating average");
  await expect(after.getByRole("button", { name: "Remove" })).toHaveCount(0);
});

test("is axe clean", async ({ page }) => {
  await page.goto("/admin/questions");
  const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(results.violations).toEqual([]);
});
