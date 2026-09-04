import { config as loadEnv } from "dotenv";
import { defineConfig, devices } from "@playwright/test";
import { assertLocalTarget } from "./lib/db/target";

// The config decides which projects exist from the environment, so it has to
// read .env.local before it does. CI supplies the same names as secrets.
loadEnv({ path: [".env.local", ".env"], quiet: true });

/*
   The suite writes, so it has to be told which database it is writing to.

   Sign-in provisions users and deletes them by email; the console specs suspend
   listings, move verification tiers and remove a review, which is irreversible
   by design. Against the hosted database that is real moderation history
   written by a test run. Relative import, not `@/` — Playwright loads this
   config before any tsconfig path mapping applies. See lib/db/target.ts.
*/
assertLocalTarget("run the end-to-end suite, which writes and deletes rows");

const PORT = 3000;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * The seller projects need a real sign-in, which needs the Supabase admin API.
 * Without a service key they are not registered at all, rather than registered
 * and skipping — a suite that silently covers less than it claims is worse
 * than one that is visibly smaller.
 */
const canSignIn = Boolean(
  process.env.SUPABASE_SECRET_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL,
);

if (!canSignIn) {
  console.warn(
    "[playwright] the seller projects are not registered: set SUPABASE_SECRET_KEY " +
      "and NEXT_PUBLIC_SUPABASE_URL to cover /dashboard.",
  );
}

const SELLER_STATE = "tests/e2e/.auth/seller.json";
/** Board 11a only exists for a plan with a cap, so it needs its own session. */
const FREE_SELLER_STATE = "tests/e2e/.auth/seller-free.json";
/*
 * Two staff sessions. The moderator one exists to prove a negative — criterion
 * 9's claim that the console does not offer them the tier, credit or suspend
 * controls — and a negative asserted from an ops lead's session proves nothing.
 */
const OPS_LEAD_STATE = "tests/e2e/.auth/staff-ops.json";
const MODERATOR_STATE = "tests/e2e/.auth/staff-moderator.json";
const FINANCE_STATE = "tests/e2e/.auth/staff-finance.json";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",
  use: {
    baseURL,
    trace: "on-first-retry",
    timezoneId: "Asia/Dubai",
    locale: "en-AE",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // The dashboard needs a signed-in seller; the seller projects own it.
      // `pricing-seller` is a public page read with a session, which is the
      // same requirement for a different reason — board 1l criterion 10.
      testIgnore: /(dashboard|overview|catalogue|listing|account|onboarding|admin|pricing-seller)[\w-]*\.spec\.ts/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testIgnore: /(dashboard|overview|catalogue|listing|account|onboarding|admin|pricing-seller)[\w-]*\.spec\.ts/,
    },
    ...(canSignIn
      ? [
          { name: "setup", testMatch: /auth\.setup\.ts/ },
          {
            name: "seller",
            testMatch: /(dashboard|overview|catalogue|listing|account|onboarding|pricing-seller)[\w-]*\.spec\.ts/,
            testIgnore: /overview-free\.spec\.ts/,
            dependencies: ["setup"],
            use: { ...devices["Desktop Chrome"], storageState: SELLER_STATE },
          },
          {
            name: "seller-free",
            testMatch: /overview-free\.spec\.ts/,
            dependencies: ["setup"],
            use: { ...devices["Desktop Chrome"], storageState: FREE_SELLER_STATE },
          },
          {
            name: "staff",
            testMatch: /admin[\w-]*\.spec\.ts/,
            testIgnore: /admin-(moderator|commercials)\.spec\.ts/,
            dependencies: ["setup"],
            use: { ...devices["Desktop Chrome"], storageState: OPS_LEAD_STATE },
          },
          {
            name: "staff-moderator",
            testMatch: /admin-moderator\.spec\.ts/,
            dependencies: ["setup"],
            use: { ...devices["Desktop Chrome"], storageState: MODERATOR_STATE },
          },
          /*
           * §07 puts `revenue.read` with finance and gives ops lead a dash, so
           * the commercial screens are unreachable from the ops-lead seat by
           * design. They get their own project rather than a relaxed capability.
           */
          {
            name: "staff-finance",
            testMatch: /admin-commercials\.spec\.ts/,
            dependencies: ["setup"],
            use: { ...devices["Desktop Chrome"], storageState: FINANCE_STATE },
          },
        ]
      : []),
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm build && pnpm start",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
});
