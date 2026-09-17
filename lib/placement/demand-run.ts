import { Prisma } from "@/lib/db/generated/client";
import type { Emirate } from "@/lib/db/generated/enums";
import { dubaiDayStart } from "@/lib/format";
import { bandScopes, type ScopeSignal } from "./bands";

/**
 * Cutting the demand bands, against whichever client is handed in.
 *
 * The nightly route runs it on the app's client and the seed runs it on its
 * own, so there is one classifier and nowhere for a second to drift. A seeded
 * database therefore reads exactly what the first of the month would have
 * written, rather than a hand-copied table of bands somebody guessed.
 *
 * No `server-only` here, for exactly that reason: the seed runs under Node and
 * not under the react-server condition, and `server-only` throws there. The
 * wrapper in `demand.ts` keeps the guard.
 */

/** How far back a run scores. A quarter, so one quiet month cannot reprice a trade. */
export const DEMAND_WINDOW_DAYS = 90;

export interface DemandRow {
  categoryId: string;
  emirate: Emirate | null;
  band: number;
  score: number;
  appearances: number;
  clicks: number;
  measuredFrom: Date;
  measuredTo: Date;
}

export interface DemandRunResult {
  /** Scopes classified. */
  scopes: number;
  /** How many of those had any measured traffic at all. */
  measured: number;
  measuredFrom: Date;
  measuredTo: Date;
  /** Scopes whose band moved this run, so the report is about change. */
  moved: number;
  ranAt: Date;
}

interface RawSignal {
  category_id: string;
  emirate: Emirate | null;
  appearances: bigint | number;
  clicks: bigint | number;
}

const asNumber = (value: bigint | number | null): number => (value === null ? 0 : Number(value));

/**
 * Every scope with traffic in the window, and how much.
 *
 * One statement rather than two reads joined in JavaScript, because the two
 * tables have different shapes — one is per listing and needs collapsing before
 * it can be compared with the other — and doing that collapse in SQL keeps the
 * "maximum, not sum" rule in one place.
 */
export async function scopeSignals(
  db: Prisma.TransactionClient,
  from: Date,
  to: Date,
): Promise<ScopeSignal[]> {
  const rows = await db.$queryRaw<RawSignal[]>`
    WITH loads AS (
      SELECT "category_id", "emirate", "day", MAX("impressions") AS day_loads
        FROM "category_position_day"
       WHERE "day" >= ${from}::date AND "day" <= ${to}::date
       GROUP BY "category_id", "emirate", "day"
    ),
    appearances AS (
      SELECT "category_id", "emirate", SUM(day_loads)::bigint AS appearances
        FROM loads
       GROUP BY "category_id", "emirate"
    ),
    clicks AS (
      SELECT "category_id", "emirate", SUM("clicks")::bigint AS clicks
        FROM "scope_click_day"
       WHERE "day" >= ${from}::date AND "day" <= ${to}::date
       GROUP BY "category_id", "emirate"
    )
    SELECT COALESCE(a."category_id", c."category_id")           AS category_id,
           COALESCE(a."emirate", c."emirate")                   AS emirate,
           COALESCE(a.appearances, 0)::bigint                   AS appearances,
           COALESCE(c.clicks, 0)::bigint                        AS clicks
      FROM appearances a
      FULL OUTER JOIN clicks c
        ON a."category_id" = c."category_id"
       AND a."emirate" IS NOT DISTINCT FROM c."emirate"
  `;

  return rows.map((row) => ({
    categoryId: row.category_id,
    emirate: row.emirate,
    appearances: asNumber(row.appearances),
    clicks: asNumber(row.clicks),
  }));
}

/**
 * Classify every scope and write the bands.
 *
 * Scopes with no traffic at all are not written. A row saying "band 1, score 0"
 * for every trade in every emirate would be seven thousand rows asserting a
 * measurement nobody took, and the read path already answers an absent row
 * correctly: not measured, priced at the floor. The table holds what was
 * measured and nothing else.
 */
export async function runDemandBandsIn(
  db: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<DemandRunResult> {
  const to = dubaiDayStart(now);
  const from = new Date(to.getTime() - DEMAND_WINDOW_DAYS * 86_400_000);

  const [signals, before] = await Promise.all([
    scopeSignals(db, from, to),
    db.scopeDemandBand.findMany({ select: { categoryId: true, emirate: true, band: true } }),
  ]);

  const banded = bandScopes(signals);
  const wasBand = new Map(before.map((row) => [`${row.categoryId}:${row.emirate ?? ""}`, row.band]));
  let moved = 0;

  for (const scope of banded) {
    const key = `${scope.categoryId}:${scope.emirate ?? ""}`;
    if (wasBand.get(key) !== scope.band) moved += 1;

    /*
       Raw, because the conflict target is a partial unique index.

       `emirate` is nullable and Postgres treats two NULLs as distinct, so the
       country-wide scope needs its own arm — the same pair
       `recordCategoryPositions` writes through, for the same reason.
    */
    const values = Prisma.sql`
      ${`sdb_${scope.categoryId}_${scope.emirate ?? "all"}`.slice(0, 60)},
      ${scope.categoryId}, ${scope.emirate}::"emirate", ${scope.band}, ${scope.score},
      ${scope.appearances}, ${scope.clicks}, ${from}::date, ${to}::date, NOW()
    `;
    const update = Prisma.sql`
      SET "band" = EXCLUDED."band", "score" = EXCLUDED."score",
          "appearances" = EXCLUDED."appearances", "clicks" = EXCLUDED."clicks",
          "measured_from" = EXCLUDED."measured_from", "measured_to" = EXCLUDED."measured_to",
          "computed_at" = EXCLUDED."computed_at"
    `;

    if (scope.emirate === null) {
      await db.$executeRaw`
        INSERT INTO "scope_demand_band" ("id", "category_id", "emirate", "band", "score", "appearances", "clicks", "measured_from", "measured_to", "computed_at")
        VALUES (${values})
        ON CONFLICT ("category_id") WHERE "emirate" IS NULL DO UPDATE ${update}
      `;
    } else {
      await db.$executeRaw`
        INSERT INTO "scope_demand_band" ("id", "category_id", "emirate", "band", "score", "appearances", "clicks", "measured_from", "measured_to", "computed_at")
        VALUES (${values})
        ON CONFLICT ("category_id", "emirate") WHERE "emirate" IS NOT NULL DO UPDATE ${update}
      `;
    }
  }

  return {
    scopes: banded.length,
    measured: banded.filter((scope) => scope.score > 0).length,
    measuredFrom: from,
    measuredTo: to,
    moved,
    ranAt: now,
  };
}
