import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 7a: four states, and the failures they carry.
 *
 * Renders, and the refusals that are decided before anything reaches Supabase.
 * The round trips — a password, a reset link, a suspended session — are in
 * tests/e2e/auth-password.spec.ts, which needs a service key to make an account.
 */

const SCREENS = [
  { path: "/signin", heading: "Welcome back", eyebrow: "Sign in" },
  { path: "/signup", heading: "Create your account", eyebrow: "Sign up · one account, two roles" },
  { path: "/reset", heading: "Reset your password", eyebrow: "Reset" },
  { path: "/verify?to=%2B971506412288", heading: "Enter the code we sent", eyebrow: "Verify" },
] as const;

test.describe("the four states", () => {
  for (const screen of SCREENS) {
    test(`${screen.path} renders`, async ({ page }) => {
      await page.goto(screen.path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(screen.heading);
      // The eyebrow is the card's first line. CSS uppercases it; the text node
      // is sentence case, and "Sign in" and "Verify" are also button names.
      await expect(page.locator("article > p").first()).toHaveText(screen.eyebrow);
    });
  }

  test("sign-in offers a password and a code on one form, password first as drawn", async ({ page }) => {
    await page.goto("/signin");
    const buttons = page.locator("form").first().getByRole("button");
    await expect(buttons).toHaveText(["Sign in", "Send me a one-time code"]);
    await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
    await expect(page.getByRole("link", { name: "Forgot?" })).toHaveAttribute("href", "/reset");
    await expect(page.getByRole("link", { name: "List your business free" })).toBeVisible();
  });

  test("verify says where the code went, masked the way the board draws it", async ({ page }) => {
    await page.goto("/verify?to=%2B971506412288");
    await expect(page.getByText("Sent on WhatsApp to +971 50 641 ••88. It expires in 10 minutes.")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("6412");
  });

  test("verify masks the number it is verifying, never one from the query string", async ({ page }) => {
    // Board 7a's own correction: the code was once addressed, on screen, to a
    // colleague's number. A crafted `masked=` cannot do that again.
    await page.goto("/verify?to=%2B971506412288&masked=%2B971+55+704+%E2%80%A2%E2%80%A220");
    await expect(page.getByText(/\+971 50 641 ••88/)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("704");
  });

  test("verify with nothing to verify says so instead of showing an empty form", async ({ page }) => {
    await page.goto("/verify");
    await expect(page.getByText(/no number or address to verify/i)).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
  });

  test("the code field is one input the platform can fill, drawn as six boxes", async ({ page }) => {
    await page.goto("/verify?to=%2B971506412288");
    const field = page.getByLabel("Verification code");
    await expect(field).toHaveAttribute("autocomplete", "one-time-code");
    await field.fill("418");
    const boxes = page.locator("form [aria-hidden=true] > span");
    await expect(boxes).toHaveCount(6);
    await expect(boxes).toHaveText(["4", "1", "8", "", "", ""]);
    // An eight-digit code — what the hosted project was issuing — gets eight
    // boxes rather than being cut to six.
    await field.fill("41882290");
    await expect(boxes).toHaveCount(8);
  });

  test("sign-up asks which door, preselecting the one somebody arrived through", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("radio", { name: /I'm buying/ })).toBeChecked();
    await expect(page.getByRole("radio", { name: /I'm listing a business/ })).not.toBeChecked();

    await page.goto("/signup?as=supplier");
    await expect(page.getByRole("radio", { name: /I'm listing a business/ })).toBeChecked();
    await expect(page.getByLabel("Mobile")).toHaveValue("+971 ");
  });

  test("a refused sign-up keeps what was typed and names what is missing", async ({ page }) => {
    await page.goto("/signup");
    await page.getByRole("radio", { name: /I'm listing a business/ }).check();
    await page.getByLabel("Full name").fill("Suresh Menon");
    await page.getByLabel("Mobile").fill("+971 50 641 2288");
    await page.getByLabel("Work email").fill("suresh@alwaha.ae");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "Tick the box" })).toBeVisible();
    await expect(page.getByLabel("Full name")).toHaveValue("Suresh Menon");
    await expect(page.getByLabel("Work email")).toHaveValue("suresh@alwaha.ae");
    await expect(page.getByRole("radio", { name: /I'm listing a business/ })).toBeChecked();
    // Nothing identifying went into the address bar to keep those values.
    expect(page.url()).not.toContain("alwaha");
  });
});

test.describe("the failures", () => {
  test("an old Supabase recovery link lands on reset as expired", async ({ page }) => {
    await page.goto(
      "/auth/callback?flow=reset&error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
    );
    await expect(page).toHaveURL(/\/reset\?error=link_expired/);
    await expect(page.getByText("Reset links last one hour — request another.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Request another" })).toBeVisible();
  });

  test("a reset link nobody issued reads as expired, and draws no password field", async ({ page }) => {
    await page.goto("/auth/reset?token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    await expect(page).toHaveURL(/\/reset\?error=link_expired/);
    await page.goto("/reset?stage=set");
    await expect(page.getByText("Link expired.")).toBeVisible();
    await expect(page.getByLabel("New password")).toHaveCount(0);
  });

  test("too many wrong codes names the wait", async ({ page }) => {
    await page.goto("/verify?to=%2B971506412288&error=too_many_attempts&retry=540");
    await expect(page.getByText("Too many attempts.")).toBeVisible();
    await expect(page.getByText(/9 min/)).toBeVisible();
  });

  test("a wrong code states the attempts left", async ({ page }) => {
    await page.goto("/verify?to=%2B971506412288&error=code_incorrect&left=3");
    await expect(page.getByRole("alert").first()).toContainText("3 attempts left before a 15-minute pause");
  });

  test("a suspended account is pointed at its email, and told nothing else (criterion 7)", async ({ page }) => {
    await page.goto("/signin?error=suspended&since=2026-08-11T09:00:00Z");
    await expect(page.getByText("Contact support — the reason is in your email.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Email support" })).toHaveAttribute(
      "href",
      "mailto:legal@businesslistings.me",
    );
    // No date, no reason: the screen is what anybody holding the phone sees.
    await expect(page.locator("body")).not.toContainText("2026");
  });

  test("a failure is announced, not only coloured", async ({ page }) => {
    await page.goto("/signin?error=invalid_identifier");
    // .first(): Next renders its own empty route announcer with role=alert.
    await expect(page.getByRole("alert").first()).toContainText(/UAE mobile number or an email/);
  });
});

test.describe("accessibility", () => {
  const extra = ["/signin?error=password_incorrect&left=2", "/reset?error=suspended", "/verify?to=%2B971506412288&error=code_incorrect&left=4"];

  for (const path of [...SCREENS.map((s) => s.path), ...extra]) {
    test(`${path} is axe clean`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        // Token-level, enumerated in docs/contrast.md and pinned on the gallery.
        .disableRules(["color-contrast"])
        .analyze();
      const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
      expect(summary, summary.join("\n")).toEqual([]);
    });
  }

  test("sign-in is complete by keyboard, in the order it reads", async ({ page, isMobile }) => {
    test.skip(isMobile, "Tab order is a desktop concern; the mobile project has no Tab key.");
    await page.goto("/signin");
    await expect(page.getByLabel("Mobile or email")).toBeFocused();
    const order: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press("Tab");
      order.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          // A `formAction` button carries React's `$ACTION_ID_…` as its name,
          // so a button reads as what it says.
          if (!el) return "";
          return el.tagName === "INPUT" ? (el.getAttribute("name") ?? "") : (el.textContent?.trim() ?? "");
        }),
      );
    }
    expect(order).toEqual(["Forgot?", "password", "Sign in", "Send me a one-time code", "List your business free"]);
  });

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
