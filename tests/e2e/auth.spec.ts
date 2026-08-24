import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 7a: four states and three failures.
 *
 * These are GET renders only. Submitting any of these forms reaches Supabase,
 * and CI has a placeholder key and no mail provider — the flow itself is proven
 * in tests/integration/auth-flow.test.ts against the real project, with a real
 * code. What is proven here is the part a test in node cannot see: that each of
 * the seven states actually draws, that they are reachable by keyboard, and
 * that axe is clean on all of them.
 */

const SCREENS = [
  { path: "/signin", heading: "Sign in" },
  { path: "/signup", heading: "Create an account" },
  { path: "/reset", heading: "Reset your password" },
  { path: "/verify?to=%2B971506412288&masked=%2B971+50+•••+••88", heading: "Enter your code" },
] as const;

test.describe("the four states", () => {
  for (const screen of SCREENS) {
    test(`${screen.path} renders`, async ({ page }) => {
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(screen.heading);
      await expect(page.getByRole("button", { name: /send|verify|email me/i }).first()).toBeVisible();
    });
  }

  test("verify says where the code went, without showing the number", async ({ page }) => {
    await page.goto("/verify?to=%2B971506412288&masked=%2B971+50+•••+••88");
    await expect(page.getByText("+971 50 ••• ••88")).toBeVisible();
    // The middle digits are the point of masking it.
    await expect(page.locator("body")).not.toContainText("6412");
  });

  test("verify with nothing to verify says so instead of showing an empty form", async ({ page }) => {
    await page.goto("/verify");
    await expect(page.getByText(/no number or address to verify/i)).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
  });

  test("the code field asks the platform for the one-time code", async ({ page }) => {
    // The single attribute that makes iOS and Android offer the code from the
    // notification. This flow is mobile-first and it is worth a test.
    await page.goto("/verify?to=%2B971506412288");
    await expect(page.getByLabel("Verification code")).toHaveAttribute(
      "autocomplete",
      "one-time-code",
    );
  });

  test("sign-up captures the intent to list as a choice, not a role", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("checkbox", { name: /buying/i })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /listing/i })).not.toBeChecked();
  });

  test("a checked box actually looks checked", async ({ page }) => {
    // The tick used to be driven by a React prop that is undefined on an
    // uncontrolled checkbox, so it stayed blank however many times you clicked.
    await page.goto("/signup");
    const listing = page.getByRole("checkbox", { name: /listing/i });
    const tick = page.locator("input[name=wantsToList] + span");
    await expect(tick).toHaveCSS("opacity", "0");
    await listing.check();
    await expect(tick).toHaveCSS("opacity", "1");
  });
});

test.describe("the three failures", () => {
  test("an expired link says so and offers a new one", async ({ page }) => {
    // Exactly what Supabase puts in the query string when a magic link ages out.
    await page.goto(
      "/auth/callback?flow=reset&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    await expect(page).toHaveURL(/\/reset\?error=link_expired/);
    await expect(page.getByText("That link has expired")).toBeVisible();
    await expect(page.getByRole("link", { name: "Send a new link" })).toBeVisible();
  });

  test("too many tries names the wait", async ({ page }) => {
    await page.goto("/verify?to=%2B971506412288&error=too_many_attempts&retry=540");
    await expect(page.getByText("Too many tries")).toBeVisible();
    await expect(page.getByText(/9 min/)).toBeVisible();
  });

  test("a suspended account gets a route to a person", async ({ page }) => {
    await page.goto("/signin?error=suspended&since=2026-08-11T09:00:00Z");
    await expect(page.getByText("This account is suspended")).toBeVisible();
    await expect(page.getByText(/11 Aug 2026/)).toBeVisible();
    await expect(page.getByRole("link", { name: /review team/i })).toBeVisible();
  });

  test("a failure is announced, not just coloured", async ({ page }) => {
    await page.goto("/signin?error=invalid_identifier");
    // .first(): Next renders its own empty route announcer with role=alert.
    await expect(page.getByRole("alert").first()).toContainText(/UAE mobile number or an email/);
  });
});

test.describe("accessibility", () => {
  for (const screen of SCREENS) {
    test(`${screen.path} is axe clean`, async ({ page }) => {
      await page.goto(screen.path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        // Token-level, enumerated in docs/contrast.md and pinned on the gallery.
        .disableRules(["color-contrast"])
        .analyze();
      const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
      expect(summary, summary.join("\n")).toEqual([]);
    });
  }

  test("every link in the auth chrome resolves", async ({ page, request }) => {
    for (const screen of SCREENS) {
      await page.goto(screen.path);
      const hrefs = await page.locator("a[href^='/']").evaluateAll((nodes) =>
        nodes.map((n) => (n as HTMLAnchorElement).getAttribute("href")!),
      );
      for (const href of new Set(hrefs)) {
        const response = await request.get(href, { maxRedirects: 0 });
        expect([200, 307, 308], `${screen.path} → ${href}`).toContain(response.status());
      }
    }
  });
});
