/**
 * Which rows of `_prisma_migrations` mean "applied", which mean "stop", and
 * which mean nothing at all.
 *
 * The distinction is not academic. Production carries two rolled-back rows for
 * `20260827120000_storefront_templates` — a datatype mismatch and a duplicate
 * column on 2026-08-26, each resolved with `prisma migrate resolve`, followed
 * by an attempt that finished. Counting those as failures made `pnpm db:deploy`
 * refuse on a database whose history is in good order.
 */
import { describe, expect, it } from "vitest";

import { classify, type MigrationRow } from "@/scripts/pending-migrations.mjs";

const row = (
  migration_name: string,
  finished_at: Date | null,
  rolled_back_at: Date | null,
): MigrationRow => ({ migration_name, finished_at, rolled_back_at });

const AT = new Date("2026-08-26T11:22:14Z");

describe("classify", () => {
  it("counts a finished migration as applied", () => {
    expect(classify([row("a", AT, null)])).toEqual({ applied: ["a"], failed: [] });
  });

  it("counts an unfinished, unresolved migration as failed", () => {
    expect(classify([row("a", null, null)])).toEqual({ applied: [], failed: ["a"] });
  });

  it("counts a rolled-back migration as neither", () => {
    // Rolling back is what resolving looks like. Prisma does not block on it.
    expect(classify([row("a", null, AT)])).toEqual({ applied: [], failed: [] });
  });

  it("reads production's shape as clean", () => {
    // Two resolved attempts and a third that finished, all one migration.
    const result = classify([
      row("20260827120000_storefront_templates", null, AT),
      row("20260827120000_storefront_templates", null, AT),
      row("20260827120000_storefront_templates", AT, null),
    ]);

    expect(result.failed).toEqual([]);
    expect(result.applied).toEqual(["20260827120000_storefront_templates"]);
  });

  it("leaves a rolled-back migration with no later success out of applied", () => {
    // So it comes back as pending, which is what it is — Prisma re-attempts it.
    const result = classify([row("a", null, AT), row("b", AT, null)]);

    expect(result.applied).toEqual(["b"]);
    expect(result.failed).toEqual([]);
  });

  it("does not let a rolled-back row hide a genuine failure", () => {
    const result = classify([row("a", null, AT), row("b", null, null)]);

    expect(result.failed).toEqual(["b"]);
  });

  it("says nothing about an empty history", () => {
    expect(classify([])).toEqual({ applied: [], failed: [] });
  });
});
