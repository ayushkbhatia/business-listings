import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Board 4i — `/admin/staff`, from an ops lead's session.
 *
 * Mutations touch only the fixtures `prisma/seed-staff-roster.mts` made for this
 * file — `staff.fixture.role@`, `staff.fixture.leaver@` and the invitation to
 * `staff.fixture.revoke@` — so no other staff spec can find a row it expected
 * gone. Each mutating test tolerates a retry that finds its work already done:
 * CI retries twice, and a deactivation that succeeded on the first attempt is a
 * deactivated fixture on the second.
 */

const ROLE_FIXTURE_ID = "00000000-0000-4000-8000-000000000006";
const REASON = "Acceptance suite, board 4i: exercising the staff console against its fixtures.";

async function openStaff(page: Page) {
  await page.goto("/admin/staff");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Staff & roles");
}

function roster(page: Page) {
  return page.getByRole("table", { name: "Staff and outstanding invitations" });
}

test.describe("board 4i — who can do what", () => {
  test("states three roles and one retired, and claims no single sign-on", async ({ page }) => {
    await openStaff(page);
    await expect(page.getByText(/3 roles · 1 retired/)).toBeVisible();
    await expect(page.getByText(/SSO/)).toHaveCount(0);
  });

  test("draws no field verifier column, and only ops lead may set a tier", async ({ page }) => {
    await openStaff(page);
    const matrix = page.getByRole("table", { name: "What each staff role may do" });
    // Group headings are column-group headers inside the body; the head row is the columns.
    await expect(matrix.locator("thead th")).toHaveText(["Capability", "OPS", "MOD", "FIN"]);
    await expect(page.getByText(/Field verifier was retired on/)).toBeVisible();
    const tier = matrix.getByRole("row", { name: /Set verification tier/ });
    await expect(tier.getByText("Granted", { exact: true })).toHaveCount(1);
    await expect(tier.getByText("Not granted", { exact: true })).toHaveCount(2);
  });

  test("says how much of the list it is showing, and the number is the rows", async ({ page }) => {
    await openStaff(page);
    const rows = roster(page).locator("tbody tr");
    const count = await rows.count();
    await expect(page.getByText(new RegExp(`^Showing all ${count}: `))).toBeVisible();
  });

  test("marks an expired invitation and offers to resend it", async ({ page }) => {
    await openStaff(page);
    const row = roster(page).getByRole("row", { name: /lapsed\.finance@businesslistings\.me/ });
    await expect(row.getByText(/Invitation expired/)).toBeVisible();
    await expect(row.getByRole("button", { name: "Resend" })).toBeVisible();
  });

  test("offers no role control on your own row", async ({ page }) => {
    await openStaff(page);
    const self = roster(page).getByRole("row", { name: /You\. Another ops lead changes your role/ });
    await expect(self).toHaveCount(1);
    await expect(self.getByRole("button", { name: "Change role" })).toHaveCount(0);
  });

  test("has no axe violations at the acceptance viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openStaff(page);
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe("board 4i — changing who can do what", () => {
  test("refuses a change with no written reason, in the dialog", async ({ page }) => {
    await openStaff(page);
    const row = roster(page).getByRole("row", { name: /Role Change Fixture/ });
    await row.getByRole("button", { name: "Change role" }).click();
    const dialog = page.getByRole("dialog", { name: /Change Role Change Fixture's role/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("radio", { name: /^Ops lead$/ }).check();
    await dialog.getByRole("button", { name: "Change role" }).click();
    await expect(dialog.getByText(/Write a reason of at least four characters/)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("changes a role, shows what it gains and loses, and logs the consequence", async ({ page }) => {
    await openStaff(page);
    const row = roster(page).getByRole("row", { name: /Role Change Fixture/ });
    const current = (await row.getByText(/^(Moderator|Finance)$/).textContent())?.trim();
    const next = current === "Finance" ? "Moderator" : "Finance";

    await row.getByRole("button", { name: "Change role" }).click();
    const dialog = page.getByRole("dialog", { name: /Change Role Change Fixture's role/ });
    await dialog.getByRole("radio", { name: new RegExp(`^${next}$`) }).check();
    await expect(dialog.getByText("Gains")).toBeVisible();
    await expect(dialog.getByText("Loses")).toBeVisible();
    await dialog.getByRole("textbox").fill(REASON);
    await dialog.getByRole("button", { name: "Change role" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("Role changed. It applies on their next request.")).toBeVisible();
    await expect(roster(page).getByRole("row", { name: /Role Change Fixture/ }).getByText(next, { exact: true })).toBeVisible();

    await page.goto(`/admin/audit?subject=User:${ROLE_FIXTURE_ID}&action=staff_role_changed`);
    await expect(page.getByText(/changed a staff role · Role Change Fixture/).first()).toBeVisible();
    await expect(page.getByText(REASON).first()).toBeVisible();
  });

  test("revokes an outstanding invitation", async ({ page }) => {
    await openStaff(page);
    const row = roster(page).getByRole("row", { name: /staff\.fixture\.revoke@businesslistings\.me/ });
    test.skip((await row.count()) === 0, "Revoked by an earlier attempt of this test.");
    await row.locator("summary").click();
    await row.getByRole("button", { name: "Revoke" }).click();
    const dialog = page.getByRole("dialog", { name: "Revoke this invitation" });
    await dialog.getByRole("textbox").fill(REASON);
    await dialog.getByRole("button", { name: "Revoke" }).click();
    await expect(dialog).toBeHidden();
    await expect(roster(page).getByRole("row", { name: /staff\.fixture\.revoke@/ })).toHaveCount(0);
  });

  test("deactivates a member of staff, who stays listed as deactivated", async ({ page }) => {
    await openStaff(page);
    const row = roster(page).getByRole("row", { name: /Deactivation Fixture/ });
    if ((await row.count()) > 0) {
      await row.locator("summary").click();
      await row.getByRole("button", { name: "Deactivate" }).click();
      const dialog = page.getByRole("dialog", { name: "Deactivate Deactivation Fixture" });
      await expect(dialog.getByText("Loses")).toBeVisible();
      await dialog.getByRole("textbox").fill(REASON);
      await dialog.getByRole("button", { name: "Deactivate" }).click();
      await expect(dialog).toBeHidden();
    }
    await page.getByRole("tab", { name: /Deactivated/ }).click();
    await expect(
      page.getByRole("table", { name: "Staff accounts that were deactivated" }).getByRole("row", { name: /Deactivation Fixture/ }),
    ).toBeVisible();
  });

  test("refuses an invitation off the staff domain, and records one on it", async ({ page }) => {
    await openStaff(page);
    await page.getByRole("button", { name: "Invite staff" }).click();
    const dialog = page.getByRole("dialog", { name: "Invite a member of staff" });
    await dialog.getByRole("textbox", { name: /Work email/ }).fill("contractor@vendor.ae");
    await dialog.getByRole("radio", { name: /^Moderator$/ }).check();
    await dialog.getByRole("textbox", { name: /Reason/ }).fill(REASON);
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(dialog.getByText("Staff invitations go only to addresses on businesslistings.me.")).toBeVisible();

    const email = `acceptance.${Date.now()}@businesslistings.me`;
    await dialog.getByRole("textbox", { name: /Work email/ }).fill(email);
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByRole("dialog", { name: "Invitation recorded" })).toBeVisible();
    await page.getByRole("dialog", { name: "Invitation recorded" }).getByRole("button", { name: "Done" }).click();
    await expect(roster(page).getByRole("row", { name: new RegExp(email.replace(/\./g, "\\.")) })).toBeVisible();
  });
});

test.describe("board 4i — the log", () => {
  test("filters, pages and exports what it shows", async ({ page }) => {
    await page.goto("/admin/audit?action=staff_invited");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Audit log");
    await expect(page.getByText(/^Showing 1–\d+ of \d+$/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Export these entries" })).toHaveAttribute(
      "href",
      "/admin/audit/export?action=staff_invited",
    );

    const response = await page.request.get("/admin/audit/export?action=staff_invited");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    const lines = (await response.text()).trim().split("\r\n");
    expect(lines[0]).toContain("at_utc,actor_id,actor,action");
    expect(lines.slice(1).every((line) => line.includes(",staff_invited,"))).toBe(true);
  });

  test("has no edit or delete control on any row", async ({ page }) => {
    await page.goto("/admin/audit");
    await expect(page.getByRole("button", { name: /edit|delete|remove entry/i })).toHaveCount(0);
  });

  test("has no axe violations at the acceptance viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/admin/audit");
    const results = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
    expect(results.violations).toEqual([]);
  });
});
