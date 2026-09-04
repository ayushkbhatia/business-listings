/**
 * Whether a production build may ship while migrations are pending.
 *
 * The decision only — no database, no environment, no process. `lib/db/target.ts`
 * splits the same way and for the same reason: the interesting cases are an
 * override that names the wrong migration, a preview build, and a database
 * nobody configured, and those should be unit tests rather than something
 * somebody reasons about while production is down.
 *
 * `scripts/check-schema-deployed.mts` is the IO half, and the header there
 * carries the incident and the reasoning.
 */

/** What the guard decided, and the sentence it will print. */
export interface Verdict {
  blocked: boolean;
  reason: string;
}

/**
 * The decision, with no IO in it.
 *
 * Separated so the interesting cases — an override that names the wrong
 * migration, a preview build, a database nobody configured — are unit tests
 * rather than a thing somebody reasons about while production is down.
 */
export function decide(input: {
  /** True only for a Vercel production build. */
  isProductionBuild: boolean;
  /** Migration directory names on disk that the target database has not applied. */
  pending: readonly string[];
  /** `ALLOW_PENDING_MIGRATIONS`, which must name every migration it unlocks. */
  override: string | undefined;
}): Verdict {
  const { isProductionBuild, pending, override } = input;

  if (pending.length === 0) {
    return { blocked: false, reason: "the database has every migration in this checkout" };
  }

  if (!isProductionBuild) {
    return {
      blocked: false,
      reason: `${pending.length} migration(s) pending, and this is not a production build`,
    };
  }

  if (override !== undefined && override.trim() !== "") {
    /*
       Every pending migration has to be named. A deploy that unlocks one
       intentional `DROP` must not also wave through an additive migration
       somebody forgot — which is exactly the shape of the incident, where four
       PRs' worth of migrations accumulated one at a time.
    */
    const named = new Set(
      override
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
    const unnamed = pending.filter((name) => !named.has(name));

    if (unnamed.length === 0) {
      return {
        blocked: false,
        reason: `ALLOW_PENDING_MIGRATIONS names all ${pending.length} pending migration(s)`,
      };
    }

    return {
      blocked: true,
      reason:
        `ALLOW_PENDING_MIGRATIONS does not name ${unnamed.length} of the ` +
        `${pending.length} pending migration(s): ${unnamed.join(", ")}`,
    };
  }

  return {
    blocked: true,
    reason: `${pending.length} migration(s) pending against the target database`,
  };
}
