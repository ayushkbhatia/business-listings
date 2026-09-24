/**
 * Message limits a view needs to state before anything posts.
 *
 * Kept apart from the writers, which are `server-only`: the comparison page
 * says the limit beside the box, and the gallery and the view's tests render
 * that page without a database.
 */

/** Board `1n` Message all. Longer than a question needs, shorter than a specification — attach that in a thread. */
export const MESSAGE_ALL_MAX = 2000;
