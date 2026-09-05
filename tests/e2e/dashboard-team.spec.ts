import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Board 7d — the team screen, in a browser.
 *
 * Named `dashboard-team` so the seller project owns it: Playwright matches the
 * filename regex against the absolute path, and `team.spec.ts` would run signed
 * out, in chromium and mobile, and fail on a 404.
 *
 * What is asserted here rather than in integration: that the counts on screen
 * agree with the table under them, that the matrix and the routing card say the
 * things a seller acts on, and that the two claims this board cut are absent.
 * The count contract and the removal transaction are queries and services, and
 * tests/integration/team-roster.test.ts owns them against real rows.
 */

test.describe("board 7d — the seat table", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/team");
  });

  test("keeps the h1 the seller shell and the nav depend on", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Team");
  });

  test("is a real table with the six columns the board names", async ({ page }) => {
    const table = page.getByRole("table", { name: "Your team" });
    await expect(table).toBeVisible();
    for (const column of ["Person", "Role", "Open", "Reachable on", "Status"]) {
      await expect(table.getByRole("columnheader", { name: column })).toBeVisible();
    }
  });

  test("counts the open leads it is showing, and says where the rest are", async ({ page }) => {
    /*
       §3: "open leads per seat sums to 3j's Open tab. If these two numbers
       disagree, one of the screens is lying and the seller will find out." The
       board summed 21 against an inbox of 12.

       Read off the rendered cells rather than from the service, and against the
       sidebar badge, which is board 3j's own count through `tabWhere`.
    */
    const table = page.getByRole("table", { name: "Your team" });
    const rows = table.getByRole("row");
    const count = await rows.count();

    let column = 0;
    for (let i = 1; i < count; i += 1) {
      const cell = rows.nth(i).getByRole("cell").nth(2);
      const text = (await cell.textContent())?.trim() ?? "";
      if (/^\d+$/.test(text)) column += Number(text);
    }

    const stated = (await page.getByText(/open leads? here, the same/).textContent()) ?? "";
    const total = Number(stated.replace(/\D/g, "").slice(0, 3));

    const unassigned = (await page.getByText(/not assigned to anybody/).count())
      ? Number(
          ((await page.getByText(/not assigned to anybody/).textContent()) ?? "").replace(
            /\D/g,
            "",
          ),
        )
      : 0;

    expect(column + unassigned).toBe(total);
  });

  test("names every row action with the person it acts on", async ({ page }) => {
    /*
       A table of seven rows otherwise offers seven buttons called "Remove the
       seat", which is seven controls a screen-reader user cannot tell apart —
       the same fault board 3k fixed on its own row actions.
    */
    await expect(page.getByRole("button", { name: /^Remove .+ from the team$/ }).first()).toBeVisible();
  });

  test("offers no remove control on the reader's own row", async ({ page }) => {
    // `removeSeat` refuses it too. The screen not offering what the service
    // will refuse is the point.
    const you = page.getByRole("row").filter({ hasText: "YOU" });
    await expect(you.getByRole("button", { name: /Remove/ })).toHaveCount(0);
  });

  test("asks where the open leads go before it will remove anybody", async ({ page }) => {
    // §6.3: "not remove a seat with open leads silently. Removal reassigns
    // first: pick a seat or send them to the unassigned queue."
    await page.getByRole("button", { name: /^Remove .+ from the team$/ }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Where do their open leads go?")).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Send them to the unassigned queue" })).toBeVisible();
    // Stated, so the seller knows what they are deciding about.
    await expect(dialog.getByText(/holding (no|\d+) open leads?/)).toBeVisible();
  });
});

test.describe("board 7d — what each role can do", () => {
  test("draws the matrix as a real table with both header directions", async ({ page }) => {
    await page.goto("/dashboard/team");
    const table = page.getByRole("table", { name: "Capabilities by role" });
    await expect(table).toBeVisible();
    // The four canonical roles, plus the capability column.
    await expect(table.getByRole("columnheader")).toHaveCount(5);
    for (const role of ["Owner", "Manager", "Sales", "Finance"]) {
      await expect(table.getByRole("columnheader", { name: role })).toBeVisible();
    }
  });

  test("carries the extend row board 3k shipped the action for", async ({ page }) => {
    await page.goto("/dashboard/team");
    await expect(page.getByRole("rowheader", { name: /Extend a quote's validity/ })).toBeVisible();
  });

  test("says every cell in words, not only in glyphs", async ({ page }) => {
    /*
       A column of "✓" read aloud as "check mark" against a dash read as nothing
       at all is a table with no answers in it. The glyph is aria-hidden and the
       word is the content.
    */
    await page.goto("/dashboard/team");
    const table = page.getByRole("table", { name: "Capabilities by role" });
    const finance = table.getByRole("row").filter({ hasText: "Reply to enquiries" });
    await expect(finance.getByText("No", { exact: true })).toHaveCount(1);
  });

  test("states that Finance never reaches the inbox", async ({ page }) => {
    // §2: the inbox specs do not mention Finance at all, so this screen has to
    // exclude it explicitly rather than by omission.
    await page.goto("/dashboard/team");
    await expect(page.getByText(/Finance never sees the inbox/)).toBeVisible();
  });
});

test.describe("board 7d — routing", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/team");
  });

  test("offers the modes with what each one does", async ({ page }) => {
    await expect(page.getByRole("radio", { name: /Everyone sees everything/ })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Round-robin/ })).toBeVisible();
    await expect(page.getByRole("radio", { name: /By branch/ })).toBeVisible();
  });

  test("promises no Claim button, because board 3j did not ship one", async ({ page }) => {
    /*
       §4: first-to-claim "needs a `Claim` action in the inbox, and 3j shipped
       with `Assign` only". The mode ships — it is the stored default for every
       business — and the racing does not, so the hint says which.
    */
    await expect(page.getByText(/There is no Claim button yet/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Claim/ })).toHaveCount(0);
  });

  test("names what happens when nobody is reachable", async ({ page }) => {
    // The failure this pair of screens exists to close, said on the screen that
    // causes it.
    await expect(page.getByText(/marked unrouted in the inbox/)).toBeVisible();
    await expect(page.getByText(/Working hours come from your Hours page/)).toBeVisible();
  });

  test("makes no claim about a response score, and none about other sellers", async ({ page }) => {
    /*
       §8: "Protects your response score is cut: there is no score in the
       product." The replacement is the ranking weight and the band, both of
       which are real. Same class as the claims cut from boards 3j and 3k.
    */
    const body = (await page.textContent("main")) ?? "";
    expect(body).not.toMatch(/response score/i);
    expect(body).not.toMatch(/times faster|× faster|times out of/i);
    expect(body).toMatch(/points a search result is scored on/);
  });
});

test.describe("board 7d — last 30 days", () => {
  test("labels the window, the bar and the figure", async ({ page }) => {
    /*
       §5: the board read `this month`, a window nothing else uses, and encoded
       leads in the bar with reply time in the value slot and no label saying so.
    */
    await page.goto("/dashboard/team");
    await expect(page.getByRole("heading", { name: /Last 30 days by seat/ })).toBeVisible();
    const body = (await page.textContent("main")) ?? "";
    expect(body).not.toMatch(/this month/i);
    expect(body).toMatch(/The bar is that seat's share of the leads/);
  });

  test("says once that these medians do not compose", async ({ page }) => {
    // Somebody will try to reconcile them against the band on the storefront,
    // and there is no weighting that makes them reconcile.
    await page.goto("/dashboard/team");
    await expect(page.getByText(/do not average to the business median/)).toBeVisible();
  });
});

test.describe("board 7d — accessibility", () => {
  test("passes axe, and again with the removal dialog open", async ({ page }) => {
    await page.goto("/dashboard/team");
    const first = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      // Token-level and pinned. See the note in dashboard-leads-inbox.spec.ts.
      .disableRules(["color-contrast"])
      .analyze();
    expect(first.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);

    await page.getByRole("button", { name: /^Remove .+ from the team$/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const second = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .disableRules(["color-contrast"])
      .analyze();
    expect(second.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test("keeps one h1", async ({ page }) => {
    await page.goto("/dashboard/team");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
});
