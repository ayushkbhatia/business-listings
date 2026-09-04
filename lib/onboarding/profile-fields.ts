/**
 * The shape of board 2c's fields, with nothing behind it.
 *
 * Split out of `./profile.ts` because that module is `server-only` and imports
 * Prisma, and the form on 2c is a client component that needs these numbers to
 * render its counter and its year bounds. A *type* imported across that boundary
 * is erased at build time and harmless; a **constant** is a real import, and it
 * pulled `pg` into the browser bundle — which fails as a wall of
 * "Can't resolve 'net'" rather than as anything resembling its cause.
 *
 * `tsc` cannot see this: the server/client split is Next's, not TypeScript's.
 * The guard is keeping the pure things pure, which is what this file is.
 */

/** The description cap board 2c states and its counter counts against. */
export const DESCRIPTION_MAX = 600;

/**
 * The earliest year a seller may claim.
 *
 * Not a validation of history — plenty of UAE firms predate it — but a floor
 * that catches a mistyped year without arguing with anybody's founding date.
 */
export const ESTABLISHED_MIN = 1960;

/**
 * The bands, from the schema's own enum.
 *
 * A band rather than a number because nobody maintains a headcount field, and a
 * stale exact figure is worse than a current range.
 */
export const TEAM_SIZES = ["b1_10", "b11_50", "b51_200", "b201_500", "b500_plus"] as const;
export type TeamSize = (typeof TEAM_SIZES)[number];
