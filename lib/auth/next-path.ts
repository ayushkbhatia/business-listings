/**
 * Where a refused request comes back to, and how that path is spelled.
 *
 * Deliberately not `server-only`, which is the whole reason it is its own file.
 * `isSafeNext` lived in ./flow.ts, and flow.ts imports Prisma and the Supabase
 * admin client — so anything that wanted to build a sign-in link had to be a
 * server module or hand-roll the URL. Six call sites hand-rolled it, in four
 * different spellings, two of them percent-encoded by hand.
 *
 * There is nothing here but string work, so both sides of the boundary can have
 * it. ./flow.ts re-exports `isSafeNext` so its existing importers are unchanged.
 */

/**
 * A `next` from a query string is attacker-controlled. Same-origin absolute
 * paths only: no scheme, no host, and no `//host` which a browser reads as
 * protocol-relative and follows off-site.
 */
export function isSafeNext(next: string): boolean {
  return next.startsWith("/") && !next.startsWith("//") && !next.includes("\\");
}

/**
 * The sign-in URL that returns somebody to where they were refused.
 *
 * One construction, because there were six. Two of them were literals —
 * `"/signin?next=%2Faccount%2Fsaved%2Fshortlist"` — which is a path spelled a
 * second time in a form no search for the route will match, and therefore a
 * path that keeps pointing at the old place when the route moves. One was not
 * encoded at all, so the first `&` of a query string would have truncated the
 * return path.
 *
 * Unsafe input falls back to the directory home rather than throwing. A refusal
 * is already a bad moment for the person having it, and the worst outcome of a
 * hostile `next` is that they land on the home page instead of where they were.
 */
export function signInHref(next: string): string {
  return `/signin?next=${encodeURIComponent(isSafeNext(next) ? next : "/")}`;
}
