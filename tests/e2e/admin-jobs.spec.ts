import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Standing item 9.5 — the scheduled jobs, from an ops lead's session.
 *
 * What a browser can prove that the integration suite cannot: the screen is
 * reachable from the console, it states each cron in words, and a call the
 * scheduler made and the platform refused shows up where a person looks.
 *
 * The refused call is the one real record this spec can make on any machine
 * without running a job. With `CRON_SECRET` unset — CI's case — every call is
 * refused as `no_secret`; with it set, a wrong secret sent under Vercel's
 * user agent is refused as `wrong_secret`. Either way a `job_run` row is
 * written and no step runs, so no fixture another spec reads is consumed.
 * The present-run states are drawn in the gallery and written for real in
 * `tests/integration/job-runs.test.ts`.
 */

const REFUSAL = {
  500: "CRON_SECRET is not set in this deployment, so every call is refused",
  401: "The scheduler sent a secret that does not match CRON_SECRET",
} as const;

test.describe("standing item 9.5 — scheduled jobs", () => {
  test("is in the console's sidebar and opens on both crons", async ({ page }) => {
    await page.goto("/admin");
    const sidebar = page.getByRole("navigation", { name: "Staff navigation" });
    // The name may carry a count of crons wanting attention, so match the start.
    await sidebar.getByRole("link", { name: /^Scheduled jobs/ }).click();

    await expect(page).toHaveURL(/\/admin\/jobs$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Scheduled jobs");

    const crons = page.getByRole("table", { name: /Each cron's schedule/ });
    await expect(crons.getByRole("rowheader")).toHaveCount(2);
    await expect(crons.getByRole("rowheader", { name: /Daily job/ })).toBeVisible();
    await expect(crons.getByRole("rowheader", { name: /Hourly sweep/ })).toBeVisible();
    // Every row says in words whether it is on time. Never a bare colour.
    for (const row of await crons.getByRole("row").all()) {
      if ((await row.getByRole("rowheader").count()) === 0) continue;
      await expect(row).toContainText(/On schedule|Late|Never ran|Not due yet|Nothing recorded/);
    }
  });

  test("records a call the scheduler made and was refused, and shows why", async ({ page, request }) => {
    const response = await request.get("/api/jobs/sweep", {
      headers: {
        authorization: "Bearer not-the-secret",
        "user-agent": "vercel-cron/1.0",
        "x-vercel-cron-schedule": "42 * * * *",
      },
    });
    const status = response.status();
    expect([500, 401]).toContain(status);

    await page.goto("/admin/jobs?cron=sweep");
    // The cron tabs are routes: the one in view is the current page.
    await expect(page.getByRole("main").locator('a[aria-current="page"]')).toHaveText("Hourly sweep");
    const refusals = page.getByRole("table", { name: /Calls to the hourly sweep that were turned away/ });
    await expect(refusals.getByRole("cell", { name: REFUSAL[status as 500 | 401] }).first()).toBeVisible();
  });

  test("keeps a run's own page to the steps it planned", async ({ page }) => {
    await page.goto("/admin/jobs?cron=daily");
    const runs = page.getByRole("table", { name: /Runs of the daily job/ });
    const first = runs.getByRole("rowheader").getByRole("link").first();

    // A fresh database has no run; the screen says so rather than drawing zeros.
    if ((await first.count()) === 0) {
      await expect(page.getByText(/No run of the daily job is recorded|did not start/).first()).toBeVisible();
      return;
    }

    await first.click();
    await expect(page).toHaveURL(/\/admin\/jobs\/[0-9a-f-]{36}$/);
    const steps = page.getByRole("table", { name: /Each step the run set out to take/ });
    await expect(steps.getByRole("rowheader").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "All runs of the daily job" })).toHaveAttribute("href", "/admin/jobs?cron=daily#runs");
  });

  test("has no axe violations outside the known contrast set", async ({ page }) => {
    await page.goto("/admin/jobs");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(summary, summary.join("\n")).toEqual([]);
  });
});
