import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A server component may not pass a function to a client component.
 *
 * "Functions cannot be passed directly to Client Components" is a runtime error
 * on the rendered page, not a build error, so it ships. It has now happened five
 * times here — QuoteLineEditor, ResendButton and EnquiryComposer in handoff 2,
 * then ImportWizard and CatalogueTable in handoff 3 — and the shape was
 * identical every time: a `labels` object with members like
 * `apply: (n) => t("...", { n })`, which reads as data and is a function prop.
 *
 * The rule is about the call site, not the declaration. A client component
 * taking `formatValue` from another client component is fine and several
 * primitives do it. What is never fine is a *server* component supplying one.
 *
 * So this walks every server component, resolves which of the components it
 * renders are client components, and fails on a function reaching one of them.
 * A server action is exempt: it is the one function that legitimately crosses,
 * and it is passed as a bare identifier ending in `Action`, or as `action=`.
 */

const ROOTS = ["app", "components"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (["node_modules", ".next", "generated"].includes(entry)) continue;
      walk(path, out);
    } else if (entry.endsWith(".tsx")) {
      out.push(path);
    }
  }
  return out;
}

const isClientFile = (path: string): boolean => {
  try {
    return readFileSync(path, "utf8").trimStart().startsWith('"use client"');
  } catch {
    return false;
  }
};

/** Resolve an import specifier to a file on disk, or null for a package. */
function resolveImport(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? resolve(specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (!base) return null;

  for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Which imported names come from a client component.
 *
 * A barrel re-exporting a client component counts: `@/components/domain` is not
 * itself a client file, so the named export is followed one hop further.
 */
function clientComponentNames(file: string, source: string): Set<string> {
  const names = new Set<string>();
  const importRe = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+"([^"]+)"/g;

  for (const match of source.matchAll(importRe)) {
    const target = resolveImport(file, match[2]!);
    if (!target) continue;

    const imported = match[1]!
      .split(",")
      .map((part) => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim())
      .filter((n) => /^[A-Z]/.test(n));
    if (imported.length === 0) continue;

    if (isClientFile(target)) {
      for (const name of imported) names.add(name);
      continue;
    }

    // One hop through a barrel.
    const barrel = readFileSync(target, "utf8");
    for (const name of imported) {
      const re = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*"([^"]+)"`);
      const hop = re.exec(barrel);
      const hopTarget = hop ? resolveImport(target, hop[1]!) : null;
      if (hopTarget && isClientFile(hopTarget)) names.add(name);
    }
  }

  return names;
}

/** `<Name` ... up to the matching `>` that opens or closes the element. */
function elementsOf(source: string, name: string): string[] {
  const out: string[] = [];
  const open = new RegExp(`<${name}(?=[\\s/>])`, "g");

  for (const match of source.matchAll(open)) {
    let depth = 0;
    let i = match.index! + match[0].length;
    for (; i < source.length; i += 1) {
      const char = source[i]!;
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) break;
    }
    out.push(source.slice(match.index!, i));
  }
  return out;
}

/**
 * Each `prop={...}` in an element, as (name, expression).
 *
 * Balanced-brace scanning rather than a regex, because a labels object is full
 * of nested braces and a lazy match stops at the first one.
 */
function propsOf(element: string): { name: string; expression: string }[] {
  const out: { name: string; expression: string }[] = [];
  const start = /(\w+)=\{/g;

  for (const match of element.matchAll(start)) {
    let depth = 1;
    let i = match.index! + match[0].length;
    for (; i < element.length && depth > 0; i += 1) {
      if (element[i] === "{") depth += 1;
      else if (element[i] === "}") depth -= 1;
    }
    out.push({ name: match[1]!, expression: element.slice(match.index! + match[0].length, i - 1) });
  }
  return out;
}

/**
 * Strip balanced parentheses, innermost first.
 *
 * This is the whole discrimination, and it falls out of the bracketing.
 *
 * `specFields.map((f) => ({ id: f.id }))` is not a function prop: the arrow is
 * an argument to a call, and what crosses is the array the call returns. Every
 * paren pair collapses — `(f)` and `({ id: f.id })` first, then the `( => )`
 * they leave behind — and `specFields.map` has no arrow in it.
 *
 * `labels={{ apply: (n) => t("x") }}` has no enclosing call, so the object
 * survives as `{ apply:  => t }` and the arrow is still there. That object is a
 * function prop however it is spelled, which is exactly what shipped five times.
 */
function withoutCallArguments(expression: string): string {
  let previous = expression;
  for (let pass = 0; pass < 20; pass += 1) {
    const next = previous.replace(/\([^()]*\)/g, "");
    if (next === previous) return next;
    previous = next;
  }
  return previous;
}

describe('"use client" is the first line, or it is not a directive', () => {
  const files = ROOTS.flatMap((root) => walk(root));

  it("finds no file where something was inserted above the directive", () => {
    /*
     * A directive prologue only counts before the first statement. Put an
     * import above `"use client"` and the file silently becomes a server
     * component — no error, no warning, and the hooks inside it fail at
     * runtime on whichever page renders first.
     *
     * A codemod adding an import to eight client components did exactly this,
     * and tsc, eslint and the type checker all stayed quiet. Nothing else in
     * the toolchain looks at line order.
     */
    const displaced = files.filter((file) => {
      const lines = readFileSync(file, "utf8").split("\n");
      const at = lines.findIndex((line) => /^\s*["']use client["'];?\s*$/.test(line));
      return at > 0 && lines.slice(0, at).some((line) => line.trim() !== "");
    });

    expect(
      displaced,
      displaced.length > 0
        ? `${displaced.join(", ")} has code above "use client", so the directive does nothing ` +
            "and the file is a server component."
        : "",
    ).toEqual([]);
  });
});

describe("server components pass no functions to client components", () => {
  const files = ROOTS.flatMap((root) => walk(root));

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (source.trimStart().startsWith('"use client"')) continue;

    const clientNames = clientComponentNames(file, source);
    if (clientNames.size === 0) continue;

    it(`${file} passes no functions to a client component`, () => {
      const offenders: string[] = [];

      for (const name of clientNames) {
        for (const element of elementsOf(source, name)) {
          for (const prop of propsOf(element)) {
            // A server action is the one function that legitimately crosses.
            if (/[Aa]ction/.test(prop.name)) continue;
            if (withoutCallArguments(prop.expression).includes("=>")) {
              offenders.push(`${prop.name} on <${name}>`);
            }
          }
        }
      }

      expect(
        offenders,
        offenders.length > 0
          ? `${offenders.join(", ")} in ${file} passes a function to a client component. ` +
              "That is a runtime error on the rendered page, not a build error. " +
              "Call t() inside the client component instead — it has no server-only marker."
          : "",
      ).toEqual([]);
    });
  }
});
