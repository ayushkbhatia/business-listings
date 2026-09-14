/**
 * Criterion 11: *"every console mutation writes an audit row."*
 *
 * `staffMutation` is the only path that writes one, and nothing structurally
 * stops a future admin service calling `prisma.business.update` directly — no
 * test, no lint rule, no migration. The roadmap says a static check is the only
 * thing that makes this criterion true rather than aspirational.
 *
 * The rule, and it is deliberately narrow:
 *
 *   1. No file under `app/(admin)` may call a Prisma mutation itself. A screen
 *      that writes is a screen that skipped the service layer, and the audit
 *      row goes with it.
 *   2. Every module those screens reach that calls a Prisma mutation must also
 *      call `staffMutation`.
 *
 * Reachability is followed through `@/lib/**` imports rather than assumed from
 * a list, because a list is a thing somebody forgets to add to. Depth is
 * bounded: a service three hops from a screen is not the console mutating, it
 * is the console reading something that happens to write.
 *
 * ## What this does not catch
 *
 * It is per module, not per call site. A new function added to a service that
 * already calls `staffMutation` somewhere else can write directly and this will
 * still pass — proved with a decoy, and left as it is: a per-call-site check
 * needs a real module graph rather than a regex, and the failure it would catch
 * is one a reviewer sees in the diff. What it does catch is the case a reviewer
 * misses, which is a whole new module nobody thought about.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const ADMIN = join(ROOT, "app/(admin)");

const MUTATION =
  /\b(?:prisma|tx)\.[a-zA-Z]+\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;
/*
 * Value imports only.
 *
 * `import type { ModeratedField } from "@/lib/listing/service"` pulls nothing
 * at runtime, so a module reached only that way is not reachable from the
 * console at all — it was the first false positive this check produced.
 */
const IMPORT = /(?<!import\s+type\s*\{[^}]*\}\s*)from\s+["'](@\/lib\/[^"']+)["']/g;

/**
 * Modules that mutate without an audit row, and may.
 *
 * Each is a decision somebody made rather than an oversight, and each says why.
 * Adding to this list is the point at which somebody has to argue.
 */
const EXEMPT = new Map<string, string>([
  [
    "lib/audit/prisma-writer.ts",
    "Writes the audit row itself. Auditing the audit writer is a loop.",
  ],
  [
    "lib/notify/service.ts",
    "Records deliveries and preferences. A notification going out is not a staff decision, and NotificationDelivery is its own record.",
  ],
  [
    "lib/notify/events.ts",
    "Same: emits notifications for things that already happened elsewhere.",
  ],
  [
    "lib/domains/service.ts",
    "The DNS poller writes what it found. Nobody decided it; a resolver did.",
  ],
  [
    "lib/billing/dunning-job.ts",
    "The sequence following its own published schedule. AuditEvent.actorId is NOT NULL because a log of decisions should only hold decisions.",
  ],
  [
    "lib/metrics/job.ts",
    "Derived figures on a schedule. Nobody chose the number.",
  ],
  [
    "lib/metrics/strength-job.ts",
    "As above.",
  ],
  [
    "lib/db/queries/home.ts",
    "`recordSearch` appends a row to the search log on every public search. It is a buyer typing into a box, not a staff decision, and `AuditEvent.actorId` is NOT NULL because the audit log should hold decisions only. Its sibling `recordZeroResult` in queries/search.ts is the same write for the same reason.",
  ],
  [
    "lib/placement/term.ts",
    "A slot ending because the subscription under it ended. The three callers are the cancellation applier, the scheduled-change applier and the dunning drop, all of them crons following a published sequence — the same shape as `lib/verification/expiry-job.ts`, which CLAUDE.md names as correct without an audit row. `AuditEvent.actorId` is NOT NULL because the log holds decisions, and nobody decided this: the seller decided to cancel, and that decision is already logged where it was made. The `PlacementSlot` row keeps its own dates, and a credit note is a numbered document, so both halves stay evidenced.",
  ],
  [
    "lib/auth/flow.ts",
    "The sign-in flow: creating a profile at first sign-in and mirroring roles into the JWT claim. It is reached from the console only through `repairClaims`, which board 11i's reopen and withdraw call after their own `staffMutation` has written the audit row for the decision — the claim mirror is a cache of that decision, not a second one.",
  ],
  [
    "lib/accounts/segments.ts",
    "Board 4f's saved segments: a name and a canonical query string, shared by the console. Saving or deleting one changes nothing about any account — the next open runs the query again — so it is a bookmark several people can use, the call `SavedSearch` makes for a buyer. `AuditEvent` holds decisions about the directory, and this is not one.",
  ],
  [
    "lib/staff/activity.ts",
    "Board 4i's \"Last active\": a timestamp `requireStaff()` writes after the response, at most every five minutes. It measures that somebody used the console; nobody decided the value, and `AuditEvent.actorId` is NOT NULL because the log holds decisions. The staff state changes themselves are in lib/staff/service.ts, which audits every one.",
  ],
  [
    "lib/crm/service.ts",
    "Board 12d's call work: claiming a task, logging what a seller said on a call that happened outside the system, revealing a lead's number, taking a held page's calls. None changes the directory — no listing, plan or tier moves — and each is its own record with the staff id and the time: the task's lock, `call_outcome`, `crm_contact_reveal`. A *closed down* outcome closes the task and deliberately does not touch the listing. `AuditEvent` holds decisions about the directory, and these are not.",
  ],
  [
    "lib/crm/sync.ts",
    "Board 12d's derivation run: tasks opened and closed from signals the platform measured, written by the daily job or a refresh. Nobody decides a row, which is the board's whole claim, and `AuditEvent.actorId` is NOT NULL because the log holds decisions. Each run is recorded in `crm_sync_run`, naming who asked for a manual one.",
  ],
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function rel(path: string): string {
  return path.slice(ROOT.length + 1);
}

/** Resolve `@/lib/x` to a file on disk, trying the usual suffixes. */
function resolveImport(spec: string): string | null {
  const base = resolve(ROOT, spec.replace(/^@\//, ""));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not this one.
    }
  }
  return null;
}

const MAX_DEPTH = 2;
const reached = new Map<string, number>();

function follow(file: string, depth: number): void {
  if (depth > MAX_DEPTH) return;
  const seen = reached.get(file);
  if (seen !== undefined && seen <= depth) return;
  reached.set(file, depth);

  // Strip type-only imports before looking for value ones. A lookbehind cannot
  // span the newlines a multi-line `import type { … }` uses.
  const source = readFileSync(file, "utf8").replace(
    /import\s+type\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?/g,
    "",
  );
  for (const match of source.matchAll(IMPORT)) {
    const target = resolveImport(match[1]!);
    if (target) follow(target, depth + 1);
  }
}

let failures = 0;
const note = (line: string) => process.stdout.write(`${line}\n`);

note("→ 11. every console mutation writes an audit row");

// 1. No screen writes directly.
for (const file of walk(ADMIN)) {
  const source = readFileSync(file, "utf8");
  if (MUTATION.test(source)) {
    note(`   FAIL — ${rel(file)} calls Prisma directly. Console writes go through a service.`);
    failures += 1;
  }
  follow(file, 0);
}

// 2. Everything they reach that writes, audits.
const offenders: string[] = [];
for (const [file, depth] of reached) {
  if (depth === 0) continue;
  const path = rel(file);
  if (EXEMPT.has(path)) continue;
  const source = readFileSync(file, "utf8");
  if (MUTATION.test(source) && !source.includes("staffMutation")) offenders.push(path);
}

if (offenders.length > 0) {
  failures += offenders.length;
  note("   FAIL — reachable from the console, mutates, and writes no audit row:");
  for (const path of offenders.sort()) note(`     ${path}`);
  note("   Route it through staffMutation, or add it to EXEMPT with the reason.");
} else {
  const audited = [...reached.keys()].filter((file) => {
    const path = rel(file);
    return !EXEMPT.has(path) && MUTATION.test(readFileSync(file, "utf8"));
  }).length;
  note(`   pass — ${audited} modules the console can reach mutate, and every one audits`);
  note(`   note  ${EXEMPT.size} exempt, each with a written reason in the script`);
}

process.exit(failures === 0 ? 0 : 1);
