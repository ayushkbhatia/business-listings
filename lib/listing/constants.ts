/**
 * Values the editor and the service both need.
 *
 * Split out because `service.ts` is `server-only` and the form that has to
 * enforce the same limit runs in the browser. Two copies of 600 is how a
 * counter says one thing and a save says another.
 */
export const DESCRIPTION_LIMIT = 600;
