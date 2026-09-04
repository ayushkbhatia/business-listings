/**
 * What "enough photographs" means, in one place.
 *
 * The setup hub states this task's target on its card and board 8b states it
 * again at the top of the task itself. When they were two constants they
 * disagreed immediately — the hub asked for six over ten minutes while 8b asked
 * for five over six — and a seller who finishes on one screen and is told they
 * have not on the other stops believing either.
 *
 * Pure, with no `server-only` and no database, because both a pure task module
 * and a server service have to read it.
 */

/** Board 8b §2: five is enough. */
export const PHOTO_TARGET = 5;

/**
 * At least three that are not the logo.
 *
 * §2 is explicit that this scores nothing of its own — it gates completion. A
 * listing whose five photographs are five copies of a logo has answered none of
 * the question the photographs are there to answer, and the rule is explained
 * at the point it blocks rather than in advance.
 */
export const NON_LOGO_TARGET = 3;

/** Six minutes, from the work rather than from optimism. §Intro. */
export const PHOTO_MINUTES = 6;
