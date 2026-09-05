/**
 * The caps and the one token name, in a module with no server imports.
 *
 * The editor on board 6f is a client component, and `content.ts` is
 * `server-only` — importing the constants from there pulled Prisma and `pg`
 * into the browser bundle, which typecheck and lint both allowed and only the
 * build caught. The same split `ranking.ts` and `settings.ts` already make, and
 * for the same reason.
 */

/** Board 6a §5: "Editorially curated per scope, capped at 5." */
export const MAX_RELATED_SEARCHES = 5;

/** §5 draws four to six. More is a block longer than the results above it. */
export const MAX_FAQ_ROWS = 8;

/** §SEO: "one written sentence per scope, not generated. 150–160 chars." */
export const META_DESCRIPTION_MAX = 200;

/** The one live token a written answer may carry. See `quote-range.ts`. */
export const QUOTE_RANGE_TOKEN = "quote_range";
