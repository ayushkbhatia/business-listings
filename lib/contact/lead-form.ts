import { formatPhone, parseUaePhone, toE164 } from "@/lib/format/phone";

/**
 * Board `1d` amendment — the three fields between a buyer and a supplier's
 * landline, read the same way in the browser and on the server.
 *
 * Pure, and it has to be: the dialog says what is wrong under each field on
 * submit, and the server action says it again because a client-side check is a
 * courtesy rather than a rule. One function for both is how the two cannot
 * disagree about what a mobile is.
 *
 * ## Three fields, and no fourth
 *
 * The form's title promises thirty seconds (`Q6`). A company field, an OTP or a
 * verification round trip would break that promise, so nothing here reaches out
 * to anything: shape only.
 */

/** One landline as a reveal hands it back. */
export interface LandlineNumber {
  /** `04 883 4120`. */
  display: string;
  /** `+97148834120`, for the `tel:` href. */
  tel: string;
}

export const LEAD_NAME_MIN = 2;
export const LEAD_NAME_MAX = 120;
export const LEAD_EMAIL_MAX = 254;
export const LEAD_SOURCE_MAX = 500;

/** Deliberately loose — the same shape `lib/auth/identity.ts` accepts at sign-in. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface LeadFieldsInput {
  name: string;
  email: string;
  mobile: string;
}

export interface LeadFields {
  name: string;
  /** Lower-cased. */
  email: string;
  /** E.164, `+9715XXXXXXXX`. */
  mobile: string;
}

export type LeadFieldProblem =
  | "name_missing"
  | "name_short"
  | "name_long"
  | "email_missing"
  | "email_shape"
  | "mobile_missing"
  | "mobile_not_uae";

export interface LeadProblems {
  name?: LeadFieldProblem;
  email?: LeadFieldProblem;
  mobile?: LeadFieldProblem;
}

export type LeadRead = { ok: true; lead: LeadFields } | { ok: false; problems: LeadProblems };

/**
 * Every problem at once, never the first.
 *
 * A form that reports the name, is fixed, and then reports the email has cost
 * the buyer a second round trip for something it knew the first time.
 */
export function readLeadFields(input: LeadFieldsInput): LeadRead {
  const problems: LeadProblems = {};

  const name = input.name.replace(/\s+/g, " ").trim();
  const nameLength = [...name].length;
  if (nameLength === 0) problems.name = "name_missing";
  else if (nameLength < LEAD_NAME_MIN) problems.name = "name_short";
  else if (nameLength > LEAD_NAME_MAX) problems.name = "name_long";

  const email = input.email.trim().toLowerCase();
  if (email === "") problems.email = "email_missing";
  else if (email.length > LEAD_EMAIL_MAX || !EMAIL.test(email)) problems.email = "email_shape";

  /*
     A mobile, specifically, and a UAE one. The field carries a fixed +971, so
     `50 123 4567`, `050 123 4567` and `+971 50 123 4567` are all the same number
     and all accepted. A landline is refused rather than stored: a lead the
     seller cannot WhatsApp back is a lead with its most useful field missing.
  */
  const rawMobile = input.mobile.trim();
  const parsed = rawMobile === "" ? null : parseUaePhone(rawMobile);
  const mobile = parsed?.kind === "mobile" ? toE164(rawMobile) : null;
  if (rawMobile === "") problems.mobile = "mobile_missing";
  else if (!mobile) problems.mobile = "mobile_not_uae";

  if (problems.name || problems.email || problems.mobile || !mobile) {
    return { ok: false, problems };
  }
  return { ok: true, lead: { name, email, mobile } };
}

/** The catalogue key for each problem. The dialog words it; the server never does. */
export const LEAD_PROBLEM_KEY = {
  name_missing: "contact.error.name_missing",
  name_short: "contact.error.name_short",
  name_long: "contact.error.name_long",
  email_missing: "contact.error.email_missing",
  email_shape: "contact.error.email_shape",
  mobile_missing: "contact.error.mobile_missing",
  mobile_not_uae: "contact.error.mobile_not_uae",
} as const satisfies Record<LeadFieldProblem, string>;

/**
 * A stored E.164 mobile as the field shows it beside its fixed `+971`.
 *
 * `+971501234567` → `50 123 4567`. Anything that is not a UAE mobile prefills
 * nothing: a landline on an account would only be refused on submit.
 */
export function mobileFieldValue(stored: string | null | undefined): string {
  if (!stored) return "";
  const parsed = parseUaePhone(stored);
  if (parsed?.kind !== "mobile") return "";
  return formatPhone(stored, { style: "international" }).replace(/^\+971\s*/, "");
}

/** Query parameters that can carry a secret or a person. Never recorded. */
const PRIVATE_PARAMS = new Set(["t", "token", "code", "otp", "email", "phone", "mobile", "next"]);

/**
 * `B9` — the page inside the platform the buyer came from, as a path.
 *
 * `referrer` is the browser's `document.referrer`, which the client sends
 * because a server action's own `Referer` is the page the action was called
 * from, not the one before it. Anything on another host is `null`, which the
 * seller reads as *Direct or another site* — the note's wording still holds,
 * because the source recorded is exactly what it says.
 *
 * Pure: `hosts` are the ones that count as this platform, passed in.
 */
export function sourcePathFrom(referrer: string | null | undefined, hosts: readonly string[]): string | null {
  if (!referrer) return null;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!hosts.some((host) => host.toLowerCase() === url.host.toLowerCase())) return null;

  for (const key of [...url.searchParams.keys()]) {
    if (PRIVATE_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  const search = url.searchParams.toString();
  const path = `${url.pathname}${search ? `?${search}` : ""}`;
  return path.slice(0, LEAD_SOURCE_MAX);
}

export type LeadSourceKind = "direct" | "home" | "search" | "category" | "storefront" | "other_storefront" | "page";

export interface LeadSource {
  kind: LeadSourceKind;
  /** The search phrase, where the kind is `search` and one was typed. */
  query: string | null;
  path: string | null;
}

/**
 * What a recorded path was, for the person reading the lead.
 *
 * `/search?q=valves` is a search for *valves*; `/b/<this seller>/branches` is
 * the seller's own storefront; `/b/<somebody else>` is a buyer who was reading a
 * competitor first, which a seller would want to know and a path would hide.
 */
export function leadSource(path: string | null, businessSlug: string): LeadSource {
  if (!path) return { kind: "direct", query: null, path: null };
  const [pathname = "", search = ""] = path.split("?", 2);
  if (pathname === "/" || pathname === "") return { kind: "home", query: null, path };
  if (pathname === "/search" || pathname.startsWith("/search/")) {
    const query = new URLSearchParams(search).get("q")?.trim() || null;
    return { kind: "search", query, path };
  }
  if (pathname.startsWith("/c/") || pathname.startsWith("/categories")) {
    return { kind: "category", query: null, path };
  }
  if (pathname === `/b/${businessSlug}` || pathname.startsWith(`/b/${businessSlug}/`)) {
    return { kind: "storefront", query: null, path };
  }
  if (pathname.startsWith("/b/")) return { kind: "other_storefront", query: null, path };
  return { kind: "page", query: null, path };
}
