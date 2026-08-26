import type { NotificationEvent } from "@/lib/db/generated/enums";

/**
 * What each notification event supplies to a template.
 *
 * `render()` refuses a placeholder with no value — *"a notification with a hole
 * in it is worse than one that did not send"* — and until now the only way to
 * find out a template referenced `{quotedValue}` on an event that has no such
 * thing was for a seller not to get told something.
 *
 * This is the list, and it is bound to the call sites rather than parallel to
 * them: `paramsFor` types what `events.ts` passes to `render`, so a param added
 * at a call site and not declared here is a typecheck failure, and one declared
 * here and not passed is the same.
 *
 * ## The events with no params
 *
 * Seven of the eleven are declared in the enum, seeded with templates, and
 * emitted by nothing. They get an empty list and the admin screen says so. A
 * template written against an event that never fires is not a bug — somebody
 * has to write it before the emitter lands — but staff should know which is
 * which before they spend an afternoon on the copy.
 */

export const EVENT_PARAMS = {
  enquiry_received: [
    "ref",
    "summary",
    "neededBy",
    "closesAt",
    "area",
    "lineCount",
    "enquiryId",
    "shortLink",
  ],
  quote_received: ["ref", "businessName", "businessSlug", "revision", "enquiryId", "shortLink"],
  quote_revised: ["ref", "businessName", "businessSlug", "revision", "enquiryId", "shortLink"],
  quote_accepted: ["ref", "quoteRef", "amount", "enquiryId", "shortLink"],

  // Declared, seeded, and emitted by nothing yet.
  enquiry_unanswered: [],
  enquiry_escalated: [],
  quote_expiring: [],
  review_posted: [],
  review_requested: [],
  document_expiring: [],
  weekly_digest: [],
} as const satisfies Record<NotificationEvent, readonly string[]>;

export type ParamsOf<E extends NotificationEvent> = (typeof EVENT_PARAMS)[E][number];

/** True where something in the codebase actually sends this event. */
export function isEmitted(event: NotificationEvent): boolean {
  return EVENT_PARAMS[event].length > 0;
}

export function paramsFor(event: NotificationEvent): readonly string[] {
  return EVENT_PARAMS[event];
}

/**
 * The binding.
 *
 * A call site writes `withParams("enquiry_received", { … })` and the compiler
 * checks the object against the declaration above — every declared key present,
 * and no key that is not declared. Returns the object unchanged; it exists for
 * the type, not for the value.
 */
export function withParams<E extends NotificationEvent>(
  _event: E,
  params: Record<ParamsOf<E>, string | number>,
): Record<string, string | number> {
  return params;
}

/** Every `{placeholder}` a template body, subject or action label references. */
export function placeholdersIn(...parts: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const match of part.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) found.add(match[1]!);
  }
  return [...found].sort();
}

/**
 * Placeholders a template uses that its event does not supply.
 *
 * Every one of these is a `MissingParamError` at send time, which is a seller
 * not being told something. Caught here, it is a red line under a textarea.
 */
export function unknownPlaceholders(
  event: NotificationEvent,
  ...parts: (string | null | undefined)[]
): string[] {
  const supplied = new Set<string>(paramsFor(event));
  return placeholdersIn(...parts).filter((name) => !supplied.has(name));
}
