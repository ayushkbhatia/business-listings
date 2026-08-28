import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Handoff 2, step 5 — the notification layer, in a browser.
 *
 * Routing, quiet hours and the render-time leak guard are proven in
 * lib/notify/*.test.ts and tests/integration/notifications.test.ts. What is
 * proven here is board 7f: every template in the database rendered together,
 * which is the surface a person actually reads before approving one.
 *
 * Board 7e is on /dashboard and cannot be reached under `next start`, where
 * the development seller seat is deliberately inert. Same gap as the seller
 * thread; it closes when CI can sign a seller in.
 */
test.describe("board 7f — the template specimens", () => {
  test("renders every template, grouped by event", async ({ page }) => {
    await page.goto("/dev/notifications");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Notification templates");

    // The events the README names for the matrix.
    for (const event of ["enquiry_received", "quote_accepted", "weekly_digest"]) {
      await expect(page.getByRole("heading", { name: event })).toBeVisible();
    }
  });

  test("says which WhatsApp templates Meta has not approved", async ({ page }) => {
    // A seller switching WhatsApp on and hearing nothing deserves to know why,
    // and so does whoever is chasing the approval.
    await page.goto("/dev/notifications");
    await expect(page.getByText("pending_meta").first()).toBeVisible();
    /*
       `.first()`, because the specimen page renders every version and a
       template name is shared by all of them. `admin-content.spec.ts` writes a
       new draft version of this exact pair on every run — legitimately, there
       is no delete path for a version and there should not be — so the second
       local run of the suite hit a strict-mode violation here and the first
       did not. Found while building the guides screens.
    */
    await expect(page.getByText(/bl_enquiry_received_v1/).first()).toBeVisible();
  });

  test("every template renders — none has a hole or a leak", async ({ page }) => {
    // The page renders each one through the real renderer, which throws on a
    // missing value and on a value shaped like contact details. A template
    // that cannot render says so in red rather than being quietly skipped.
    await page.goto("/dev/notifications");
    await expect(page.getByText(/Refusing to render/)).toHaveCount(0);
  });

  test("criterion 8, as it appears on the page", async ({ page }) => {
    await page.goto("/dev/notifications");
    const body = (await page.textContent("main")) ?? "";
    // No phone number, email address or IBAN anywhere in the rendered set.
    expect(body).not.toMatch(/(?:\+|00)\d{1,3}[\s-]?\d[\d\s-]{6,}/);
    expect(body).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]{2,}/);
    expect(body).not.toMatch(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/);
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/dev/notifications");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(summary, summary.join("\n")).toEqual([]);
  });
});
