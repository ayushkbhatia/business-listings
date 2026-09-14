/**
 * What is wrong with a template draft, knowable without the database.
 *
 * Board 12g `B2`, `B3`, `B4` and `B8`. Pure, so the editor runs these as you
 * type and `saveTemplateVersion` runs the same function on submit: a rule held
 * only on the server is a red banner after the fact, and one held only in the
 * browser is a suggestion.
 */
import type { NotificationChannel, NotificationEvent } from "@/lib/db/generated/enums";
import { forbiddenPlaceholders, sampleParams, unknownPlaceholders } from "./params";
import { render } from "./render";
import { smsLength } from "./sms-length";

export const CHANNELS = ["whatsapp", "email", "sms", "in_app"] as const satisfies readonly NotificationChannel[];

/** Meta's limit on a template body. A longer one is refused at submission, days later. */
export const WHATSAPP_BODY_LIMIT = 1024;
/** Meta template names: lowercase letters, digits and underscores. */
const META_NAME = /^[a-z0-9_]{1,512}$/;

export type TemplateRefusal =
  | "not_found"
  | "stale"
  | "empty_body"
  | "unchanged"
  | "unknown_placeholder"
  | "forbidden_placeholder"
  | "email_needs_subject"
  | "sms_too_long"
  | "whatsapp_too_long"
  | "whatsapp_needs_meta_name"
  | "meta_name_invalid"
  | "meta_name_taken"
  | "action_path_invalid"
  | "twin_without_goods_body"
  | "neutral_with_twin"
  | "not_pending"
  | "not_draft"
  | "rejection_needs_note"
  | "test_needs_approval"
  | "test_no_address"
  | "test_no_carrier"
  | "test_throttled";

export interface DraftInput {
  event: NotificationEvent;
  channel: NotificationChannel;
  subject: string | null;
  body: string;
  actionLabel: string | null;
  actionPath: string | null;
  metaTemplateName: string | null;
}

/**
 * Everything wrong with a draft that can be known without the database.
 *
 * Pure, and exported so the editor runs the same checks as you type that the
 * save runs on submit: a rule enforced only on the server is a red banner after
 * the fact, and one enforced only in the browser is a suggestion.
 */
export function draftProblems(draft: DraftInput, origin: string): { error: TemplateRefusal; detail?: Record<string, string> }[] {
  const problems: { error: TemplateRefusal; detail?: Record<string, string> }[] = [];
  const body = draft.body.trim();
  if (body === "") problems.push({ error: "empty_body" });

  const parts = [body, draft.subject, draft.actionLabel, draft.actionPath];
  const forbidden = forbiddenPlaceholders(...parts);
  if (forbidden.length > 0) problems.push({ error: "forbidden_placeholder", detail: { names: forbidden.map((n) => `{${n}}`).join(", ") } });
  const unknown = unknownPlaceholders(draft.event, ...parts).filter((n) => !forbidden.includes(n));
  if (unknown.length > 0) problems.push({ error: "unknown_placeholder", detail: { names: unknown.map((n) => `{${n}}`).join(", ") } });

  if (draft.channel === "email" && !draft.subject?.trim()) problems.push({ error: "email_needs_subject" });
  if (draft.actionPath && !draft.actionPath.trim().startsWith("/")) problems.push({ error: "action_path_invalid" });

  if (draft.channel === "whatsapp") {
    if (body.length > WHATSAPP_BODY_LIMIT) problems.push({ error: "whatsapp_too_long", detail: { length: String(body.length), limit: String(WHATSAPP_BODY_LIMIT) } });
    const name = draft.metaTemplateName?.trim() ?? "";
    if (!name) problems.push({ error: "whatsapp_needs_meta_name" });
    else if (!META_NAME.test(name)) problems.push({ error: "meta_name_invalid" });
  }

  // `B8`, measured on the rendered message — only once the placeholders are all real ones.
  if (draft.channel === "sms" && body !== "" && unknown.length === 0 && forbidden.length === 0) {
    const rendered = render({ body, actionPath: draft.actionPath }, sampleParams(draft.event, origin)).body;
    const length = smsLength(rendered);
    if (!length.fits) {
      problems.push({
        error: "sms_too_long",
        detail: { units: String(length.units), limit: String(length.limit), encoding: length.encoding, chars: length.offending.join(" ") },
      });
    }
  }
  return problems;
}

