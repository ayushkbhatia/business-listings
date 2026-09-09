/**
 * A seller's own web address, as a label under our own zone.
 *
 * Board 5e, second model. It was written for a domain a seller owns and points
 * at us with a CNAME and a TXT record, which meant DNS verification, a token,
 * per-record propagation states, a give-up clock, five named failure causes and
 * a certificate we could not issue. On 9 Sep 2026 the product changed: a seller
 * gets a label under `businesslistings.me` instead.
 *
 * Everything the old model spent its complexity on disappears with that.
 * We own the zone, so there is nothing to verify — no records for a seller to
 * create, nothing to poll hourly, and one wildcard certificate for all of them.
 * What is left is a name, and the rules a name has to keep.
 *
 * ## Why the label is derived rather than chosen
 *
 * A slug is already unique, already moderated as part of the listing, and
 * already the thing the storefront lives at. Deriving from it means no naming
 * queue, no squatting on a competitor's name, and no second identity to keep
 * in step with `displayName`.
 *
 * Hyphens come out. `indus-hydraulics` becomes `indushydraulics`, because that
 * is what somebody reads off a business card and types. That makes the mapping
 * lossy in one direction, which is why the label is stored rather than
 * recomputed at read time — two slugs can flatten to one label, and the second
 * one to ask is refused rather than silently given somebody else's address.
 *
 * ## Pure, and free of `next/server`
 *
 * `proxy.ts` runs at the edge with no database client — it says so in its own
 * docblock. So the host it receives has to become a path by string work alone,
 * and every rule below has to hold without asking anything. That constraint is
 * the reason this file exists separately from the service.
 */

/** The zone every storefront label sits under. */
export const SUBDOMAIN_ZONE = process.env["NEXT_PUBLIC_SUBDOMAIN_ZONE"] ?? "businesslistings.me";

/** DNS says 63 octets. Nothing here should come close, and the cap is real. */
export const MAX_LABEL = 63;

/**
 * Labels a storefront may never take.
 *
 * Three groups, and the first is the one that would actually hurt: every
 * top-level route segment this app serves. `b.businesslistings.me` rewriting to
 * `/b/b` is merely wrong; `admin.businesslistings.me` rewriting to `/b/admin`
 * is a listing sitting where staff expect a console, which is the kind of
 * confusion that gets somebody phished.
 *
 * The second group is the hostnames infrastructure conventionally owns — mail
 * has to keep working, and `www` has to reach the directory rather than a
 * supplier who happened to be called WWW Trading.
 *
 * The third is `stores`, which the previous model used as its CNAME target and
 * which may still be pointed somewhere.
 */
export const RESERVED_LABELS: ReadonlySet<string> = new Set([
  // Route segments, public.
  "b", "c", "categories", "search", "compare", "guides", "best", "lp", "rfq",
  "enquiry", "account", "review", "pricing", "for-buyers", "list-your-business",
  "terms", "privacy", "cookies", "review-policy", "verification-policy",
  // Route segments, gated.
  "dashboard", "admin", "staff", "signin", "signup", "verify", "reset",
  "onboarding", "invite", "auth", "api", "dev",
  // Infrastructure.
  "www", "mail", "smtp", "imap", "pop", "mx", "ns", "ns1", "ns2", "autodiscover",
  "cdn", "static", "assets", "img", "media", "app", "status", "help", "support",
  "blog", "docs", "email", "webmail", "vpn", "test", "staging", "preview",
  // The old model's CNAME target.
  "stores",
]);

export type LabelRefusal =
  | "empty"
  | "too_long"
  | "reserved"
  | "not_a_label";

/**
 * The label a slug earns.
 *
 * Lossy and deliberately so: hyphens and anything else outside `a-z0-9` come
 * out, because the address is meant to be read aloud and typed. The result can
 * collide, and the service treats a collision as `taken` rather than resolving
 * it — a supplier given a near-miss of the address they asked for would print
 * the one they asked for.
 */
export function labelFor(slug: string): string {
  return slug.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Whether a label may be used, or the reason it may not. */
export function checkLabel(label: string): LabelRefusal | null {
  if (!label) return "empty";
  if (label.length > MAX_LABEL) return "too_long";
  // Lowercase alphanumeric only. `labelFor` cannot produce anything else, and
  // this is checked anyway because the service also reads labels back out of
  // the database, where a hand-edited row could hold anything.
  if (!/^[a-z0-9]+$/.test(label)) return "not_a_label";
  if (RESERVED_LABELS.has(label)) return "reserved";
  return null;
}

/** The full hostname a label resolves to. */
export function hostnameFor(label: string): string {
  return `${label}.${SUBDOMAIN_ZONE}`;
}

/**
 * The storefront label a request's `Host` header names, or null.
 *
 * Null for the apex, for `www`, for anything outside our zone, and for a
 * reserved label — so the proxy falls through to normal routing in every case
 * where the host is not a seller's address. Port and case are stripped: a
 * `Host` header carries `:3000` in development and its case is not guaranteed.
 *
 * Deliberately strict about depth. `a.b.businesslistings.me` is not a
 * storefront; treating it as one would mean a wildcard certificate mismatch and
 * a rewrite to a label nobody was ever given.
 */
export function labelFromHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const name = host.split(":")[0]?.toLowerCase();
  if (!name) return null;

  const suffix = `.${SUBDOMAIN_ZONE}`;
  if (!name.endsWith(suffix)) return null;

  const label = name.slice(0, -suffix.length);
  if (!label || label.includes(".")) return null;
  return checkLabel(label) === null ? label : null;
}
