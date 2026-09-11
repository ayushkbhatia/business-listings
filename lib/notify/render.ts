/**
 * Filling a template in, and refusing to fill it with the wrong thing.
 *
 * There are two halves to criterion 8 and only one of them is about templates.
 *
 * The first: no template may name a placeholder that could carry a buyer's
 * phone, email or company. That is checked against the source and the database
 * in tests/unit/notification-templates.test.ts, and it is the easy half — a
 * template is written once and reviewed once.
 *
 * The second is this file. `{area}` is a perfectly safe placeholder, and
 * `{ area: "+971 50 641 2288" }` is a leak. A caller passing the wrong value
 * into the right slot defeats every template review that has ever happened, so
 * the values are checked here, at the moment of substitution, and a leak throws
 * rather than sends.
 *
 * Pure. No database, no network.
 */

export interface RenderInput {
  body: string;
  subject?: string | null;
  actionLabel?: string | null;
  actionPath?: string | null;
}

export interface Rendered {
  body: string;
  subject: string | null;
  actionLabel: string | null;
  actionPath: string | null;
}

export type RenderParams = Readonly<Record<string, string | number>>;

export class NotificationLeakError extends Error {
  /** Stable, so a log can be grepped and an alert can key off it. */
  readonly code = "notification_contact_leak";
  constructor(
    readonly placeholder: string,
    readonly kind: "phone" | "email" | "iban",
  ) {
    super(
      `Refusing to render a notification: {${placeholder}} looks like a ${kind}. ` +
        "Buyer contact details never appear in a notification — see rule 1.",
    );
    this.name = "NotificationLeakError";
  }
}

export class MissingParamError extends Error {
  readonly code = "notification_missing_param";
  constructor(readonly placeholder: string) {
    super(
      `Refusing to render a notification: {${placeholder}} has no value. ` +
        "A notification with a hole in it is worse than one that did not send.",
    );
    this.name = "MissingParamError";
  }
}

/*
 * What a contact detail looks like once it is a string.
 *
 * Tight on purpose. `{amount}` renders as "AED 15,344" and `{ref}` as
 * "ENQ-8841"; neither may trip this, or every notification in the product
 * throws. A bare run of nine or more digits is the shape of a number nobody
 * formats — a price has separators and a reference has a prefix.
 */
const LOOKS_LIKE: readonly { kind: "phone" | "email" | "iban"; pattern: RegExp }[] = [
  { kind: "email", pattern: /[\w.+-]+@[\w-]+\.[\w.]{2,}/ },
  { kind: "iban", pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/ },
  /*
     +971 50 641 2288 · 00971506412288 · 0506412288

     The lookbehind is load-bearing. Without it the `00` international prefix
     was recognised anywhere in a value, including in the middle of an opaque
     identifier — and a cuid is twenty-five characters of base-36, so a run like
     `…y0085254929h3` reads as a dialling prefix followed by a number.

     It refused a real notification. `reachable-delivery.test.ts` went red on a
     docs-only branch with "{enquiryId} looks like a phone", and the same throw
     in production would kill the message rather than skip it. Two million
     cuid-shaped strings were sampled to find the shape: one tripped, and every
     one that trips does so through this pattern and this missing boundary.

     A dialling prefix glued to the end of a word is not a dialling prefix, so
     this gives up exactly one shape: a phone number with no separator before it
     and a letter immediately preceding, "rashid00971506412288". A leaked number
     comes out of a `phone` column rendered alone or after a space, and both of
     those still throw.
  */
  { kind: "phone", pattern: /(?<![A-Za-z0-9])(?:\+|00)\d{1,3}[\s-]?\d[\d\s-]{6,}/ },
  { kind: "phone", pattern: /\b0\d[\s-]?\d{3}[\s-]?\d{4}\b/ },
  { kind: "phone", pattern: /\b\d{9,15}\b/ },
];

/** Null when the value is safe; the kind of leak when it is not. */
export function contactShape(value: string): "phone" | "email" | "iban" | null {
  for (const { kind, pattern } of LOOKS_LIKE) if (pattern.test(value)) return kind;
  return null;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** Every placeholder a template uses, deduplicated. */
export function placeholdersIn(input: RenderInput): string[] {
  const text = [input.body, input.subject, input.actionLabel, input.actionPath]
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]!))];
}

/**
 * Fill a template in.
 *
 * Throws on a missing value and on a value that looks like contact details.
 * Both are programmer errors rather than user input, and both are worse sent
 * than not sent: a notification with `{area}` still in it looks broken, and one
 * carrying a phone number breaks the promise the whole product rests on.
 */
export function render(input: RenderInput, params: RenderParams): Rendered {
  for (const [key, raw] of Object.entries(params)) {
    const value = String(raw);
    const kind = contactShape(value);
    if (kind) throw new NotificationLeakError(key, kind);
  }

  const fill = (text: string | null | undefined): string | null => {
    if (typeof text !== "string") return null;
    return text.replace(PLACEHOLDER, (_whole, name: string) => {
      const value = params[name];
      if (value === undefined) throw new MissingParamError(name);
      return String(value);
    });
  };

  return {
    body: fill(input.body) ?? "",
    subject: fill(input.subject),
    actionLabel: fill(input.actionLabel),
    actionPath: fill(input.actionPath),
  };
}
