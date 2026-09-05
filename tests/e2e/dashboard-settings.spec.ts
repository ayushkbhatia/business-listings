import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 7e — the alerts screen, in a browser.
 *
 * Named `dashboard-settings` so the seller project owns it: Playwright matches
 * the filename regex against the absolute path, and `settings.spec.ts` would run
 * signed out, in chromium and mobile, and fail on a redirect.
 *
 * What is asserted here rather than in integration: that the screen states the
 * rules a seller acts on — where each event goes, what happens when nobody can
 * be reached, that an acknowledgement is not a reply — and that the claim §6 cut
 * is absent. The delivery rule and the verification round trip are services, and
 * tests/integration owns them against real rows.
 */

test.describe("board 7e — the event matrix", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/settings");
  });

  test("keeps the h1 the seller shell and the nav depend on", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Settings");
  });

  test("draws it as a real table with both header directions", async ({ page }) => {
    const table = page.getByRole("table", { name: /Notification channels by event/ });
    await expect(table).toBeVisible();
    // Event, who it goes to, and the four channels.
    await expect(table.getByRole("columnheader")).toHaveCount(6);
    await expect(table.getByRole("rowheader").first()).toBeVisible();
  });

  test("says who each event reaches, not only where", async ({ page }) => {
    /*
       §2's `GOES TO`. Rows of ticks with no statement of whose handset they
       reach, and the answer is not the same for every row.
    */
    const table = page.getByRole("table", { name: /Notification channels by event/ });
    const enquiry = table.getByRole("row").filter({ hasText: "A new enquiry arrives" });
    await expect(enquiry).toContainText("The assigned seat");
    const escalated = table.getByRole("row").filter({ hasText: "escalates to the owner" });
    await expect(escalated).toContainText("The owner");
  });

  test("names every cell, so forty checkboxes are not forty 'checkbox'", async ({ page }) => {
    await expect(
      page.getByRole("checkbox", { name: "WhatsApp for A new enquiry arrives" }),
    ).toBeVisible();
  });

  test("keeps in-app on for anything with a deadline", async ({ page }) => {
    /*
       §2.2: "a seller who turns off every channel still has a place the work
       appears." Checked and disabled, and `saveAlerts` puts it back regardless —
       a disabled checkbox posts nothing at all.
    */
    const locked = page.getByRole("checkbox", { name: /^In app is always on for/ });
    await expect(locked.first()).toBeChecked();
    await expect(locked.first()).toBeDisabled();
    await expect(page.getByText(/In app stays on for anything with a deadline/)).toBeVisible();
  });

  test("states what happens when nobody can be reached", async ({ page }) => {
    // §2.1, and the failure the whole handoff exists to close.
    await expect(page.getByText(/it goes to the owner instead. Nothing is dropped/)).toBeVisible();
  });

  test("writes down the precedence between escalation and quiet hours", async ({ page }) => {
    // §5: "the precedence has to be written down or the two features
    // contradict each other on the first night shift."
    await expect(page.getByText(/Escalation ignores quiet hours in the app/)).toBeVisible();
  });

  test("does not merge internal alerts with the buyer's own channel", async ({ page }) => {
    // §2.3. Outbound replies fan out over the channel the buyer used, which is
    // a different thing and is not set here.
    await expect(page.getByText(/Replies to a buyer go back on the channel the buyer used/)).toBeVisible();
  });

  test("makes no claim about what other sellers' channels do", async ({ page }) => {
    /*
       §6: `sellers who enable WhatsApp alerts reply 3.4× faster than those on
       email only`. Cut. Same class as board 3j's `fastest quote wins 61%` and
       the two claims cut from board 3k §8.
    */
    const body = (await page.textContent("main")) ?? "";
    expect(body).not.toMatch(/3\.4|×\s*faster|times faster/i);
    expect(body).not.toMatch(/sellers who/i);
  });
});

test.describe("board 7e — quiet hours and the acknowledgement", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/settings");
  });

  test("reads the working week off the Hours page rather than storing a second one", async ({
    page,
  }) => {
    // §5: one source for quiet hours, the acknowledgement and board 7d's
    // routing skip. A second copy is the contradiction that surfaces during
    // Ramadan.
    await expect(page.getByLabel("Hold WhatsApp and SMS outside your working hours")).toBeVisible();
    await expect(page.getByText(/no second copy of the week on this screen/)).toBeVisible();
  });

  test("carries the high-value override with the caveat on the number", async ({ page }) => {
    await expect(page.getByLabel("Enquiry value, in AED")).toBeVisible();
    // The figure is the buyer's own, and unverifiable. Board 3k §8 draws the
    // same line under the same kind of number.
    await expect(page.getByText(/what the buyer said they hoped to pay/)).toBeVisible();
  });

  test("says the acknowledgement is not a reply, on the card that offers it", async ({ page }) => {
    /*
       §4, the most consequential correction in either screen. If a template
       stamped the first reply, the band every buyer reads and the reply-time
       weight in ranking would both be won by installing one.
    */
    await expect(page.getByRole("heading", { name: /Out-of-hours acknowledgement/ })).toBeVisible();
    await expect(page.getByText(/an acknowledgement, not a reply/)).toBeVisible();
    await expect(page.getByText(/would be measuring a robot/)).toBeVisible();
  });

  test("names the three tokens without pretending there are more", async ({ page }) => {
    const body = (await page.textContent("main")) ?? "";
    expect(body).toContain("{buyer_name}");
    expect(body).toContain("{next_open_time}");
    expect(body).toContain("{whatsapp_number}");
  });

  test("shows one escalation interval in the words the team screen uses", async ({ page }) => {
    // One stored number, two screens. This one said "120 minutes" where the
    // team screen said "2 hours", so a seller had to do arithmetic to find out
    // whether the two agreed.
    await expect(page.getByLabel("Escalate after")).toBeVisible();
    const options = await page.getByLabel("Escalate after").locator("option").allTextContents();
    expect(options).toContain("2 hours");
    expect(options).not.toContain("120 minutes");
  });
});

test.describe("board 7e — can this seat be reached", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/settings?tab=channels");
  });

  test("is one row per seat, by kind and never by number", async ({ page }) => {
    /*
       Board 7d §6.1: "not show one seat's numbers to another seat." An owner
       needs to know a colleague is on email only; they do not need the mobile.
    */
    const table = page.getByRole("table", { name: /Verified channels by seat/ });
    await expect(table).toBeVisible();
    await expect(page.getByText(/never the number/)).toBeVisible();

    const body = (await table.textContent()) ?? "";
    expect(body).not.toMatch(/\+971\d/);
    expect(body).not.toMatch(/@/);
  });

  test("names the routing consequence of an unreachable seat", async ({ page }) => {
    await expect(page.getByText(/skipped by routing entirely/i)).toBeVisible();
  });

  test("offers the reader a way to prove their own channel", async ({ page }) => {
    // Without this the amber row on board 7d is a dead end: a seat told it is
    // not a routing target, with nothing that would make it one.
    await expect(page.getByRole("heading", { name: "Your channels" })).toBeVisible();
    await expect(page.getByLabel("Mobile or email")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send me a code" })).toBeVisible();
  });

  test("names each channel control with the channel it acts on", async ({ page }) => {
    const remove = page.getByRole("button", { name: /^Remove your .+ channel$/ });
    if ((await remove.count()) === 0) return;
    await expect(remove.first()).toBeVisible();
  });
});

test.describe("board 7e — accessibility", () => {
  for (const path of ["/dashboard/settings", "/dashboard/settings?tab=channels"]) {
    test(`${path} is axe clean`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        // Token-level and pinned. See the note in dashboard-leads-inbox.spec.ts.
        .disableRules(["color-contrast"])
        .analyze();
      const summary = results.violations.map((v) => `${v.id}: ${v.help}`);
      expect(summary, `${path}\n${summary.join("\n")}`).toEqual([]);
    });
  }

  test("keeps one h1 on both tabs", async ({ page }) => {
    for (const path of ["/dashboard/settings", "/dashboard/settings?tab=channels"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    }
  });
});
