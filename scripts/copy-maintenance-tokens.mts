import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Put the design tokens where the maintenance page can link them.
 *
 * Board 13e's page is served by `proxy.ts` as a whole document, before any
 * route runs, so it cannot link the Tailwind bundle — that file's name is a
 * build hash. It links `/maintenance/tokens.css` instead, and this writes it.
 *
 * A copy rather than a committed file for the reason `copy-map-worker.mts`
 * gives: a vendored second copy is one nobody updates. `docs/tokens.css` is the
 * file `app/globals.css` pastes unchanged, so the page and the app read the
 * same values, and `public/maintenance/tokens.css` is git-ignored. Runs before
 * `dev` and before `build`.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = resolve(root, "docs/tokens.css");
const to = resolve(root, "public/maintenance/tokens.css");

mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
console.log("maintenance tokens: docs/tokens.css → public/maintenance/tokens.css");
