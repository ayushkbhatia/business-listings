import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * The three doors added beside `/signin`.
 *
 * What these assert is mostly what the pages must *not* do. An entry surface is
 * a marketing page with an auth form on it, which is the shape most likely to
 * grow a second sign-in path, a leaked staff URL, or a number somebody typed —
 * so each of those has a test rather than a comment.
 */

const DOORS = [
  { path: "/for-buyers", heading: "Find a supplier who can actually do it" },
  { path: "/list-your-business", heading: "Answer the buyers who are already asking" },
];

test.describe("the audience entry surfaces", () => {
  for (const door of DOORS) {
    test(`renders its own copy and one sign-in form: ${door.path}`, async ({ page }) => {
      await page.goto(door.path);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(door.heading);
      // One form, posting to the shared action. Two would be two sign-in paths.
      await expect(page.locator("form")).toHaveCount(1);
      await expect(page.getByLabel("Mobile number or email")).toBeVisible();
    });

    test(`offers the directory rather than trapping the visitor: ${door.path}`, async ({ page }) => {
      await page.goto(door.path);
      await expect(page.getByRole("link", { name: "Browse the directory" })).toBeVisible();
    });

    test(`has no axe violations: ${door.path}`, async ({ page }) => {
      await page.goto(door.path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        // Token-level, enumerated in docs/contrast.md and pinned on the gallery.
        .disableRules(["color-contrast"])
        .analyze();
      const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
      expect(summary, summary.join("\n")).toEqual([]);
    });
  }

  test("the supplier door preselects the listing intent on signup", async ({ page }) => {
    await page.goto("/list-your-business");
    await page.getByRole("link", { name: "Create an account" }).click();

    await expect(page).toHaveURL(/\/signup\?as=supplier/);
    await expect(page.getByLabel(/Listing/)).toBeChecked();
    await expect(page.getByLabel(/Buying/)).not.toBeChecked();
  });

  test("the buyer door leaves the buying intent ticked", async ({ page }) => {
    await page.goto("/for-buyers");
    await page.getByRole("link", { name: "Create an account" }).click();

    await expect(page).toHaveURL(/\/signup\?as=buyer/);
    await expect(page.getByLabel(/Buying/)).toBeChecked();
    await expect(page.getByLabel(/Listing/)).not.toBeChecked();
  });

  test("a refusal returns to the door it was refused at", async ({ page }) => {
    await page.goto("/list-your-business");
    await page.getByLabel("Mobile number or email").fill("not-a-number");
    await page.getByRole("button", { name: "Send me a code" }).click();

    // Not /signin. Somebody reading the supplier page stays on it.
    await expect(page).toHaveURL(/\/list-your-business\?.*error=invalid_identifier/);
    await expect(page.getByText(/does not look like a UAE mobile number/)).toBeVisible();
  });
});

test.describe("the staff door", () => {
  test("renders a form and asks not to be indexed", async ({ page }) => {
    await page.goto("/staff");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Staff sign in");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
  });

  test("is axe clean", async ({ page }) => {
    await page.goto("/staff");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(summary, summary.join("\n")).toEqual([]);
  });

  test("is disallowed in robots.txt", async ({ page }) => {
    const response = await page.request.get("/robots.txt");
    expect(await response.text()).toContain("/staff");
  });

  test("nothing on the public site links to it", async ({ page }) => {
    /*
       The console is undiscoverable only while nothing advertises it. The root
       404 is the page most likely to grow a helpful link, so it is the one
       checked: it offers /signin, and must go on offering only that.
    */
    for (const path of ["/", "/signin", "/no-such-page"]) {
      await page.goto(path);
      await expect(page.locator('a[href^="/staff"]')).toHaveCount(0);
    }
  });

  test("asks for exactly what /signin asks for, and nothing more", async ({ page }) => {
    /*
       The enumeration guard, asserted structurally rather than by submitting.

       A staff-only form that answered differently for a staff number than for
       anybody else's would let somebody find an ops lead by typing numbers.
       The defence is that there is no staff-specific field and no staff-specific
       action: this posts the same `identifier` to the same `signInAction`, and
       `startSignIn`'s neutrality — asserted in
       tests/integration/auth-flow.test.ts against the real project — covers both
       doors at once. So what is checked here is that nothing new has been added
       to the form.

       Submitting is deliberately not done: with no SMS provider the outcome is
       `unavailable` rather than a code, which would make this a test of the
       environment rather than of the page.
    */
    const names = async (path: string) => {
      await page.goto(path);
      return (
        await page.locator("form").first().locator("input, select, textarea").evaluateAll((nodes) =>
          nodes
            .map((node) => node.getAttribute("name"))
            .filter((name): name is string => !!name)
            // React's own field on a server-action form, not one this page asks for.
            .filter((name) => !name.startsWith("$ACTION")),
        )
      ).sort();
    };

    expect(await names("/staff")).toEqual(["from", "identifier", "next"]);
    expect(await names("/signin")).toEqual(["identifier"]);
  });

  test("carries next=/admin without granting anything", async ({ page }) => {
    await page.goto("/staff");
    await expect(page.locator('input[name="next"]')).toHaveValue("/admin");

    // The destination is not the permission. Signed out, /admin is still a 404.
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("That page is not here");
  });
});
