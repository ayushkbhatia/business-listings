import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import type { Prisma } from "@/lib/db/generated/client";
import { en } from "@/lib/i18n/en";
import {
  PAIRED_LOCALE,
  PAIRED_STRINGS,
  pairedEntry,
  pairingCount,
  resolveHalf,
  type EntryRow,
  type HalfState,
  type PairedString,
  type PairingCount,
  type TradeHalf,
} from "@/lib/i18n/paired";
import { valueProblem, type ValueProblem } from "@/lib/i18n/paired-value";
import { readEntryRows } from "./store";

/**
 * Board `12g-s` — reading and writing the halves of paired strings.
 *
 * Three writes, each an audited staff mutation under `strings.write` with a
 * reason, serialised per key and refused as `stale` when the half moved since
 * the editor opened:
 *
 *   - **write** words for a half. Only placeholders the consumer supplies, no
 *     word the vocabulary rules ban — the scan cannot see a database row, so
 *     the save runs it (`Q1`).
 *   - **suppress** the services half, where the registry allows it (`B2`).
 *   - **restore** a half to the code's default, by deleting the row.
 *
 * There is no create. A row can only be written for a key `lib/i18n/paired.ts`
 * declares, which is what keeps the store auditable (`B10`).
 */

export type StringRefusal = ValueProblem["error"] | "not_found" | "stale" | "unchanged" | "not_suppressible" | "nothing_to_restore";

export type StringResult =
  | { ok: true; state: HalfState | "restored" }
  | { ok: false; error: StringRefusal; detail?: ValueProblem["detail"] };

class Refused extends Error {
  constructor(readonly refusal: Extract<StringResult, { ok: false }>) {
    super(refusal.error);
  }
}

const refuse = (error: StringRefusal, detail?: Extract<StringResult, { ok: false }>["detail"]) =>
  new Refused({ ok: false, error, ...(detail ? { detail } : {}) });

// ── Reads ─────────────────────────────────────────────────────────────────────

export interface HalfView {
  state: HalfState;
  /** What the half renders now. Null only when suppressed. */
  template: string | null;
  source: "code" | "staff";
  /** What the code declares, for "restore" to say what it goes back to. */
  codeState: HalfState;
  codeTemplate: string | null;
  decidedAt: Date | null;
  decidedBy: string | null;
  /** The row's `updatedAt`, as the editor's `basedOn`. Null when no row. */
  version: string | null;
}

export interface PairedRow {
  key: string;
  surfaces: readonly string[];
  params: readonly string[];
  suppressible: boolean;
  goods: HalfView;
  services: HalfView;
}

export interface PairedBoard {
  rows: PairedRow[];
  count: PairingCount;
  /** Every key in the shipped catalogue — the "All" figure. One store, one total. */
  catalogueKeys: number;
}

interface StoredRow extends EntryRow {
  updatedById: string;
  updatedAt: Date;
}

function halfView(entry: PairedString, half: TradeHalf, rows: readonly StoredRow[], names: Map<string, string>): HalfView {
  const resolved = resolveHalf(entry, half, rows);
  const code = resolveHalf(entry, half, []);
  const row = rows.find((candidate) => candidate.key === entry.key && candidate.kind === half);
  return {
    state: resolved.state,
    template: resolved.template,
    source: resolved.source,
    codeState: code.state,
    codeTemplate: code.template,
    decidedAt: row?.updatedAt ?? null,
    decidedBy: row ? (names.get(row.updatedById) ?? null) : null,
    version: row ? row.updatedAt.toISOString() : null,
  };
}

export async function pairedBoard(locale: string = PAIRED_LOCALE): Promise<PairedBoard> {
  const rows: StoredRow[] = await prisma.stringEntry.findMany({
    where: { locale },
    orderBy: [{ key: "asc" }, { kind: "asc" }],
    select: { key: true, kind: true, state: true, value: true, updatedAt: true, updatedById: true },
  });
  const ids = [...new Set(rows.map((row) => row.updatedById))];
  const people = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } })
    : [];
  const names = new Map(people.map((person) => [person.id, person.fullName ?? person.email ?? person.id]));

  return {
    rows: PAIRED_STRINGS.map((entry) => ({
      key: entry.key,
      surfaces: entry.surfaces,
      params: entry.params,
      suppressible: entry.suppressible,
      goods: halfView(entry, "goods", rows, names),
      services: halfView(entry, "services", rows, names),
    })),
    count: pairingCount(rows),
    catalogueKeys: Object.keys(en).length,
  };
}

/** The count alone, for a header that needs no rows. */
export async function pairingCountNow(locale: string = PAIRED_LOCALE): Promise<PairingCount> {
  return pairingCount(await readEntryRows(locale));
}

// ── Writes ────────────────────────────────────────────────────────────────────

interface HalfInput {
  actor: Actor;
  key: string;
  half: TradeHalf;
  reason: string;
  /** The half's `version` when the editor opened: the row's `updatedAt`, or null for none. */
  basedOn: string | null;
}

async function underLock<T>(
  input: HalfInput,
  run: (tx: Prisma.TransactionClient, entry: PairedString, row: StoredRow | null) => Promise<T>,
): Promise<T> {
  const entry = pairedEntry(input.key);
  if (!entry) throw refuse("not_found");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`string_entry:${input.key}`}))`;
    const row = await tx.stringEntry.findUnique({
      where: { key_locale_kind: { key: input.key, locale: PAIRED_LOCALE, kind: input.half } },
      select: { key: true, kind: true, state: true, value: true, updatedAt: true, updatedById: true },
    });
    if ((row?.updatedAt.toISOString() ?? null) !== input.basedOn) throw refuse("stale");
    return run(tx, entry, row);
  });
}

function snapshot(entry: PairedString, half: TradeHalf, row: StoredRow | null) {
  const resolved = resolveHalf(entry, half, row ? [row] : []);
  return { state: resolved.state, value: resolved.template, source: resolved.source };
}

async function handled(run: () => Promise<StringResult>): Promise<StringResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    throw error;
  }
}

export async function writeHalf(input: HalfInput & { value: string }): Promise<StringResult> {
  assertCan(input.actor, "strings.write");
  return handled(() =>
    underLock(input, async (tx, entry, row) => {
      const problem = valueProblem(entry, input.value);
      if (problem) throw refuse(problem.error, problem.detail);
      const value = input.value.trim();
      const before = snapshot(entry, input.half, row);
      if (before.state === "written" && before.value === value) throw refuse("unchanged");

      await staffMutation(
        {
          actor: input.actor,
          capability: "strings.write",
          action: "string_written",
          subject: `StringEntry:${entry.key}.${input.half}`,
          reason: input.reason,
          tx,
        },
        async () => {
          await tx.stringEntry.upsert({
            where: { key_locale_kind: { key: entry.key, locale: PAIRED_LOCALE, kind: input.half } },
            create: { key: entry.key, locale: PAIRED_LOCALE, kind: input.half, state: "written", value, updatedById: input.actor.id },
            update: { state: "written", value, updatedById: input.actor.id },
          });
          return { result: null, before, after: { state: "written", value, source: "staff" } };
        },
      );
      return { ok: true, state: "written" } as const;
    }),
  );
}

export async function suppressHalf(input: HalfInput): Promise<StringResult> {
  assertCan(input.actor, "strings.write");
  return handled(() =>
    underLock(input, async (tx, entry, row) => {
      if (input.half !== "services" || !entry.suppressible) throw refuse("not_suppressible");
      const before = snapshot(entry, input.half, row);
      if (before.state === "suppressed") throw refuse("unchanged");

      await staffMutation(
        {
          actor: input.actor,
          capability: "strings.write",
          action: "string_suppressed",
          subject: `StringEntry:${entry.key}.${input.half}`,
          reason: input.reason,
          tx,
        },
        async () => {
          await tx.stringEntry.upsert({
            where: { key_locale_kind: { key: entry.key, locale: PAIRED_LOCALE, kind: input.half } },
            create: { key: entry.key, locale: PAIRED_LOCALE, kind: input.half, state: "suppressed", value: null, updatedById: input.actor.id },
            update: { state: "suppressed", value: null, updatedById: input.actor.id },
          });
          return { result: null, before, after: { state: "suppressed", value: null, source: "staff" } };
        },
      );
      return { ok: true, state: "suppressed" } as const;
    }),
  );
}

export async function restoreHalf(input: HalfInput): Promise<StringResult> {
  assertCan(input.actor, "strings.write");
  return handled(() =>
    underLock(input, async (tx, entry, row) => {
      if (!row) throw refuse("nothing_to_restore");
      const before = snapshot(entry, input.half, row);
      const after = snapshot(entry, input.half, null);

      await staffMutation(
        {
          actor: input.actor,
          capability: "strings.write",
          action: "string_restored",
          subject: `StringEntry:${entry.key}.${input.half}`,
          reason: input.reason,
          tx,
        },
        async () => {
          await tx.stringEntry.delete({ where: { key_locale_kind: { key: entry.key, locale: PAIRED_LOCALE, kind: input.half } } });
          return { result: null, before, after };
        },
      );
      return { ok: true, state: "restored" } as const;
    }),
  );
}
