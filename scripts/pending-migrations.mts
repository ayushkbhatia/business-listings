/**
 * What is about to be applied to a database, and who wrote it.
 *
 * `prisma migrate deploy` applies **every** pending migration, not the one the
 * person running it has in mind. On 2026-09-03 that shipped `_testimonial`
 * (from #64) to production as a side effect of whoever deployed #66 or #68 —
 * an unrelated session shipped a schema change it had not reviewed and did not
 * know existed. It was additive and therefore harmless. A `DROP COLUMN` would
 * have travelled the same path unobserved.
 *
 * `prisma migrate status` already lists the pending names. What it cannot say
 * is where each came from, which is exactly the fact that was missing. Git has
 * it: the squash-merge commit that first added a migration directory carries
 * the author, the date and the PR number in its subject.
 *
 * So this reads three things and joins them:
 *
 *   1. `_prisma_migrations` in the target database — what is already applied
 *   2. `prisma/migrations/` on disk — what this checkout has
 *   3. `git log --diff-filter=A` per pending directory — who added it, in which PR
 *
 * plus a scan of each pending `migration.sql` for statements that lose data or
 * take a heavy lock, so the operator reads the risk before the name.
 *
 * Read-only. One connection, two queries at most, closed in a `finally`.
 *
 * Docs: docs/deployments.md § Schema does not deploy with the code.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { config as loadEnv } from "dotenv";
import { Client } from "pg";

import { type Finding, type Severity, scan } from "./migration-sql.mjs";

// The same load order as prisma.config.ts, and for the same reason: the Prisma
// CLI does not read .env.local by itself. dotenv does not override a variable
// that is already set, so an explicit `DIRECT_URL=… pnpm db:pending` still wins
// — which is how CI and any local Supabase run point this somewhere safe.
loadEnv({ path: [".env.local", ".env"], quiet: true });

const MIGRATIONS_DIR = "prisma/migrations";

export type Pending = {
  name: string;
  /** Null when the directory is not committed yet — a migration written locally. */
  commit: { sha: string; author: string; date: string; subject: string; pr: number | null } | null;
  findings: Finding[];
};

export type Report = {
  target: string;
  /** On disk, not yet applied. In the order Prisma will apply them. */
  pending: Pending[];
  /** Applied in the database but absent from this checkout — the checkout is behind. */
  unknown: string[];
  /** Started and never finished. `migrate deploy` refuses to run until these are resolved. */
  failed: string[];
};

const LABEL: Record<Severity, string> = {
  loss: "DATA LOSS",
  rewrite: "REWRITES ",
  lock: "LOCKS    ",
};

/** The commit that first added a migration directory. Null while it is uncommitted. */
function attribute(name: string): Pending["commit"] {
  let line: string;
  try {
    line = execFileSync(
      "git",
      [
        "log",
        "--diff-filter=A",
        "--format=%H%x1f%an%x1f%as%x1f%s",
        "-1",
        "--",
        `${MIGRATIONS_DIR}/${name}/migration.sql`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    // No git, or a shallow clone with no history for this path. Not fatal —
    // the migration is still reported, just without a provenance line.
    return null;
  }

  if (line === "") return null;

  const [sha, author, date, subject] = line.split("\x1f");
  if (sha === undefined || author === undefined || date === undefined || subject === undefined) {
    return null;
  }

  // A squash merge puts the PR number at the end of the subject: `… (#64)`.
  const pr = /\(#(\d+)\)\s*$/.exec(subject)?.[1];

  return { sha, author, date, subject, pr: pr === undefined ? null : Number(pr) };
}

/** `postgresql://user:pw@host:5432/db` → `host:5432/db`. Never the password. */
export function describeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return "an unparseable connection string";
  }
}

export async function report(): Promise<Report> {
  const url = process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error("Neither DIRECT_URL nor DATABASE_URL is set. Nothing to inspect.");
  }

  const onDisk = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const client = new Client({ connectionString: url });
  await client.connect();

  let applied: string[];
  let failed: string[];
  try {
    // `to_regclass` rather than a caught error: a fresh database has no
    // `_prisma_migrations` at all, and that is a normal state, not a failure.
    const exists = await client.query<{ present: string | null }>(
      "select to_regclass('public._prisma_migrations')::text as present",
    );
    if (exists.rows[0]?.present == null) {
      applied = [];
      failed = [];
    } else {
      const rows = await client.query<{ migration_name: string; done: boolean }>(
        `select migration_name,
                (finished_at is not null and rolled_back_at is null) as done
           from _prisma_migrations
          order by started_at`,
      );
      applied = rows.rows.filter((row) => row.done).map((row) => row.migration_name);
      failed = rows.rows.filter((row) => !row.done).map((row) => row.migration_name);
    }
  } finally {
    await client.end();
  }

  const appliedSet = new Set(applied);
  const diskSet = new Set(onDisk);

  const pending: Pending[] = onDisk
    .filter((name) => !appliedSet.has(name))
    .map((name) => ({
      name,
      commit: attribute(name),
      findings: scan(readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8")),
    }));

  return {
    target: describeTarget(url),
    pending,
    unknown: applied.filter((name) => !diskSet.has(name)),
    failed,
  };
}

export function print(result: Report): void {
  console.log(`\n  target   ${result.target}`);

  if (result.failed.length > 0) {
    console.log(`\n  ${result.failed.length} migration(s) started and never finished:`);
    for (const name of result.failed) console.log(`    ${name}`);
    console.log("  `prisma migrate deploy` will refuse to run until these are resolved.");
  }

  if (result.unknown.length > 0) {
    console.log(
      `\n  ${result.unknown.length} migration(s) applied there but absent here — this checkout is behind:`,
    );
    for (const name of result.unknown) console.log(`    ${name}`);
  }

  if (result.pending.length === 0) {
    // "matches" would be a lie while `unknown` holds anything — that is the
    // database being ahead of this checkout, not the two agreeing.
    const verdict =
      result.unknown.length > 0
        ? "Nothing here is pending."
        : "Nothing pending. The database matches this checkout.";
    console.log(`\n  ${verdict}\n`);
    return;
  }

  console.log(`\n  ${result.pending.length} migration(s) pending, applied in this order:\n`);

  for (const item of result.pending) {
    console.log(`  ${item.name}`);
    if (item.commit === null) {
      console.log("    added by  not committed yet — this migration exists only here");
    } else {
      const pr = item.commit.pr === null ? item.commit.sha.slice(0, 7) : `#${item.commit.pr}`;
      console.log(`    added by  ${pr} · ${item.commit.author} · ${item.commit.date}`);
      console.log(`              ${item.commit.subject}`);
    }
    for (const finding of item.findings) {
      const statement =
        finding.statement.length > 96
          ? `${finding.statement.slice(0, 93)}...`
          : finding.statement;
      console.log(`    ${LABEL[finding.severity]} L${finding.line}  ${statement}`);
    }
    console.log("");
  }
}

/** Anything a person should look at twice before typing yes. */
export function risky(result: Report): Finding[] {
  return result.pending.flatMap((item) =>
    item.findings.filter((finding) => finding.severity !== "lock"),
  );
}

// Run the report when invoked directly; stay quiet when imported by db-deploy.
if (process.argv[1]?.endsWith("pending-migrations.mts") === true) {
  report()
    .then(print)
    .catch((error: unknown) => {
      console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
