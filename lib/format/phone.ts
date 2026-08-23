import { MASK_CHAR } from "./locale";

export type PhoneStyle = "auto" | "local" | "international";

export interface PhoneOptions {
  /**
   * `auto` renders a landline locally (`04 883 4120`) and a mobile
   * internationally (`+971 50 641 2288`). A buyer in Deira dials the landline as
   * printed; a mobile is as likely to be reached from outside the country, and
   * it is the number WhatsApp needs.
   */
  style?: PhoneStyle;
}

const UAE_CC = "971";

/** Landline area codes in service. 05x is mobile, 800 is toll free. */
const LANDLINE_AREAS = new Set(["2", "3", "4", "6", "7", "9"]);

interface ParsedPhone {
  /** National significant number, no leading zero. `4883412 0` → `48834120`. */
  nsn: string;
  kind: "landline" | "mobile" | "tollfree" | "unknown";
}

/**
 * Accepts `04 883 4120`, `048834120`, `+971 4 883 4120`, `00971 4 883 4120`,
 * `971-4-8834120`. Returns the national significant number without the trunk 0.
 */
export function parseUaePhone(input: string): ParsedPhone | null {
  const digits = input.replace(/[^\d+]/g, "");
  if (digits.length === 0) return null;

  let rest = digits.startsWith("+") ? digits.slice(1) : digits;
  if (rest.startsWith("00")) rest = rest.slice(2);
  if (rest.startsWith(UAE_CC)) rest = rest.slice(UAE_CC.length);
  if (rest.startsWith("0")) rest = rest.slice(1);

  if (rest.startsWith("800")) return { nsn: rest, kind: "tollfree" };
  if (rest.startsWith("5") && rest.length === 9) return { nsn: rest, kind: "mobile" };
  if (LANDLINE_AREAS.has(rest.charAt(0)) && rest.length === 8) {
    return { nsn: rest, kind: "landline" };
  }
  if (rest.length < 5) return null;
  return { nsn: rest, kind: "unknown" };
}

/** Digit groups, most significant first. Masking reuses these so both agree. */
function groups(parsed: ParsedPhone): string[] {
  const { nsn, kind } = parsed;
  if (kind === "mobile") return [nsn.slice(0, 2), nsn.slice(2, 5), nsn.slice(5)];
  if (kind === "landline") return [`0${nsn.slice(0, 1)}`, nsn.slice(1, 4), nsn.slice(4)];
  if (kind === "tollfree") return [nsn.slice(0, 3), nsn.slice(3)];
  return [nsn];
}

/** `04 883 4120` · `+971 50 641 2288` · `800 82255`. */
export function formatPhone(input: string, { style = "auto" }: PhoneOptions = {}): string {
  const parsed = parseUaePhone(input);
  if (!parsed) return input.trim();

  const g = groups(parsed);
  const resolved =
    style === "auto" ? (parsed.kind === "mobile" ? "international" : "local") : style;

  if (parsed.kind === "tollfree") return g.join(" ");

  if (resolved === "international") {
    const national = parsed.kind === "landline" ? [g[0]!.slice(1), ...g.slice(1)] : g;
    return `+${UAE_CC} ${national.join(" ")}`;
  }

  if (parsed.kind === "mobile") return `0${g.join(" ")}`;
  return g.join(" ");
}

/**
 * `04 88• ••••` · `+971 50 64• ••••`
 *
 * Keeps the area or operator code and the first two subscriber digits, so a buyer
 * can tell a Dubai landline from a Sharjah one and an Etisalat mobile from a du
 * one, and can still see that the seller has published a real number.
 *
 * This is not a growth trick. It is how the platform can prove it delivered the
 * enquiry: a reveal is an event, and the event is what a seller is shown when
 * they ask what their subscription bought. Pair every reveal with a
 * `contact_reveal` write — see lib/audit/contact-reveal.ts.
 */
export function maskPhone(input: string, { style = "auto" }: PhoneOptions = {}): string {
  const parsed = parseUaePhone(input);
  if (!parsed) return MASK_CHAR.repeat(4);

  const g = groups(parsed);
  const mask = (s: string, keep: number) =>
    s.slice(0, keep) + MASK_CHAR.repeat(Math.max(0, s.length - keep));

  // Group 0 (area or operator code) survives whole; group 1 keeps two digits;
  // everything after is gone.
  const masked = g.map((part, i) => (i === 0 ? part : i === 1 ? mask(part, 2) : mask(part, 0)));

  const resolved =
    style === "auto" ? (parsed.kind === "mobile" ? "international" : "local") : style;

  if (parsed.kind === "tollfree") return masked.join(" ");

  if (resolved === "international") {
    const national =
      parsed.kind === "landline" ? [masked[0]!.slice(1), ...masked.slice(1)] : masked;
    return `+${UAE_CC} ${national.join(" ")}`;
  }

  if (parsed.kind === "mobile") return `0${masked.join(" ")}`;
  return masked.join(" ");
}

/** `+971506412288`. Storage and the WhatsApp API, never a screen. */
export function toE164(input: string): string | null {
  const parsed = parseUaePhone(input);
  if (!parsed || parsed.kind === "unknown") return null;
  return `+${UAE_CC}${parsed.nsn}`;
}
