import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board `1d` amendment — the contact reveal, in place, in a browser.
 *
 * The rules are proven against a database in
 * `tests/integration/contact-reveal-leads.test.ts` and the island in
 * `tests/unit/contact-reveal-view.test.tsx`. What only a browser shows: the
 * number is not in what the server sends, the dialog is a modal in the
 * viewport with the page inert behind it, a dismissal leaves the page masked,
 * the revealed state survives a reload in the same session and not a new one,
 * and a visitor who answered once is not asked again.
 *
 * Every test starts from a fresh browser context, so a fresh visitor. Each
 * submit adds a phone lead to Al Marwan — rows beside the seeded ones, never a
 * change to them.
 */

const SELLER = "/b/al-marwan-industrial-supplies-llc";

function landlineChip(page: Page) {
  return page.getByRole("button", { name: /^Show the number 0\d \d\d• ••••$|^Call$/ }).first();
}

async function submitForm(page: Page, name = "Acceptance Buyer") {
  const dialog = page.getByRole("dialog", { name: "Access phone number in 30 seconds" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Work email").fill(`reveal.${Date.now()}.${Math.floor(Math.random() * 1e6)}@acceptance.test`);
  await dialog.getByLabel("Mobile").fill("50 000 1717");
  await dialog.getByRole("button", { name: "Show the number" }).click();
  await expect(dialog).toBeHidden();
}

test.describe("masked, and not in the page", () => {
  test("the server sends the mask and no number, in the markup or the structured data (B2)", async ({ page }) => {
    const response = await page.goto(SELLER);
    const html = (await response?.text()) ?? "";
    await expect(landlineChip(page)).toBeVisible();

    const local = (
      await page.$$eval('script[type="application/ld+json"]', (nodes) =>
        nodes.map((n) => JSON.parse(n.textContent ?? "{}") as Record<string, unknown>),
      )
    ).find((b) => b["@type"] === "LocalBusiness");
    expect(local?.["telephone"]).toBeUndefined();

    await landlineChip(page).click();
    await submitForm(page);
    const call = page.getByRole("link", { name: /^Call 0\d \d{3} \d{4}$/ }).or(page.locator("a[href^='tel:']")).first();
    const href = (await call.getAttribute("href")) ?? "";
    expect(href).toMatch(/^tel:\+971\d{8}$/);
    // The digits after the country code, in any form, were nowhere in the first response.
    const national = href.replace("tel:+971", "");
    expect(html).not.toContain(national);
    expect(html).not.toContain(`0${national.slice(0, 1)} ${national.slice(1, 4)} ${national.slice(4)}`);
  });

  test("WhatsApp opens the chat and never the form (B4)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "The row's WhatsApp link; the bar's is the same element type.");
    await page.goto(SELLER);
    const whatsapp = page.getByRole("link", { name: "WhatsApp" });
    if ((await whatsapp.count()) === 0) test.skip(true, "This fixture publishes no WhatsApp.");
    await expect(whatsapp.first()).toHaveAttribute("href", /^https:\/\/wa\.me\/971\d+$/);
  });
});

test.describe("the form", () => {
  test("opens as a modal centred in the viewport, and a dismissal leaves the page masked (B11, B13, B16)", async ({ page }) => {
    await page.goto(SELLER);
    await page.evaluate(() => window.scrollTo(0, 0));
    await landlineChip(page).click();

    const dialog = page.getByRole("dialog", { name: "Access phone number in 30 seconds" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Name")).toBeVisible();

    const box = await dialog.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    // Centred on the screen, not on the page box.
    expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(2);
    // The page behind does not scroll while it is open.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe("hidden");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(landlineChip(page)).toBeVisible();
    await expect(page.locator("a[href^='tel:']")).toHaveCount(0);
    await expect(page.getByText(/Counted as a lead in this seller's analytics/)).toHaveCount(0);
  });

  test("says what is wrong under each field on submit", async ({ page }) => {
    await page.goto(SELLER);
    await landlineChip(page).click();
    const dialog = page.getByRole("dialog", { name: "Access phone number in 30 seconds" });
    await dialog.getByLabel("Mobile").fill("04 883 4120");
    // Enter in a field submits, as a form does — the keyboard path, not only the button.
    await dialog.getByLabel("Mobile").press("Enter");
    await expect(dialog.getByText("Enter your name, so the supplier knows who asked.")).toBeVisible();
    await expect(dialog.getByText("Enter your work email, for example name@company.ae.")).toBeVisible();
    await expect(dialog.getByText(/Enter a UAE mobile starting 05/)).toBeVisible();
    await expect(dialog.getByLabel("Name")).toBeFocused();
  });
});

test.describe("revealed", () => {
  test("a tel: link and the note, kept for the session, masked again in a new one, and never asked twice (B6, B10)", async ({ browser, page }, testInfo) => {
    await page.goto(SELLER);
    await landlineChip(page).click();
    await submitForm(page);

    await expect(page.getByText("Counted as a lead in this seller's analytics, with the page you came from recorded as the source.")).toBeVisible();
    const tel = page.locator("a[href^='tel:']:visible").first();
    await expect(tel).toBeVisible();
    if (testInfo.project.name !== "mobile") {
      await expect(page.getByRole("link", { name: /^Call 0\d \d{3} \d{4}$/ })).toBeFocused();
    }

    // Same session: still revealed on a reload, with no form.
    await page.reload();
    await expect(page.locator("a[href^='tel:']:visible").first()).toBeVisible();
    await expect(page.getByText(/Counted as a lead in this seller's analytics/)).toBeVisible();

    // A new session for the same visitor: the persistent cookie, not the session one.
    const cookies = await page.context().cookies();
    const visitor = cookies.find((c) => c.name === "bl_vid");
    expect(visitor, "the form's submit sets the visitor cookie").toBeTruthy();
    expect(cookies.find((c) => c.name === "bl_rsid")?.expires).toBe(-1);

    const next = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: page.viewportSize(),
      ...(testInfo.project.name === "mobile" ? { isMobile: true, hasTouch: true } : {}),
    });
    await next.addCookies([visitor!]);
    const later = await next.newPage();
    await later.goto(SELLER);
    await expect(later.locator("a[href^='tel:']")).toHaveCount(0);
    await landlineChip(later).click();
    await expect(later.locator("a[href^='tel:']:visible").first()).toBeVisible();
    await expect(later.getByRole("dialog")).toBeHidden();
    await next.close();
  });

  test("one reveal is the listing's: the branches tab opens with it", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Covered once; the branches tab's own phone test is in branches.spec.ts.");
    await page.goto(SELLER);
    await landlineChip(page).click();
    await submitForm(page);
    await page.goto(`${SELLER}/branches`);
    await expect(page.locator("main a[href^='tel:']").first()).toBeVisible();
  });
});
