/**
 * Reading a migration's SQL for the statements a person should see before it
 * runs. No database, no environment — `scripts/pending-migrations.mts` supplies
 * both, and `tests/unit/migration-sql.test.ts` supplies neither.
 *
 * The tiers exist to drive one decision: whether `pnpm db:deploy` asks for the
 * word `apply` or the words `apply destructive`. `loss` and `rewrite` escalate
 * it. `lock` is reported and does not — a heavy lock is worth reading about and
 * is not a reason to type a longer word.
 */

export type Severity = "loss" | "rewrite" | "lock";

export type Finding = {
  severity: Severity;
  line: number;
  statement: string;
};

/**
 * Ordered worst-first: the first rule a statement matches is the one reported,
 * so a statement that both drops a column and takes a lock reads as the drop.
 *
 * `INSERT INTO` is deliberately absent. Adding rows is the one data statement
 * that cannot destroy anything, and every migration that seeds a singleton row
 * would otherwise escalate the confirmation for nothing.
 */
const RULES: ReadonlyArray<{ severity: Severity; pattern: RegExp }> = [
  { severity: "loss", pattern: /\bDROP\s+(TABLE|SCHEMA|DATABASE)\b/i },
  { severity: "loss", pattern: /\bDROP\s+COLUMN\b/i },
  { severity: "loss", pattern: /\bDROP\s+TYPE\b/i },
  { severity: "loss", pattern: /\bTRUNCATE\b/i },
  { severity: "loss", pattern: /\bDELETE\s+FROM\b/i },
  { severity: "rewrite", pattern: /\bUPDATE\s+"?\w+"?\s+SET\b/i },
  { severity: "lock", pattern: /\bALTER\s+COLUMN\b[\s\S]*\bSET\s+NOT\s+NULL\b/i },
  { severity: "lock", pattern: /\bALTER\s+COLUMN\b[\s\S]*\bTYPE\b/i },
  { severity: "lock", pattern: /\bRENAME\s+(TO|COLUMN|CONSTRAINT)\b/i },
  { severity: "lock", pattern: /\bDROP\s+CONSTRAINT\b/i },
  { severity: "lock", pattern: /\bADD\s+CONSTRAINT\b[\s\S]*\bCHECK\b/i },
  { severity: "lock", pattern: /\bDROP\s+(INDEX|FUNCTION|TRIGGER|VIEW)\b/i },
];

type Statement = {
  line: number;
  /** Verbatim, whitespace collapsed. What a finding prints. */
  text: string;
  /** The same statement with string literals elided. What the rules match. */
  match: string;
};

/**
 * Split SQL into statements, dropping comments and remembering where each one
 * began. The line numbers are the point of it: a finding prints `L171`, and
 * that number has to open the file at the statement it names.
 *
 * Three things a naive implementation gets wrong on this repo's SQL:
 *
 *   - Ten migrations define a function or a `DO` block, and every semicolon
 *     inside `$$ … $$` belongs to the body rather than ending a statement.
 *   - These migrations explain themselves at length and quote the statements
 *     they replace — `20260827030000_dunning_start_date` prints the old `CHECK`
 *     constraint in prose above the new one — so matching raw text reports the
 *     explanation as a finding.
 *   - A string literal is data. `VALUES ('DROP TABLE "business"')` inserts a
 *     row; it does not drop a table. So `match` carries the statement with
 *     top-level literals elided, and the rules read that.
 *
 * A dollar-quoted body is not elided, because the literals inside one may be
 * dynamic SQL — `EXECUTE format('ALTER TABLE %I …')` is how
 * `20260823175500_harden_event_trigger_fn` works, and a `DROP` written that way
 * is a real `DROP`.
 */
export function statements(sql: string): Statement[] {
  const out: Statement[] = [];
  let text = "";
  let match = "";
  let line = 1;
  let startLine = 0;
  let index = 0;

  const push = (): void => {
    const collapsed = text.replace(/\s+/g, " ").trim();
    const matchable = match.replace(/\s+/g, " ").trim();
    text = "";
    match = "";
    if (collapsed !== "" && startLine !== 0) {
      out.push({ line: startLine, text: collapsed, match: matchable });
    }
    startLine = 0;
  };

  /** `elided` is what the rules see: the same span, or a stand-in for it. */
  const consume = (chunk: string, elided = chunk): void => {
    if (startLine === 0) startLine = line;
    line += (chunk.match(/\n/g) ?? []).length;
    text += chunk;
    match += elided;
    index += chunk.length;
  };

  while (index < sql.length) {
    const char = sql[index] ?? "";
    const pair = sql.slice(index, index + 2);

    if (pair === "--") {
      const newline = sql.indexOf("\n", index);
      index = newline === -1 ? sql.length : newline;
      continue;
    }

    if (pair === "/*") {
      const close = sql.indexOf("*/", index + 2);
      const end = close === -1 ? sql.length : close + 2;
      line += (sql.slice(index, end).match(/\n/g) ?? []).length;
      index = end;
      continue;
    }

    if (char === "\n") {
      line += 1;
      text += " ";
      match += " ";
      index += 1;
      continue;
    }

    // A string literal, with '' as the escape. Its contents are data: a `--` in
    // there is not a comment, a `;` does not end anything, and a `DROP` drops
    // nothing.
    if (char === "'") {
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === "'") {
          if (sql[end + 1] === "'") {
            end += 2;
            continue;
          }
          break;
        }
        end += 1;
      }
      consume(sql.slice(index, Math.min(end + 1, sql.length)), "''");
      continue;
    }

    // `$$ … $$` or `$tag$ … $tag$`. Taken whole and matched whole, so a DROP
    // inside a DO block still reads as a DROP — which it is.
    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(index));
    if (dollar !== null) {
      const tag = dollar[0];
      const close = sql.indexOf(tag, index + tag.length);
      consume(sql.slice(index, close === -1 ? sql.length : close + tag.length));
      continue;
    }

    if (char === ";") {
      push();
      index += 1;
      continue;
    }

    if (startLine === 0 && char.trim() !== "") startLine = line;
    text += char;
    match += char;
    index += 1;
  }

  push();

  return out;
}

/**
 * The first rule that matches wins, so the worst reading of a statement is the
 * one reported.
 *
 * Two `lock`-tier findings are then dropped, because both are noise rather than
 * risk and both are common here:
 *
 *   - a constraint added to a table the same migration creates. `ADD CONSTRAINT
 *     … CHECK` validates every existing row under an ACCESS EXCLUSIVE lock,
 *     which is worth knowing about — on a table that already holds rows.
 *     `20260823173500_invariant_constraints` would otherwise report seven.
 *   - `DROP INDEX IF EXISTS "x"` where the same file goes on to create `x`.
 *     That is the idempotency pattern docs/database.md requires of every
 *     hand-written index migration, not somebody dropping an index.
 */
export function scan(sql: string): Finding[] {
  const parsed = statements(sql);

  const created = new Set(
    parsed.flatMap((statement) => {
      const name = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w.]+)"?/i.exec(statement.match);
      return name?.[1] === undefined ? [] : [name[1]];
    }),
  );

  const indexed = new Set(
    parsed.flatMap((statement) => {
      const name = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?([\w.]+)"?/i.exec(
        statement.match,
      );
      return name?.[1] === undefined ? [] : [name[1]];
    }),
  );

  const findings: Finding[] = [];

  for (const statement of parsed) {
    for (const rule of RULES) {
      if (!rule.pattern.test(statement.match)) continue;

      if (rule.severity === "lock") {
        const table = /\bALTER\s+TABLE\s+(?:ONLY\s+)?"?([\w.]+)"?/i.exec(statement.match)?.[1];
        if (table !== undefined && created.has(table)) break;

        const dropped = /\bDROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?"?([\w.]+)"?/i.exec(
          statement.match,
        )?.[1];
        if (dropped !== undefined && indexed.has(dropped)) break;
      }

      findings.push({
        severity: rule.severity,
        line: statement.line,
        statement: statement.text,
      });
      break;
    }
  }

  return findings;
}
