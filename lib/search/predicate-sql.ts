import { Prisma } from "@/lib/db/generated/client";
import { isCode, matchNeedle } from "./index-text";
import type { SearchQuery } from "./query";

/**
 * Task T2.2 — `businessWhere`, as SQL.
 *
 * The ranking has to be ordered in the database (see `score-sql.ts` for why),
 * and ordering by a computed score means one statement that filters, scores,
 * orders and pages. Prisma can order by a column and page; it cannot order by
 * an expression. So the predicate has to exist in SQL as well, and this is the
 * one duplication in the whole change.
 *
 * **It is a duplication, and that is the risk.** `businessWhere` is the one
 * function every count, chip and facet on a results page shares, which is the
 * property boards `10c`/`10c-s` are built on: a facet count that does not
 * respect the other filters is the classic mistake, and the only durable fix is
 * that there is one function. A second predicate that drifts would reintroduce
 * exactly that, silently, with the list and its own counts disagreeing.
 *
 * So the control is not review, it is `predicate-sql-parity.test.ts`: a battery
 * of queries run through both predicates against the 41,000-row harness, with
 * the matched id sets asserted **equal**. A clause added to one and not the
 * other fails it, which is the same shape `lib/i18n/vocabulary.ts` uses to stay
 * equal to the shell script it mirrors.
 *
 * Every clause below is in `businessWhere`'s order and names the branch it
 * mirrors, so the two read side by side.
 *
 * ## The table alias
 *
 * Every expression is written against `b`, and the caller supplies
 * `FROM business b`. The sub-selects name their own tables.
 */

/** `PUBLIC_BUSINESS` — suspended is not public, and neither is unpublished. */
export const PUBLIC_BUSINESS_SQL = Prisma.sql`b.suspended_at IS NULL AND b.published_at IS NOT NULL`;

/** `tokens()` — lowercased, whitespace-split, eight at most. */
export function tokensOf(q: string): string[] {
  return q
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .slice(0, 8);
}

/**
 * Prisma's `contains` with `mode: "insensitive"`, which is `ILIKE %needle%`.
 *
 * **Unescaped, on purpose.** `%` and `_` in a token are wildcards to `LIKE`,
 * and the first draft of this escaped them — which is the safer behaviour and
 * is *not* what the predicate it mirrors does. Prisma's `contains`
 * parameterises the needle without escaping, so `a_b` matches `a`, any
 * character, `b` on every surface in the product today; checked directly
 * against this database rather than assumed.
 *
 * So this matches Prisma, and the parity test pins it. A buyer typing `50%` or
 * `a_b` getting wildcard semantics is a real defect, but it is a *product*
 * defect on every search surface, with its own counts and chips to keep in
 * step — fixing it quietly inside a change whose whole promise is that nothing
 * is reordered or re-matched would be the wrong place. It is written up for the
 * plan instead.
 */
function contains(column: Prisma.Sql, needle: string): Prisma.Sql {
  return Prisma.sql`${column} ILIKE ${`%${needle}%`}`;
}

/**
 * One query token, as the `OR` of the branches `businessWhere` gives it.
 *
 * The order is that function's: the match surface first, then the columns it
 * was built from, then the categories, then the live services. Codes get only
 * the surface and the services, because `matchNeedle` has padded them and
 * matching a code as a bare substring is criterion 2's failure — `DN10`
 * reaching a supplier whose catalogue carries `DN100`.
 */
function tokenSql(token: string): Prisma.Sql {
  const branches: Prisma.Sql[] = [contains(Prisma.sql`b.search_text`, matchNeedle(token))];

  if (!isCode(token)) {
    branches.push(
      contains(Prisma.sql`b.display_name`, token),
      contains(Prisma.sql`b.trade_name`, token),
      // The primary category's name or one of its synonyms — which is how an
      // Arabic query reaches an English listing.
      Prisma.sql`EXISTS (
        SELECT 1 FROM category c
        WHERE c.id = b.primary_category_id
          AND (${contains(Prisma.sql`c.name`, token)} OR ${token} = ANY (c.synonyms))
      )`,
      Prisma.sql`EXISTS (
        SELECT 1 FROM business_category bc
        JOIN category c ON c.id = bc.category_id
        WHERE bc.business_id = b.id
          AND (${contains(Prisma.sql`c.name`, token)} OR ${token} = ANY (c.synonyms))
      )`,
    );
  }

  /*
     The live services, for codes too and deliberately: `ISO 9001` and `EN 81`
     are words in a scope sentence rather than sizes in a spec table, and a firm
     and its service must not disagree about whether the words found them.
  */
  branches.push(Prisma.sql`EXISTS (
    SELECT 1 FROM service s
    WHERE s.business_id = b.id AND s.status = 'live'
      AND (
        ${contains(Prisma.sql`s.name`, token)}
        OR ${contains(Prisma.sql`s.scope`, token)}
        OR ${contains(Prisma.sql`s.deliverable`, token)}
        OR EXISTS (
          SELECT 1 FROM scope_field_value sv
          WHERE sv.service_id = s.id
            AND sv.field_key IN ('sectors', 'regulator')
            AND ${contains(Prisma.sql`sv.value`, token)}
        )
      )
  )`);

  return Prisma.sql`(${Prisma.join(branches, " OR ")})`;
}

/**
 * `placeWhere` — a firm is where its published branches are.
 *
 * A viewport is branch-only either way: it asks *who is here*, in coordinates,
 * and coverage has none. A supplier with no pin drops out of a bounded search,
 * which is correct rather than unfortunate.
 */
function placeSql(query: SearchQuery): Prisma.Sql | null {
  const filters: Prisma.Sql[] = [];
  if (query.bounds) {
    filters.push(
      Prisma.sql`l.lat >= ${query.bounds.south} AND l.lat <= ${query.bounds.north}`,
      Prisma.sql`l.lng >= ${query.bounds.west} AND l.lng <= ${query.bounds.east}`,
    );
  }
  if (query.emirate) filters.push(Prisma.sql`l.emirate = ${query.emirate}::"emirate"`);
  if (query.area) filters.push(Prisma.sql`a.slug = ${query.area}`);
  // A free zone narrows whatever area filter is already set rather than
  // replacing it — it is a cross-cutting toggle, not a place in the hierarchy.
  if (query.freeZone) filters.push(Prisma.sql`a.is_free_zone = true`);
  if (filters.length === 0) return null;

  return Prisma.sql`EXISTS (
    SELECT 1 FROM location l
    LEFT JOIN area a ON a.id = l.area_id
    WHERE l.business_id = b.id AND l.published = true
      AND ${Prisma.join(filters, " AND ")}
  )`;
}

/**
 * `specWhere` — the spec facets, and **one product must satisfy all of them**.
 *
 * Every constraint inside a single `EXISTS`, not one per field: a supplier
 * stocking a DN100 brass valve and a DN50 cast-iron one does not stock a DN100
 * cast-iron valve, and a rail that said they did would answer a different
 * question from the one the two chips describe.
 *
 * `spec_values` is `jsonb`. Prisma's `path: [field], equals: value` is
 * `->> field = value`, and its `array_contains: [value]` is `-> field @>
 * '[value]'`, which is how a multiselect stores its answers.
 */
function specSql(query: SearchQuery): Prisma.Sql | null {
  const constraints = Object.entries(query.spec ?? {})
    .filter(([, values]) => values.length > 0)
    .map(([fieldId, values]) =>
      Prisma.sql`(${Prisma.join(
        values.map(
          (value) => Prisma.sql`(p.spec_values ->> ${fieldId} = ${value}
            OR (jsonb_typeof(p.spec_values -> ${fieldId}) = 'array'
                AND p.spec_values -> ${fieldId} @> ${JSON.stringify([value])}::jsonb))`,
        ),
        " OR ",
      )})`,
    );
  if (constraints.length === 0) return null;

  return Prisma.sql`EXISTS (
    SELECT 1 FROM product p
    WHERE p.business_id = b.id AND p.status <> 'draft'
      AND ${Prisma.join(constraints, " AND ")}
  )`;
}

/**
 * The whole filter, as one boolean expression against `b`.
 *
 * `categoryIds` is the page's category set where there is one — primary **or**
 * additional, which is decision N14's answer: the count takes the list's own
 * predicate, so a borrowed listing counted is a borrowed listing listed.
 */
export function businessPredicateSql(
  query: SearchQuery,
  categoryIds?: readonly string[],
  now: Date = new Date(),
): Prisma.Sql {
  const and: Prisma.Sql[] = [PUBLIC_BUSINESS_SQL];

  if (categoryIds?.length) {
    const ids = Prisma.join(categoryIds.map((id) => Prisma.sql`${id}`), ", ");
    and.push(Prisma.sql`(
      b.primary_category_id IN (${ids})
      OR EXISTS (
        SELECT 1 FROM business_category bc
        WHERE bc.business_id = b.id AND bc.category_id IN (${ids})
      )
    )`);
  }

  for (const token of tokensOf(query.q)) and.push(tokenSql(token));

  if (query.tier) and.push(Prisma.sql`b.verification_tier >= ${query.tier}`);
  if (query.yearsTrading) {
    // `new Date().getFullYear()` in `businessWhere`; passed in here so the
    // parity test can pin a year rather than race the calendar.
    and.push(Prisma.sql`b.established_year <= ${now.getFullYear() - query.yearsTrading}`);
  }
  if (query.replyWithinHours) {
    and.push(Prisma.sql`b.response_time_median_ms <= ${query.replyWithinHours * 3_600_000}`);
  }

  const place = placeSql(query);
  if (place) and.push(place);

  if (query.availability?.length) {
    const values = Prisma.join(
      query.availability.map((value) => Prisma.sql`${value}::"availability"`),
      ", ",
    );
    and.push(Prisma.sql`EXISTS (
      SELECT 1 FROM product p
      WHERE p.business_id = b.id AND p.status <> 'draft' AND p.availability IN (${values})
    )`);
  }

  const spec = specSql(query);
  if (spec) and.push(spec);

  return Prisma.join(and, " AND ");
}
