import { describe, expect, it } from "vitest";
import { decide } from "@/lib/db/schema-deployed";

/**
 * The guard that would have caught 2026-09-04.
 *
 * The decision lives in lib/db/schema-deployed.ts; scripts/check-schema-deployed.mts
 * is the half that talks to Postgres and to process.exitCode.
 *
 * Seven migrations pending, a production build, no override — the first test
 * below. Everything else here defends the two edges that decide whether this
 * guard survives contact with the team: it must not block a preview, and it
 * must not block the one pending migration `docs/deployments.md` says is
 * legitimate.
 */
const SEVEN = [
  "20260904094000_plan_withdrawn",
  "20260904100000_rate_limit_hit",
  "20260904110000_subscription_term",
  "20260904110100_plan_annual_term",
  "20260904110200_subscription_renewed_event",
  "20260904140000_claim_evidence_and_drafts",
  "20260904160000_category_cap_and_activity",
];

describe("the incident", () => {
  it("blocks a production build with migrations pending", () => {
    const verdict = decide({ isProductionBuild: true, pending: SEVEN, override: undefined });
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain("7 migration(s) pending");
  });
});

describe("fails towards deploying", () => {
  it("passes when nothing is pending", () => {
    expect(decide({ isProductionBuild: true, pending: [], override: undefined })).toEqual({
      blocked: false,
      reason: "the database has every migration in this checkout",
    });
  });

  it("passes a preview build even with migrations pending", () => {
    // A preview points at whatever the developer configured, and blocking there
    // would put friction on the path this guard is trying to protect.
    const verdict = decide({ isProductionBuild: false, pending: SEVEN, override: undefined });
    expect(verdict.blocked).toBe(false);
    expect(verdict.reason).toContain("not a production build");
  });

  it("passes when nothing is pending and it is not production either", () => {
    expect(decide({ isProductionBuild: false, pending: [], override: undefined }).blocked).toBe(
      false,
    );
  });
});

describe("ALLOW_PENDING_MIGRATIONS", () => {
  const DROP = ["20260910120000_drop_legacy_column"];

  it("lets through the after-merge DROP that names itself", () => {
    // docs/deployments.md § Ordering: a migration that drops or renames anything
    // is applied AFTER the merge, so it is legitimately pending during its build.
    const verdict = decide({ isProductionBuild: true, pending: DROP, override: DROP[0] });
    expect(verdict.blocked).toBe(false);
    expect(verdict.reason).toContain("names all 1 pending");
  });

  it("still blocks a migration the override does not name", () => {
    // The shape of the incident: four PRs' worth of migrations accumulated one
    // at a time. An override for the intentional one must not wave through the
    // six somebody forgot.
    const verdict = decide({
      isProductionBuild: true,
      pending: [...DROP, "20260911090000_something_nobody_applied"],
      override: DROP[0],
    });
    expect(verdict.blocked).toBe(true);
    expect(verdict.reason).toContain("20260911090000_something_nobody_applied");
    expect(verdict.reason).toContain("does not name 1 of the 2");
  });

  it("accepts a comma, whitespace or newline separated list", () => {
    for (const sep of [",", " ", ", ", "\n"]) {
      const verdict = decide({
        isProductionBuild: true,
        pending: SEVEN,
        override: SEVEN.join(sep),
      });
      expect(verdict.blocked, sep).toBe(false);
    }
  });

  it("treats an empty or whitespace override as absent", () => {
    // `ALLOW_PENDING_MIGRATIONS=` set but blank is somebody clearing it, not
    // somebody unlocking everything.
    for (const override of ["", "   ", "\n"]) {
      expect(decide({ isProductionBuild: true, pending: SEVEN, override }).blocked).toBe(true);
    }
  });

  it("is not a boolean", () => {
    // The failure this prevents: `ALLOW_PENDING_MIGRATIONS=1` set once on the
    // project, silently covering every deploy afterwards.
    for (const override of ["1", "true", "yes"]) {
      const verdict = decide({ isProductionBuild: true, pending: SEVEN, override });
      expect(verdict.blocked, override).toBe(true);
    }
  });

  it("ignores an override naming migrations that are not pending", () => {
    // Stale value from a previous deploy. It names nothing real, so it unlocks
    // nothing.
    const verdict = decide({
      isProductionBuild: true,
      pending: SEVEN,
      override: "20260101000000_long_since_applied",
    });
    expect(verdict.blocked).toBe(true);
  });
});
