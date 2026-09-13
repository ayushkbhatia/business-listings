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
const EXEMPT = new Map<string, string>([]);

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
  orderBy: string;
  key: string;
}

const findings: Finding[] = [];
const seen = new Set<ts.Node>();
let qualifying = 0;

function evaluate(
  query: ts.ObjectLiteralExpression,
  modelName: string | undefined,
  isFirst: boolean,
  file: ts.SourceFile,
  path: string,
  groupBy?: Set<string>,
) {
  const orderBy = prop(query, "orderBy");
  if (!orderBy || seen.has(query)) return;
  seen.add(query);
  if (!isFirst && !CUTS.some((cut) => prop(query, cut))) return;
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
    if (model && where) {
      const names = where.properties.map(propName).filter((n): n is string => Boolean(n));
      const compoundMembers = new Set([...model.compoundKeys].flatMap((k) => k.split("_")));
      if (names.some((n) => model.unique.has(n) && !compoundMembers.has(n))) return true;
      if (names.some((n) => model.compoundKeys.has(n))) return true;
      // Every member of a compound key named as its own field pins one row too.
      if ([...model.compoundKeys].some((k) => k.split("_").every((member) => names.includes(member)))) return true;
    }

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

console.log(`→ ordered reads that choose rows end on a unique key`);
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
