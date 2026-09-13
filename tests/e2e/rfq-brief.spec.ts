import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Board `1h-s` — `/rfq/new` for work sold by the job: a brief, and no field asks
 * a quantity.
 *
 * Anonymous, so it runs in the public projects. The facilities firms it matches
 * against are `seedBriefMatchFirms`: three verified firms reach Dubai (one only
 * through Al Quoz Industrial 1), one works only in Ajman's New Industrial Area,
 * and one covers Dubai with a licence nobody has verified.
 */

const BRIEF = "/rfq/new?category=hard-fm";
const site = (page: Page) => page.getByRole("combobox", { name: "Where is the site?" });
const rail = (page: Page) => page.getByRole("list", { name: "Suppliers this brief would go to" });

test.describe("board 1h-s — the brief", () => {
  test("asks five questions, and no quantity, target price or lines table renders — AC1", async ({ page }) => {
    await page.goto(BRIEF);
    await expect(page.getByRole("heading", { level: 1, name: "Describe the work once" })).toBeVisible();
    for (const question of ["Where is the site?", "What needs doing?", "Engagement type", "When from?", /Roughly what scale\?/]) {
      await expect(page.getByRole("group", { name: question })).toBeVisible();
    }
    await expect(page.locator("table")).toHaveCount(0);
    const text = (await page.locator("main").innerText()).toUpperCase();
    for (const word of ["QTY", "TARGET PRICE", "QUANTITY", "BUDGET", "ITEMS YOU NEED"]) expect(text).not.toContain(word);
    // No stepper: one screen, one send.
    await expect(page.getByText(/^\d \/ 3$/)).toHaveCount(0);
  });

  test("offers the seller's three engagements, and a cadence only for an ongoing contract — AC3, AC4", async ({ page }) => {
    await page.goto(BRIEF);
    const engagement = page.getByRole("group", { name: "Engagement type" });
    await expect(engagement.getByRole("radio")).toHaveCount(3);
    for (const name of ["Ongoing contract", "One-off job", "Call-off"]) {
      await expect(engagement.getByRole("radio", { name })).toBeVisible();
    }
    await expect(page.getByRole("radio", { name: "Quarterly" })).toHaveCount(0);

    await engagement.getByRole("radio", { name: "Ongoing contract" }).check();
    await expect(page.getByRole("radio", { name: "Quarterly" })).toBeVisible();
    await page.getByRole("radio", { name: "Quarterly" }).check();

    await engagement.getByRole("radio", { name: "Call-off" }).check();
    await expect(page.getByRole("radio", { name: "Quarterly" })).toHaveCount(0);
  });

  test("matches on a verified licence and coverage of the site, and the button states the match — AC5, AC6", async ({ page }) => {
    await page.goto(BRIEF);
    await expect(page.getByText("Choose where the site is and this shows who the brief would go to.")).toBeVisible();

    await site(page).selectOption({ label: "Deira" });
    await expect(rail(page).getByRole("listitem")).toHaveCount(2);
    await expect(rail(page)).toContainText("Emirates Facilities Group");
    await expect(rail(page)).toContainText("Al Shirawi Facilities");
    // Al Quoz only, and an unverified licence: neither is a recipient.
    await expect(rail(page)).not.toContainText("Khansaheb Facilities");
    await expect(page.getByText("Sand and Steel Services")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send to 2 suppliers" })).toBeVisible();
    await expect(page.getByText(/Only 2 suppliers match/)).toBeVisible();

    await site(page).selectOption({ label: "Anywhere in Dubai" });
    await expect(page.getByRole("button", { name: "Send to 3 suppliers" })).toBeVisible();
    await expect(page.getByText(/Up to 8 suppliers of Hard FM & MEP maintenance who work in Dubai/)).toBeVisible();
  });

  test("offers the emirate when an area found nobody, rather than a dead end", async ({ page }) => {
    await page.goto(BRIEF);
    await site(page).selectOption({ label: "Ajman Free Zone · free zone" });
    await expect(page.getByText(/No supplier with a verified licence has listed Ajman Free Zone yet\. 1 works elsewhere in Ajman\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send the brief" })).toBeDisabled();

    await page.getByRole("button", { name: "Send to suppliers across Ajman" }).click();
    await expect(rail(page)).toContainText("Northern Cooling Services");
    await expect(page.getByRole("button", { name: "Send to 1 supplier" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Match Ajman Free Zone only" })).toBeVisible();
  });

  test("arrives from 1f-s with the site answered and the cursor in question 02", async ({ page }) => {
    await page.goto("/rfq/new?category=hard-fm&kind=services&emirate=sharjah");
    await expect(site(page)).toHaveValue("emirate:sharjah");
    await expect(page.getByRole("textbox", { name: "What needs doing?" })).toBeFocused();
    await expect(rail(page)).toContainText("Emirates Facilities Group");
  });

  test("warns once, before the first file, that every recipient can open it — AC9", async ({ page }) => {
    await page.goto(BRIEF);
    await site(page).selectOption({ label: "Anywhere in Dubai" });
    await page.getByRole("button", { name: "Attach a file" }).click();
    const warning = page.getByRole("group", { name: "Every supplier this goes to can open these files" });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText("3 firms will each hold a copy");

    const chooser = page.waitForEvent("filechooser");
    await warning.getByRole("button", { name: "Choose files" }).click();
    await (await chooser).setFiles({ name: "asset-register.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") });
    await expect(page.getByRole("list", { name: "Files attached to this brief" })).toContainText("asset-register.pdf");

    // Once: the second file goes straight to the chooser.
    const again = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Attach another" }).click();
    await again;
    await expect(warning).toHaveCount(0);
  });

  test("sends one brief, verbatim, and carries an empty scale as an answer — AC2, AC7, AC8, AC10", async ({ page }) => {
    const typed = "Two towers.\n\n  1. Quarterly PPM on chillers\n  2. A 24/7 reactive line";
    await page.goto(BRIEF);
    await site(page).selectOption({ label: "Deira" });
    await page.getByRole("textbox", { name: "Building or plot" }).fill("Tower B");
    await page.getByRole("textbox", { name: "What needs doing?" }).fill(typed);
    await page.getByRole("radio", { name: "Ongoing contract" }).check();
    await page.getByRole("radio", { name: "Monthly" }).check();
    await page.getByRole("radio", { name: "As soon as possible" }).check();
    await page.getByLabel("Your name").fill("Rania Haddad");
    await page.getByLabel("Your mobile").fill(`05${Date.now().toString().slice(-8)}`);
    // B9, said where the buyer decides.
    await expect(page.getByText(/Your number, email and company stay hidden until you accept a proposal/)).toBeVisible();

    await page.getByRole("button", { name: "Send to 2 suppliers" }).click();
    await page.waitForURL(/\/enquiry\/[^/?]+\?.*sent=1/);

    const card = page.getByRole("region", { name: "Your brief" }).or(page.locator("section").filter({ hasText: "Your brief" })).first();
    await expect(card.getByText("Hard FM & MEP maintenance")).toBeVisible();
    expect(await card.locator("p.whitespace-pre-wrap").innerText()).toBe(typed);
    await expect(card.getByText("Deira, Dubai · Tower B")).toBeVisible();
    await expect(card.getByText("Ongoing contract · Monthly")).toBeVisible();
    await expect(card.getByText("Not given — suppliers may ask")).toBeVisible();

    // Sent to every match; nothing offers firms that do not cover the site.
    await expect(page.getByRole("link", { name: /Add two more suppliers|Send to \d+ more/ })).toHaveCount(0);
    // The action row is desktop-only; the link is in the DOM either way and must carry the token.
    await expect(page.locator('a[href*="/rfq/new?revise="]')).toHaveAttribute("href", /revise=ENQ-\d+&t=/);
  });

  test("goes to a named firm alone, from its storefront", async ({ page }) => {
    await page.goto("/rfq/new?to=meridian-chartered-accountants&service=statutory-audit");
    await expect(page.getByText("Only Meridian Chartered Accountants sees this brief.")).toBeVisible();
    await expect(page.getByRole("radio", { name: "Ongoing contract" })).toBeChecked();
    await expect(page.getByRole("button", { name: /^Send to Meridian Chartered Accountants$/ })).toBeDisabled();
    // Visible only: below 768px the same reason sits in the sticky bar instead.
    await expect(page.getByText("Choose where the site is first.").filter({ visible: true })).toHaveCount(1);
  });

  test("leaves the goods composer as it was", async ({ page }) => {
    await page.goto("/rfq/new?category=valves-and-fittings");
    await expect(page.getByRole("heading", { level: 1, name: "Request a quote" })).toBeVisible();
    await expect(page.locator("table")).toHaveCount(1);
  });

  test("is noindex, follow — AC12", async ({ page }) => {
    await page.goto(BRIEF);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /(?<!no)follow/);
  });

  test("has no axe violations at the acceptance width", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(BRIEF);
    await site(page).selectOption({ label: "Anywhere in Dubai" });
    await expect(rail(page).getByRole("listitem")).toHaveCount(3);
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
