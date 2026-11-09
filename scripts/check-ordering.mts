/**
 * An ordered read that chooses rows must end its `orderBy` on a unique key.
 *
 * `created_at` is `TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP`, and
 * `CURRENT_TIMESTAMP` is the transaction's start time — so every row one
 * `createMany` writes shares one value, and 159 of 226 seeded products tie on
 * it. `sortOrder` columns default to 0, which makes every unreordered gallery a
 * single tie. An `orderBy` that stops on a column like that leaves Postgres free
 * to return tied rows in any order, and a read that then *cuts* the result —
 * `take`, `skip`, a `cursor`, `findFirst` — hands back whichever rows the scan
 * produced. #148 was a plan cap hiding an arbitrary half of an import; #185
 * found the same shape in twenty-odd more places, including which photograph
 * became a storefront's cover.
 *
 * ## The rule
 *
 * A read qualifies when its query object has an `orderBy` and also a `take`, a
 * `skip` or a `cursor`, or is the argument to `findFirst`/`findFirstOrThrow`.
 * Nested reads count: `media: { orderBy, take: 1 }` inside an `include` is the
 * card-thumbnail pick, and the model is resolved through the schema's relation
 * fields. A qualifying read passes when any of these holds:
 *
 *   1. The last `orderBy` key is unique on the model — `@id`, `@unique`, or a
 *      member of an `@@id`/`@@unique`. A composite member is accepted on its own
 *      because in practice the other members are pinned by the `where` or the
 *      relation (`ProductMedia.mediaId` under one product).
 *   2. The `where` pins at most one row — a single-field unique key, or a
 *      compound unique input like `enquiryId_businessId`.
 *   3. The `select` reads nothing but `orderBy` columns. Tied rows hold the same
 *      values there by definition, so which one comes back cannot be seen.
 *
 * Otherwise it fails, unless `EXEMPT` names it with a reason. An exemption that
 * matches nothing fails too, so the list cannot quietly outlive its sites.
 *
 * ## The second shape — a cut with no order at all (T2.3)
 *
 * The rule above only ever looked at reads that *had* an `orderBy`, so the
 * worse shape was invisible to it: a `take`, a `skip` or a `cursor` with **no
 * ordering**, where Postgres is free to return any rows at all rather than
 * merely to break a tie its own way. `searchBusinesses` read `take: 200` like
 * that against 38,687 public listings and ranked whatever came back, and
 * `loadDirectory` read `take: 20_000` like that — so a seller's nightly rank
 * history was a history of which rows the planner happened to pick. Both were
 * found by reading, which is exactly what a scan is for.
 *
 * Narrower than the first rule on purpose, because the second shape has one
 * very common innocent form. A read is flagged when it **pages**:
 *
 *   · `skip` or `cursor` — paging, which is meaningless without an order;
 *   · `take` above one, or a `take` whose size is a variable, which is a page
 *     size by another name.
 *
 * A bare `take: 1` is not flagged. It is usually an existence probe or a
 * "whichever one" read where the caller genuinely does not care, and a static
 * check cannot tell those from a probe that then uses the row it found — so
 * flagging them produced a hundred findings, nearly all innocent, which is how
 * a scan teaches people to add exclusions instead of reading it. The two real
 * defects this rule exists for were `take: 200` and `take: 20_000`.
 *
 * One further allowance: a read whose `where` pins at most one row has nothing
 * to order.
 *
 * ## What this does not catch
 *
 * - **In-memory paging.** `rows.sort(cmp).slice(…)` decides rows exactly the way
 *   a `take` does, and `Array.prototype.sort` keeps input order on a tie. A
 *   static check cannot tell whether a comparator is total;
 *   `tests/integration/paging-order-total.test.ts` holds the two known ones.
 * - **Unsliced lists.** A `findMany` with no `take` returns every row, so a tie
 *   reorders a list rather than choosing one — a real defect on a screen people
 *   click through, but not this rule's, which would otherwise flag hundreds of
 *   harmless reads.
 * - **Uniqueness that lives in raw SQL.** Partial unique indexes are not in
 *   `schema.prisma`, so the check cannot see them. A read that relies on one
 *   belongs in `EXEMPT` with the index named — though appending the model's
 *   `id` is usually cheaper than the argument.
 * - **Raw queries.** `$queryRaw` is not parsed.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SCAN = ["app", "lib", "components"];
const SKIP_DIRS = new Set(["node_modules", "generated", ".next"]);
const RECEIVERS = new Set(["prisma", "tx", "db", "client"]);
const FIRST_OPS = new Set(["findFirst", "findFirstOrThrow"]);
const READ_OPS = new Set(["findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow"]);
const CUTS = ["take", "skip", "cursor"];

/**
 * Reads that choose rows on a non-unique order, and may.
 *
 * Keyed by `file :: orderBy`, with the `orderBy` text whitespace-collapsed, so
 * an entry survives a line moving but not the ordering changing. Adding to this
 * list is the point at which somebody has to argue.
 */
const EXEMPT = new Map<string, string>([
  /*
     T2.3's shape, as it stood when the rule went in. A fence, not a sweep.

     Ten paging reads had no ordering when the check learned to see them. Five
     were in `lib/db/queries/search.ts` and are fixed in the same change,
     because that file is the one this sprint owns. These ten are not: each
     needs a decision about what the right order *is* — a job wants the oldest
     first so a backlog drains, a card wants whatever the screen shows, a map
     wants the nearest — and guessing one per module from outside the module
     would be ten guesses wearing a scan's authority.

     Unlike the first rule's list these are debt rather than decisions, so the
     count is printed and should only ever go down. Nothing new joins: a new
     unordered paging read fails.
  */
  ["app/(public)/rfq/new/page.tsx :: Product :: take: 20", "Which twenty products pre-fill a composer. Needs 3f's own order."],
  ["lib/db/queries/blended-search.ts :: BusinessCategory :: take: 5", "The trade line on a blended row, as `BUSINESS_INCLUDE` had it."],
  ["lib/db/queries/blended-search.ts :: FreeZoneRegistration :: take: 25", "Which free-zone registrations a row names."],
  ["lib/db/queries/map.ts :: Business :: take: MAX_PINS", "Which pins a viewport shows past the cap. Wants nearest-first, which is 3c's distance work."],
  ["lib/db/queries/product-detail.ts :: Product :: take: 60", "The related-products strip on a product page."],
  ["lib/enquiry/escalation-job.ts :: EnquiryRecipient :: take: 500", "A job's batch. Wants oldest-first so a backlog drains rather than circling."],
  ["lib/enquiry/zero-quote.ts :: Enquiry :: take: 200", "Same: a job's batch, and the same answer."],
  ["lib/messaging/follow-up.ts :: EnquiryRecipient :: take: 200", "Same."],
  ["lib/notify/service.ts :: NotificationDelivery :: take: 200", "The delivery queue's batch. Oldest-first is the whole point of a queue."],
  ["lib/search/reindex.ts :: Product :: take: 300", "The reindex batch. Wants a cursor, as `loadDirectory` now has."],
]);

// ─── The schema: which fields are unique, and where each relation leads ──────

interface Model {
  unique: Set<string>;
  compoundKeys: Set<string>;
  relations: Map<string, string>;
}

function readSchema(): Map<string, Model> {
  const src = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");
  const names = new Set([...src.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]!));
  const models = new Map<string, Model>();
  for (const block of src.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const model: Model = { unique: new Set(), compoundKeys: new Set(), relations: new Map() };
    for (const raw of block[2]!.split("\n")) {
      const line = raw.replace(/\/\/.*$/, "").trim();
      const composite = line.match(/^@@(?:id|unique)\s*\(\s*(?:fields:\s*)?\[([^\]]+)\]/);
      if (composite) {
        const fields = composite[1]!.split(",").map((f) => f.trim().replace(/\(.*$/, ""));
        for (const field of fields) model.unique.add(field);
        model.compoundKeys.add(fields.join("_"));
        continue;
      }
      const field = line.match(/^(\w+)\s+(\w+)(\[\])?\??/);
      if (!field) continue;
      if (/@id\b|@unique\b/.test(line)) model.unique.add(field[1]!);
      if (names.has(field[2]!)) model.relations.set(field[1]!, field[2]!);
    }
    models.set(block[1]!, model);
  }
  return models;
}

const MODELS = readSchema();
const byAccessor = new Map([...MODELS.keys()].map((name) => [name[0]!.toLowerCase() + name.slice(1), name]));

// ─── Source ─────────────────────────────────────────────────────────────────

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

const parsed = new Map<string, ts.SourceFile>();
function parse(path: string): ts.SourceFile {
  let file = parsed.get(path);
  if (!file) {
    file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    parsed.set(path, file);
  }
  return file;
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function prop(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && propName(p) === name) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return p.name;
  }
  return undefined;
}

function propName(p: ts.ObjectLiteralElementLike): string | undefined {
  if (!p.name) return undefined;
  if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) return p.name.text;
  return undefined;
}

/**
 * An identifier's initializer: the nearest enclosing scope first, then anywhere
 * in the file, then one `@/` import away. Nearest first because two functions in
 * one file commonly each declare a `const orderBy`.
 */
function resolveIdentifier(id: ts.Identifier, file: ts.SourceFile, depth = 0): ts.Expression | undefined {
  const declaredIn = (statements: ts.NodeArray<ts.Statement>): ts.Expression | undefined => {
    for (const stmt of statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === id.text && decl.initializer) return decl.initializer;
      }
    }
    return undefined;
  };
  for (let node: ts.Node | undefined = id.parent; node; node = node.parent) {
    if ((ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node)) && node.getSourceFile() === file) {
      const found = declaredIn(node.statements);
      if (found) return found;
    }
  }
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === id.text && node.initializer) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (found || depth > 0) return found;
  for (const stmt of file.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    const named = stmt.importClause?.namedBindings;
    if (!spec.startsWith("@/") || !named || !ts.isNamedImports(named)) continue;
    if (!named.elements.some((e) => e.name.text === id.text)) continue;
    for (const candidate of [`${spec.slice(2)}.ts`, `${spec.slice(2)}.tsx`, `${spec.slice(2)}/index.ts`]) {
      let target: ts.SourceFile;
      try {
        target = parse(join(ROOT, candidate));
      } catch {
        continue; // Not this extension.
      }
      const exported = declaredIn(target.statements);
      if (exported) return exported;
    }
  }
  return undefined;
}

function asObject(node: ts.Expression | undefined, file: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  if (!node) return undefined;
  let value = unwrap(node);
  if (ts.isIdentifier(value)) value = unwrap(resolveIdentifier(value, file) ?? value);
  return ts.isObjectLiteralExpression(value) ? value : undefined;
}

/**
 * Field names in `orderBy`, in order — one list per way the ordering can come
 * out. A conditional `orderBy` (a sort control) has a list per branch, and every
 * branch has to pass: the branch nobody tested is the one a buyer picks.
 */
function orderVariants(node: ts.Expression, file: ts.SourceFile): string[][] | undefined {
  let value = unwrap(node);
  if (ts.isIdentifier(value)) {
    const resolved = resolveIdentifier(value, file);
    if (!resolved) return undefined;
    value = unwrap(resolved);
  }
  if (ts.isConditionalExpression(value)) {
    const whenTrue = orderVariants(value.whenTrue, file);
    const whenFalse = orderVariants(value.whenFalse, file);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : undefined;
  }
  const fromObject = (obj: ts.ObjectLiteralExpression) =>
    obj.properties.map(propName).filter((n): n is string => Boolean(n));
  if (ts.isObjectLiteralExpression(value)) return [fromObject(value)];
  if (ts.isArrayLiteralExpression(value)) {
    const keys: string[] = [];
    for (const el of value.elements) {
      if (ts.isSpreadElement(el)) {
        const spread = orderVariants(el.expression, file);
        if (!spread || spread.length !== 1) return undefined;
        keys.push(...spread[0]!);
        continue;
      }
      const obj = asObject(el, file);
      if (!obj) return undefined;
      keys.push(...fromObject(obj));
    }
    return [keys];
  }
  return undefined;
}

// ─── The walk ───────────────────────────────────────────────────────────────

interface Finding {
  file: string;
  line: number;
  model: string;
  /** The ordering, or `(no orderBy)` for the second shape. */
  orderBy: string;
  key: string;
}

/** What an unordered cut is keyed and reported as. */
const UNORDERED = "(no orderBy)";

const findings: Finding[] = [];
const seen = new Set<ts.Node>();
let qualifying = 0;

/**
 * Whether an unordered read is *paging* — see the second shape in the docblock.
 *
 * `skip` or `cursor` always. A `take` only above one, or when its size is not a
 * literal, because a page size held in a constant is the shape that matters
 * (`take: PAGE_SIZE`) and a bare `take: 1` is usually a probe.
 */
function pages(query: ts.ObjectLiteralExpression, file: ts.SourceFile): boolean {
  if (prop(query, "skip") || prop(query, "cursor")) return true;
  const take = prop(query, "take");
  if (!take) return false;
  const text = take.getText(file).trim();
  const literal = Number(text.replace(/_/g, ""));
  return Number.isNaN(literal) ? true : literal > 1;
}

/**
 * Whether a `where` can match at most one row.
 *
 * Shared by both shapes: an ordering that ends on a non-unique column is
 * harmless over one row, and a cut over one row has nothing to order.
 */
function pinsOneRow(model: Model, where: ts.ObjectLiteralExpression): boolean {
  const names = where.properties.map(propName).filter((n): n is string => Boolean(n));
  const compoundMembers = new Set([...model.compoundKeys].flatMap((k) => k.split("_")));
  if (names.some((n) => model.unique.has(n) && !compoundMembers.has(n))) return true;
  if (names.some((n) => model.compoundKeys.has(n))) return true;
  // Every member of a compound key named as its own field pins one row too.
  return [...model.compoundKeys].some((k) =>
    k.split("_").every((member) => names.includes(member)),
  );
}

function evaluate(
  query: ts.ObjectLiteralExpression,
  modelName: string | undefined,
  isFirst: boolean,
  file: ts.SourceFile,
  path: string,
  groupBy?: Set<string>,
) {
  const orderBy = prop(query, "orderBy");
  if (seen.has(query)) return;
  const cut = isFirst || CUTS.some((name) => prop(query, name));

  /*
     T2.3's shape: a cut with no ordering. Reported before the `orderBy` rule
     because it is the worse of the two — there is no tie to break, only
     whichever rows the scan produced.
  */
  if (!orderBy) {
    if (!pages(query, file)) return;
    /*
       Only where the model resolved, which means a real `prisma.x.findMany`.

       The `loose` pass walks every object literal in the file so that a query
       fragment declared apart from its call is still seen. Without an
       `orderBy` to anchor on, that pass cannot tell a Prisma read from any
       object that happens to carry a `take`, a `skip` or a `cursor` — it
       flagged a spread fragment (`...(cursor === null ? {} : { cursor, skip:
       1 })`, whose own query *is* ordered) and a React prop called `skip`
       holding a translated string. A read whose model is unknown is not a read
       this rule can speak about.
    */
    if (!modelName) return;
    seen.add(query);
    const model = MODELS.get(modelName);
    const where = asObject(prop(query, "where"), file);
    // Nothing to order when the `where` pins at most one row.
    if (model && where && pinsOneRow(model, where)) return;
    qualifying += 1;
    /*
       Keyed on the cut rather than on the line, as the first rule is keyed on
       the ordering: an entry has to survive a line moving and must not survive
       the read changing size. `take: 200` and `take: PAGE_SIZE` in one file are
       two different reads and get two keys.
    */
    const cutText = CUTS.map((name) => {
      const node = prop(query, name);
      return node ? `${name}: ${node.getText(file).replace(/\s+/g, " ")}` : null;
    })
      .filter((part): part is string => part !== null)
      .join(", ");
    findings.push({
      file: relative(ROOT, path),
      line: file.getLineAndCharacterOfPosition(query.getStart(file)).line + 1,
      model: modelName ?? "?",
      orderBy: UNORDERED,
      key: `${relative(ROOT, path)} :: ${modelName ?? "?"} :: ${cutText || UNORDERED}`,
    });
    return;
  }

  seen.add(query);
  if (!cut) return;
  qualifying += 1;

  const variants = orderVariants(orderBy, file);
  const text = orderBy.getText(file).replace(/\s+/g, " ");
  const line = file.getLineAndCharacterOfPosition(orderBy.getStart(file)).line + 1;
  const record = () =>
    findings.push({
      file: relative(ROOT, path),
      line,
      model: groupBy ? `${modelName ?? "?"}.groupBy` : (modelName ?? "?"),
      orderBy: text,
      key: `${relative(ROOT, path)} :: ${text}`,
    });

  if (!variants || variants.some((keys) => keys.length === 0)) return record();
  const model = modelName ? MODELS.get(modelName) : undefined;
  const where = asObject(prop(query, "where"), file);
  const select = asObject(prop(query, "select"), file);

  const passes = (keys: string[]): boolean => {
    const last = keys.at(-1)!;

    // 1. Ends on a unique key — or, for a groupBy, on a grouping column, which
    //    is unique among the groups by construction.
    if (groupBy) return groupBy.has(last);
    if (model ? model.unique.has(last) : [...MODELS.values()].some((m) => m.unique.has(last))) return true;

    // 2. The where pins one row.
    if (model && where && pinsOneRow(model, where)) return true;

    // 3. The select reads only what is ordered on.
    if (select) {
      const read = select.properties.map(propName).filter((n): n is string => Boolean(n));
      if (read.length > 0 && read.every((n) => keys.includes(n))) return true;
    }
    return false;
  };

  if (!variants.every(passes)) record();
}

function walkQuery(
  query: ts.ObjectLiteralExpression,
  modelName: string | undefined,
  isFirst: boolean,
  file: ts.SourceFile,
  path: string,
) {
  evaluate(query, modelName, isFirst, file, path);
  const model = modelName ? MODELS.get(modelName) : undefined;
  for (const tree of ["include", "select"]) {
    const obj = asObject(prop(query, tree), file);
    if (!obj) continue;
    for (const p of obj.properties) {
      const name = propName(p);
      if (!name || name === "_count" || !ts.isPropertyAssignment(p)) continue;
      const child = asObject(p.initializer, file);
      if (!child) continue;
      walkQuery(child, model?.relations.get(name), false, file, path);
    }
  }
}

for (const path of SCAN.flatMap((dir) => sourceFiles(join(ROOT, dir)))) {
  const file = parse(path);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const op = node.expression.name.text;
      const target = node.expression.expression;
      if (
        READ_OPS.has(op) &&
        ts.isPropertyAccessExpression(target) &&
        ts.isIdentifier(target.expression) &&
        RECEIVERS.has(target.expression.text)
      ) {
        const arg = node.arguments[0] ? asObject(node.arguments[0], file) : undefined;
        if (arg) walkQuery(arg, byAccessor.get(target.name.text), FIRST_OPS.has(op), file, path);
      }
      if (
        op === "groupBy" &&
        ts.isPropertyAccessExpression(target) &&
        ts.isIdentifier(target.expression) &&
        RECEIVERS.has(target.expression.text)
      ) {
        const arg = node.arguments[0] ? asObject(node.arguments[0], file) : undefined;
        const by = arg ? prop(arg, "by") : undefined;
        const fields = by ? orderVariants(by, file) : undefined;
        const byArray = by && ts.isArrayLiteralExpression(unwrap(by))
          ? (unwrap(by) as ts.ArrayLiteralExpression).elements
              .filter(ts.isStringLiteral)
              .map((el) => el.text)
          : undefined;
        if (arg) evaluate(arg, byAccessor.get(target.name.text), false, file, path, new Set(byArray ?? fields?.flat() ?? []));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  // Query fragments declared apart from any call — `BUSINESS_INCLUDE` and its kind.
  const loose = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) evaluate(node, undefined, false, file, path);
    ts.forEachChild(node, loose);
  };
  loose(file);
}

// ─── Report ─────────────────────────────────────────────────────────────────

const failing = findings.filter((f) => !EXEMPT.has(f.key));
const stale = [...EXEMPT.keys()].filter((key) => !findings.some((f) => f.key === key));

console.log(`→ a read that cuts rows says which rows: an orderBy, ending on a unique key`);
console.log(`   ${qualifying} qualifying read(s), ${findings.length - failing.length} exempt, ${failing.length} failing`);
for (const f of failing) {
  console.log(`   FAIL — ${f.file}:${f.line}  ${f.model}  orderBy: ${f.orderBy}`);
}
for (const key of stale) {
  console.log(`   FAIL — exemption matches nothing: ${key}`);
}
// The exact `EXEMPT` key for each failure, for whoever has an argument to make.
if (process.argv.includes("--keys")) {
  for (const f of failing) console.log(`KEY\t${f.key}`);
}
process.exit(failing.length > 0 || stale.length > 0 ? 1 : 0);
