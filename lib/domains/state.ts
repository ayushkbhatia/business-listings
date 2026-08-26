/**
 * Custom domain verification, as a state machine. Pure.
 *
 * Criterion 8 asks for four things and the second is the one that decides
 * whether the flow is usable: *"handles partial propagation without reading as
 * failure."*
 *
 * DNS propagates unevenly. A seller who adds both records at once will often
 * see one resolve minutes before the other, and a screen that shows that as an
 * error sends them back to their registrar to undo work that was correct. So
 * `partial` is its own state, it is not a failure, and the two records carry
 * their own statuses independently.
 *
 * The clock only runs out after a day. Board 5e's fifth state is
 * "failed-after-24h (with the likely cause named)" — and naming the cause is
 * the difference between a seller fixing it and a seller opening a ticket.
 */

export type RecordStatus = "found" | "waiting" | "wrong_value";

export type DomainStatus = "pending" | "partial" | "verified" | "failed" | "revoked";

export interface RecordCheck {
  cname: RecordStatus;
  txt: RecordStatus;
}

/**
 * Why it did not verify, in terms of what the seller did.
 *
 * Not "DNS lookup failed". Every one of these names a thing somebody can go and
 * change at their registrar.
 */
export type FailureCause =
  | "no_records_at_all"
  | "cname_only"
  | "txt_only"
  | "cname_points_elsewhere"
  | "txt_value_stale";

export interface DomainState {
  status: DomainStatus;
  /** Set only when `failed`. */
  cause?: FailureCause;
}

/** How long a seller has before we stop waiting and name a likely cause. */
export const GIVE_UP_AFTER_HOURS = 24;

/**
 * Where a domain stands.
 *
 * `wasVerified` is what separates a domain that never came up from one that
 * stopped resolving after going live. The second is `revoked`, and it is not a
 * failure of setup — somebody changed their DNS, possibly by accident, possibly
 * because they moved registrar. The platform URL keeps serving either way,
 * which is the fourth thing criterion 8 asks for.
 */
export function domainState(
  records: RecordCheck,
  hoursSinceAdded: number,
  wasVerified: boolean,
): DomainState {
  const both = records.cname === "found" && records.txt === "found";

  if (both) return { status: "verified" };

  /*
   * It worked and now it does not. Never `failed`: the seller did the setup
   * correctly once, and telling them their setup is wrong sends them to check
   * something that is not the problem.
   */
  if (wasVerified) return { status: "revoked" };

  const neither = records.cname !== "found" && records.txt !== "found";

  if (hoursSinceAdded < GIVE_UP_AFTER_HOURS) {
    // The load-bearing line. One record up and one not is the normal case in
    // the first hour, and it is not an error.
    return { status: neither ? "pending" : "partial" };
  }

  return { status: "failed", cause: causeOf(records) };
}

function causeOf(records: RecordCheck): FailureCause {
  if (records.cname === "wrong_value") return "cname_points_elsewhere";
  if (records.txt === "wrong_value") return "txt_value_stale";
  if (records.cname === "found") return "cname_only";
  if (records.txt === "found") return "txt_only";
  return "no_records_at_all";
}

/**
 * The two records a seller has to add.
 *
 * Returned as data rather than as a formatted block, because they go three
 * places — on the screen, into the "email these to my IT person" message, and
 * into a copy button — and a string built for one of those is wrong in the
 * other two.
 */
export interface DnsRecord {
  type: "CNAME" | "TXT";
  /** The name to enter at the registrar, relative to the zone. */
  name: string;
  value: string;
}

export const VERIFY_PREFIX = "_bl-verify";

export function recordsFor(hostname: string, token: string, target: string): DnsRecord[] {
  /*
   * The subdomain only. Registrars ask for the label rather than the whole
   * name, and a seller pasting `shop.alwaha.ae` into a field that wants `shop`
   * ends up with `shop.alwaha.ae.alwaha.ae` — which is the single most common
   * way this goes wrong.
   */
  const label = hostname.split(".")[0] ?? hostname;

  return [
    { type: "CNAME", name: label, value: target },
    { type: "TXT", name: `${VERIFY_PREFIX}.${label}`, value: `bl-verify=${token}` },
  ];
}

/** Is this something we can serve at all? */
export type HostnameRefusal = "not_a_hostname" | "apex_domain" | "our_own_domain";

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/**
 * Apex domains are refused, and the reason is not fussiness.
 *
 * `alwaha.ae` cannot carry a CNAME — the record type is illegal at a zone apex
 * where SOA and NS already live. Some registrars offer ALIAS or ANAME records
 * that work around it and many do not, so accepting an apex would mean a flow
 * that succeeds or fails depending on who the seller bought their domain from.
 * `shop.alwaha.ae` works everywhere.
 */
export function checkHostname(input: string, ourDomain: string): HostnameRefusal | null {
  const hostname = input.trim().toLowerCase().replace(/\.$/, "");
  if (!HOSTNAME.test(hostname)) return "not_a_hostname";
  /*
   * Ours first. `businesslistings.me` is both our own domain and an apex, and
   * "that is our domain" is the more useful of the two answers — a seller told
   * it is an apex will go and try `shop.businesslistings.me`.
   */
  if (hostname === ourDomain || hostname.endsWith(`.${ourDomain}`)) return "our_own_domain";
  if (hostname.split(".").length < 3) return "apex_domain";
  return null;
}

export function normaliseHostname(input: string): string {
  return input.trim().toLowerCase().replace(/\.$/, "");
}
