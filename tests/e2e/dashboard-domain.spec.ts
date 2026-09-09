import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 5e, from the seller's side — the address model.
 *
 * Runs on the Pro seat. The Free seat proves the other half — the feature is
 * named rather than hidden, which is the rule the rest of the dashboard follows.
 *
 * The spec this replaces drove a DNS flow: a hostname field, a bare-domain
 * refusal, two records to copy and a propagation explainer. None of that exists
 * now. A seller reads the address they would be given and takes it, and the
 * only states are held and not-held.
 */

test.describe("board 5e — your own web address", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/domain");
  });

  test("says both addresses stay live, rather than implying a swap", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your own web address");
    await expect(page.getByText(/sits under businesslistings\.me/)).toBeVisible();
  });

  test("shows the address before it is taken, not after", async ({ page }) => {
    /*
       The seller reads what they are about to get. A screen that only reveals
       the address after the button is a screen that asks somebody to agree to
       a surprise — and the preview runs the same derivation the claim does, so
       it cannot promise one the write would refuse.
    */
    const held = await page.getByText(/^Your address$/).count();
    if (held > 0) {
      // Already claimed on this seat from an earlier run. The other half of the
      // screen is what is under test then.
      await expect(page.getByRole("link", { name: /\.businesslistings\.me$/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "Give up this address" })).toBeVisible();
      return;
    }

    await expect(page.getByText("The address you would get")).toBeVisible();
    await expect(page.getByText(/\.businesslistings\.me/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Take this address" })).toBeVisible();
  });

  test("asks for nothing — there is no hostname to type", async ({ page }) => {
    // The whole of the old flow was a text field and two DNS records. A label
    // under our own zone is derived, so a field here would be a question with
    // one possible answer.
    await expect(page.getByRole("textbox")).toHaveCount(0);
  });

  test("never tells a seller to add a DNS record", async ({ page }) => {
    /*
       The words that can only appear as an instruction. "Registrar" is not one
       of them and is deliberately absent from this list — the copy says there
       is nothing to set up at one, which is the reassurance this model earns
       rather than a leftover of the flow it replaced.
    */
    const body = (await page.locator("main").innerText()) ?? "";
    for (const gone of ["CNAME", "TXT record", "propagat"]) {
      expect(body, gone).not.toContain(gone);
    }
  });

  test("is axe clean", async ({ page }) => {
    const results = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
