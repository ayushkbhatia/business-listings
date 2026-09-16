import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board 4c-s — review a credential against the FTA register, from an ops lead's
 * session.
 *
 * The acceptance job sets `FTA_REGISTER_URL=fixture`, so the register behind the
 * screen is the stand-in the seed was built from, and a refetch answers the way
 * the seed stored.
 *
 * Nothing here verifies, rejects or asks for anything: the seeded credentials
 * are shared by every retry (`e2e-destructive-tests-eat-fixtures`), and the
 * decisions are proved in `tests/integration/credential-review-4cs.test.ts`. A
 * refetch is the one write, and it is evidence rather than a decision — running
 * it twice changes nothing a later test reads. What only a browser can prove is
 * that the screen offers the decisions honestly: the three fields and the join
 * counted apart, Verify present only where the read allows it, the reasons the
 * read contradicts disabled, and nothing to decide against a register that did
 * not answer.
 *
 * 1280 × 720, the acceptance shard's width.
 */

test.use({ viewport: { width: 1280, height: 720 } });

const table = (page: Page) => page.getByRole("table", { name: /Submissions waiting for a decision/ });
const rowFor = (page: Page, name: string) =>
  table(page).locator("tbody tr").filter({ has: page.getByText(name, { exact: true }) });

async function openReview(page: Page, name: string) {
  await page.goto("/admin/queue?kind=credential");
  const href = await rowFor(page, name).getByRole("link").first().getAttribute("href");
  expect(href).toMatch(/^\/admin\/queue\/credential\//);
  await page.goto(href!);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
}

/** A seeded read ages past the hour if the shard runs late; fetch it again before asserting on a decision. */
async function freshen(page: Page) {
  const refetch = page.getByRole("button", { name: "Fetch the register again" });
  if (await refetch.isVisible()) {
    await refetch.click();
    // A read that answered hides the control; the table is what is left.
    await expect(refetch).toHaveCount(0);
  }
}

const comparison = (page: Page) => page.getByRole("table", { name: "What they submitted, against the FTA public register" });

/**
 * When a read was taken, in either rendering `fetchedAt` can produce: the clock
 * alone for a read taken today in Dubai (`09:14`), the date and clock for one
 * taken before that (`15 Sep 2026, 09:14`). The seed stamps the unreachable
 * read thirty minutes back from the wall clock, so a shard that seeds between
 * 00:00 and 00:30 Dubai gets the second form, and pinning the first failed
 * twice on 2026-09-15. Both say when, which is what is being asserted.
 */
const didNotAnswer = /The FTA register did not answer at (?:\d{1,2} \w{3} \d{4}, )?\d{2}:\d{2}: it timed out/;

test("register checks join the Credentials chip and open their own screen", async ({ page }) => {
  await page.goto("/admin/queue?kind=credential");
  const nexus = rowFor(page, "Nexus Tax Consultancy");
  await expect(nexus.getByText("FTA tax agent 20034512")).toBeVisible();
  await expect(nexus.getByText("FTA register did not answer")).toBeVisible();

  // The row's action opens the screen: a rejection needs one of four reasons and a fresh read.
  const oasis = rowFor(page, "Oasis Books & Tax");
  await expect(oasis.getByRole("link", { name: "Reject" })).toHaveAttribute("href", /\/admin\/queue\/credential\//);
});

test("a name near-match: two of the three, the words that differ marked, and no Verify (B3)", async ({ page }) => {
  await openReview(page, "Al Bayan Tax Advisory");
  await freshen(page);

  const rows = comparison(page).locator("tbody tr");
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: "Registered name" })).toContainText("Near match");
  await expect(rows.filter({ hasText: "Registered name" }).locator("mark")).toHaveText(["Advisory (differs)", "Consultants (differs)"]);
  await expect(rows.filter({ hasText: "Trade licence on file" })).toContainText("Same entity");
  // The tally counts the three, never the join.
  await expect(page.getByText("2 of the three fields match.", { exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: /^Verify/ })).toHaveCount(0);
  await expect(page.getByText("Verify is unavailable: 2 of the three fields match.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask for a clearer document" })).toBeVisible();
  // Nothing the read makes plain, so nothing is pre-selected; the rejection it supports is offered.
  await expect(page.getByRole("radio", { name: "Resolves to a different entity" })).toBeEnabled();
  await expect(page.getByRole("radio", { name: "Lapsed on the register" })).toBeDisabled();

  const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(results.violations).toEqual([]);
});

test("a number that does not resolve pre-selects the reason, and a different entity is not saved by three matches", async ({ page }) => {
  await openReview(page, "Oasis Books & Tax");
  await freshen(page);
  await expect(page.getByText("The FTA register holds no agent under 20099881.")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Number does not resolve on the register" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Resolves to a different entity" })).toBeDisabled();

  await openReview(page, "Crescent Accounting");
  await freshen(page);
  await expect(page.getByText("3 of the three fields match.", { exact: true })).toBeVisible();
  await expect(comparison(page).locator("tbody tr").filter({ hasText: "Trade licence on file" })).toContainText("Different entity");
  await expect(page.getByText(/Verify is unavailable: all three fields match, but the register names a different trade licence/)).toBeVisible();
  await expect(page.getByRole("radio", { name: "Resolves to a different entity" })).toBeChecked();
});

test("a register that did not answer offers no decision, only a refetch", async ({ page }) => {
  await openReview(page, "Gulfline VAT Partners");
  await expect(page.getByText(didNotAnswer)).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Reason/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Verify/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Fetch the register again" }).click();
  await expect(page.getByText(didNotAnswer)).toBeVisible();
  await expect(page.getByText("Nothing can be decided until the register has answered, within the last hour.")).toBeVisible();
});

test("as drawn, reached the real way: a refetch finds all three and the licence, and Verify waits for a reason", async ({ page }) => {
  await openReview(page, "Nexus Tax Consultancy");
  await freshen(page);

  const rows = comparison(page).locator("tbody tr");
  await expect(rows.filter({ hasText: "Agent number" })).toContainText("Match");
  await expect(rows.filter({ hasText: "Registered name" })).toContainText("Match");
  await expect(rows.filter({ hasText: "Status" })).toContainText("Active until 31 Dec 2027");
  await expect(rows.filter({ hasText: "Trade licence on file" })).toContainText("Same entity");
  await expect(page.getByText("3 of the three fields match.", { exact: true })).toBeVisible();

  const verify = page.getByRole("button", { name: "Verify — all three match" });
  await expect(verify).toBeDisabled();
  await page.getByRole("textbox", { name: /Reason/ }).fill("All three match and the licence is theirs");
  await expect(verify).toBeEnabled();

  // What verifying changes is counted, and says nothing was withheld (Q2 stays a decision).
  await expect(page.getByRole("region", { name: "What verifying this changes" })).toContainText("Nothing is withheld from publishing");

  // The certificate is behind the authenticated admin route, never a public URL (B9).
  await expect(page.getByRole("link", { name: /fta-agent-cert\.pdf/ })).toHaveAttribute("href", /\/admin\/queue\/credential\/[^/]+\/document$/);

  // Skip moves to the next credential review with nothing written.
  await page.getByRole("navigation", { name: "Where this sits in the queue" }).getByRole("link", { name: "Skip" }).click();
  await expect(page).toHaveURL(/\/admin\/queue\/credential\/.+kind=credential|\/admin\/queue\/document\/.+kind=credential/);
});

test("the credential document route refuses a signed-out visitor with a 404", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const response = await context.request.get("/admin/queue/credential/not-a-credential/document", { maxRedirects: 0 });
  expect(response.status()).toBe(404);
  await context.close();
});
