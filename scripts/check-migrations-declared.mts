/**
 * A PR that adds a migration has to say so, in words, in the PR.
 *
 * `prisma migrate deploy` applies every pending migration rather than the one
 * the operator has in mind. That is not a bug and it is not going to change, so
 * the only defence is that an operator can see what is waiting and where each
 * piece came from. `pnpm db:pending` reads that out of git — but it can only
 * report a subject line that somebody wrote. On 2026-09-03 the subject was
 * "feat(auth): a door each for buyers, suppliers and staff, over one sign-in
 * flow (#64)", which is true and says nothing about the `testimonial` table
 * that shipped with it.
 *
 * So: name the migration in the PR title or body. A squash merge copies the
 * body into the commit, which makes `git log --grep=20260903132133_testimonial`
 * answer the question "when did this reach main, and with what".
 *
 * Two failures, both hard:
 *
 *   1. a migration directory added and never named
 *   2. a migration file **changed** that `main` already has. Prisma checksums
 *      every applied migration, so editing one that production has already run
 *      does not re-run it — it makes the next `migrate deploy` refuse outright.
 *      Write a new migration instead.
 *
 * Advisory when there is no PR to read: run locally with no `PR_TITLE` and it
 * prints the block to paste rather than failing. That is why `pnpm verify`
 * carries it — the answer arrives before the PR exists, not after CI says no.
 *
 * Docs: docs/deployments.md § Schema does not deploy with the code.
 */
import { execFileSync } from "node:child_process";

const DIR = "prisma/migrations";

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** The commit this branch left `main` at. CI passes it; locally it is resolved. */
function base(): string | null {
  const given = process.env["BASE_REF"];
  const candidates = given === undefined || given === "" ? ["origin/main", "main"] : [given];

  for (const candidate of candidates) {
    const resolved = git(["rev-parse", "--verify", `${candidate}^{commit}`]);
    if (resolved !== null) return git(["merge-base", resolved, "HEAD"]) ?? resolved;
  }

  return null;
}

function changed(filter: string, from: string): string[] {
  const out = git(["diff", "--name-only", `--diff-filter=${filter}`, from, "HEAD", "--", DIR]);
  if (out === null || out === "") return [];

  const names = out
    .split("\n")
    .map((path) => path.slice(DIR.length + 1).split("/")[0])
    .filter((name): name is string => name !== undefined && name !== "" && name !== "migration_lock.toml");

  return [...new Set(names)].sort();
}

console.log("→ migrations are declared");

const from = base();
if (from === null) {
  console.log("   skip — no base commit to compare against (shallow clone, or no main).");
  process.exit(0);
}

const added = changed("A", from);
const edited = changed("M", from);
let fail = 0;

if (edited.length > 0) {
  console.log("   FAIL — a migration `main` already has was edited:");
  for (const name of edited) console.log(`     ${name}`);
  console.log("     Prisma checksums applied migrations. Editing one does not re-apply it, it");
  console.log("     makes the next `migrate deploy` refuse. Write a new migration instead.");
  fail = 1;
}

if (added.length === 0) {
  if (fail === 0) console.log("   pass — this branch adds no migration");
  process.exit(fail);
}

// Read through the environment, never interpolated into a shell command: a PR
// title is attacker-controlled text on a repo that takes pull requests.
const declaration = `${process.env["PR_TITLE"] ?? ""}\n${process.env["PR_BODY"] ?? ""}`;
const block = `Migrations: ${added.join(", ")}`;

if (declaration.trim() === "") {
  console.log(`   advisory — this branch adds ${added.length} migration(s). The PR must name them:`);
  console.log("");
  console.log(`     ${block}`);
  console.log("");
  console.log("   Put that in the PR body. CI checks it there.");
  process.exit(fail);
}

const undeclared = added.filter((name) => !declaration.includes(name));

if (undeclared.length > 0) {
  console.log("   FAIL — this PR adds migrations the PR does not name:");
  for (const name of undeclared) console.log(`     ${name}`);
  console.log("");
  console.log("   Add this line to the PR body:");
  console.log("");
  console.log(`     ${block}`);
  console.log("");
  console.log("   The squash merge copies the body into the commit, which is what");
  console.log("   `pnpm db:pending` reads back to whoever deploys next. A migration nobody");
  console.log("   named is one that ships as somebody else's side effect.");
  fail = 1;
} else {
  console.log(`   pass — ${added.length} migration(s) added, all named in the PR`);
}

process.exit(fail);
