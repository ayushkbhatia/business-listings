/**
 * Acceptance criterion 5: every formatter has a test, including the masking
 * ones. Enumerates what lib/format exports and asserts each name is exercised
 * by a test file — a formatter added without a test fails the build.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "lib/format";

const sources = readdirSync(DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts");
const tests = readdirSync(DIR)
  .filter((f) => f.endsWith(".test.ts"))
  .map((f) => readFileSync(join(DIR, f), "utf8"))
  .join("\n");

const exported: string[] = [];
for (const file of sources) {
  const src = readFileSync(join(DIR, file), "utf8");
  for (const m of src.matchAll(/^export function (\w+)/gm)) exported.push(m[1]!);
}

const untested = exported.filter((name) => !new RegExp(`\\b${name}\\b`).test(tests));

console.log(`→ 5. every formatter has a test`);
for (const name of exported.sort()) {
  const covered = !untested.includes(name);
  console.log(`   ${covered ? "pass" : "FAIL"} — ${name}`);
}

const masking = exported.filter((n) => n.startsWith("mask"));
console.log(`   ${masking.length} masking formatter(s): ${masking.join(", ")}`);

if (untested.length > 0) {
  console.log(`   FAIL — untested: ${untested.join(", ")}`);
  process.exit(1);
}
process.exit(0);
