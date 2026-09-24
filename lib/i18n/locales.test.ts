import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EMIRATES } from "@/lib/uae";
import { LOCALE_PATH_PREFIX } from "./locales";

/**
 * Board `6a-s` D-AR — the locale prefix is reserved by construction.
 *
 * A landing URL's first segment is an emirate, and the emirates are a fixed
 * list. If an emirate value or a public top-level route ever took `ar`, the
 * translated pages would have nowhere to go without moving an English URL that
 * has ranking — which is the retrofit `6a` Q4 said to avoid.
 */
describe("the locale path prefix", () => {
  const reserved = Object.values(LOCALE_PATH_PREFIX) as string[];

  it("is not an emirate", () => {
    const values: string[] = EMIRATES.map((emirate) => emirate.value);
    for (const segment of reserved) expect(values).not.toContain(segment);
  });

  it("is not a public top-level route", () => {
    const routes = readdirSync(join(process.cwd(), "app/(public)"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("("))
      .map((entry) => entry.name);
    for (const segment of reserved) expect(routes).not.toContain(segment);
  });
});
