import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));

/**
 * Two projects, because they need different worlds.
 *
 * `unit` is jsdom and mocks nothing it does not have to. `integration` is node
 * and talks to a real Postgres — it exists for the parts a unit test cannot
 * reach: what Prisma actually selects, and what a transaction actually writes.
 */
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias: { "@": root } },
        test: {
          name: "unit",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./tests/setup.ts"],
          include: ["tests/unit/**/*.test.{ts,tsx}", "lib/**/*.test.{ts,tsx}"],
          // Playwright owns tests/e2e; the integration project owns its own.
          exclude: ["tests/e2e/**", "tests/integration/**", "node_modules/**", ".next/**"],
        },
      },
      {
        resolve: {
          alias: {
            "@": root,
            // See tests/integration/server-only.stub.ts.
            "server-only": fileURLToPath(
              new URL("./tests/integration/server-only.stub.ts", import.meta.url),
            ),
          },
        },
        test: {
          name: "integration",
          environment: "node",
          globals: true,
          setupFiles: ["./tests/integration/setup.ts"],
          include: ["tests/integration/**/*.test.ts"],
          // One database, shared. Parallel files would race on the rows they
          // write, and the suite is small enough that sequential is honest.
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
