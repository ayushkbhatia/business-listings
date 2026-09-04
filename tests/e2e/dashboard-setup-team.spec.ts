import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 8d — the invite screen, in a browser, signed in.
 *
 * Named `dashboard-setup-team` so the signed-in `seller` project picks it up; a
 * file called `team.spec.ts` would run signed out and fail on a redirect.
 *
 * **Nothing here presses Send.** The seat is al-marwan-industrial-supplies-llc,
 * shared with every other seller spec, and an invitation is a row that occupies
 * a seat until somebody accepts or the nightly sweep expires it — so a spec that
 * sent one would spend that supplier's plan a little more on every run and
 * change the seat counter the next spec reads. What sending does is covered in
 * tests/integration/team-invite.test.ts, where a fixture can be built and torn
 * down. What is asserted here is the half a browser is needed for: the channel
 * resolving as the seller types, the primary counting valid rows, and the
 * branch column appearing only where there is a branch to choose.
 */

test.describe("board 8d — invite your team", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/setup/team");
  });

  test("is a task surface with no dashboard sidebar", async ({ page }) => {
    await expect(page.getByRole("navigation", { name: /Seller navigation/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Setup", exact: true })).toBeVisible();
  });

  test("shows completion rather than a step number", async ({ page }) => {
    /*
       The correction the 8b render carries, restated here because it is the
       thing a fourth task surface is most likely to regress. The four setup
       tasks are independent and free-order; "Task 3 of 4" would re-impose the
       sequence the hub exists to remove.
    */
    await expect(page.getByText(/tasks still open/)).toBeVisible();
    await expect(page.getByText(/Task \d+ of \d+/)).toHaveCount(0);
  });

  test("offers one field for either channel, and says which as you type", async ({ page }) => {
    // §2: sniffed, not asked. There is no radio button and no second field.
    const first = page.getByLabel("Mobile or email").first();
    await expect(first).toBeVisible();

    await first.fill("050 641 2288");
    await expect(page.getByText("Invite goes by WhatsApp").first()).toBeVisible();

    await first.fill("ops@example.ae");
    await expect(page.getByText("Invite goes by email").first()).toBeVisible();
  });

  test("refuses a landline in words, because no WhatsApp reaches one", async ({ page }) => {
    /*
       `toE164` normalises an 04 number perfectly happily, so accepting one
       would produce an invitation that looks sent and never arrives. This is
       the row saying so before the seller presses anything.
    */
    await page.getByLabel("Mobile or email").first().fill("04 883 4120");
    await expect(page.getByText(/not a UAE mobile or an email address/)).toBeVisible();
  });

  test("counts valid rows into the primary, and never disables it", async ({ page }) => {
    /*
       §4: with no valid rows the primary reads "Back to setup" rather than
       greying out. A disabled primary on a screen a seller may legitimately be
       leaving — because they work alone — is a dead end.
    */
    await expect(page.getByRole("button", { name: "Back to setup" })).toBeEnabled();

    await page.getByLabel("Mobile or email").first().fill("ops@example.ae");
    await expect(page.getByRole("button", { name: /Send 1 invite & back to setup/ })).toBeEnabled();

    await page.getByLabel("Mobile or email").nth(1).fill("050 641 2288");
    await expect(page.getByRole("button", { name: /Send 2 invites & back to setup/ })).toBeEnabled();
  });

  test("starts with two rows and adds a third on request", async ({ page }) => {
    // §9: two empty rows on the first run. One row reads as "name a person";
    // two reads as "name your team", which is the job.
    await expect(page.getByLabel("Mobile or email")).toHaveCount(2);
    await page.getByRole("button", { name: "+ Add another person" }).click();
    await expect(page.getByLabel("Mobile or email")).toHaveCount(3);
  });

  test("offers the branch column, because this supplier has branches", async ({ page }) => {
    // Hidden entirely on a single-branch business — §2 — so this asserts the
    // multi-branch half. al-marwan has six.
    await expect(page.getByLabel("Branch").first()).toBeVisible();
    await expect(page.getByLabel("Branch").first().getByRole("option")).not.toHaveCount(0);
  });

  test("offers nearest-branch routing only where a branch can differ", async ({ page }) => {
    await expect(page.getByRole("radio", { name: "Round-robin" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Everyone sees everything" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Nearest branch" })).toBeVisible();
  });

  test("states the escalation as a real threshold, in hours", async ({ page }) => {
    /*
       §8 said to cut this sentence unless the job existed. It does —
       lib/enquiry/escalation-job.ts — so the promise stays, reads the
       supplier's own `leadEscalationMinutes`, and says it in the same unit the
       escalation email does rather than in minutes.
    */
    await expect(page.getByText(/unanswered for \d+ hours? escalates to you/)).toBeVisible();
  });

  test("warns that the tick and the score disagree", async ({ page }) => {
    // §5, stated rather than discovered: the task ticks on send, the points
    // wait for an active seat.
    await expect(
      page.getByText(/task ticks when the invite goes.*points land when they accept/i),
    ).toBeVisible();
  });

  test("says what a seat can and cannot reach", async ({ page }) => {
    await expect(page.getByText("WHAT THEY'LL GET")).toBeVisible();
    await expect(page.getByText("Sales cannot touch the money")).toBeVisible();
    // "Sales cannot touch the money" is the honest version. Nothing on this
    // screen may imply the platform holds any.
    const body = (await page.textContent("main")) ?? "";
    expect(body).not.toMatch(/payout|refund|checkout|invoice from us/i);
  });

  test("counts seats against the plan rather than a constant", async ({ page }) => {
    await expect(page.getByText(/\d+ of \d+ seats used on \w+/)).toBeVisible();
  });

  test("leaves without a dialog, because skipping costs nothing", async ({ page }) => {
    // "I work alone — skip" is not a deferral. A supplier with no colleagues is
    // finished with this task, and a confirmation would ask them to justify it.
    await page.getByRole("link", { name: /I work alone/ }).click();
    await expect(page).toHaveURL(/\/dashboard\/setup$/);
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
