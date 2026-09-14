import { describe, expect, it } from "vitest";
import { draftProblems, WHATSAPP_BODY_LIMIT, type DraftInput } from "./draft";

/**
 * Board 12g — the checks the editor runs as you type and the save runs on
 * submit. One function, so the two cannot disagree.
 */

const ORIGIN = "https://businesslistings.me";
const draft = (over: Partial<DraftInput>): DraftInput => ({
  event: "enquiry_received",
  channel: "in_app",
  subject: null,
  body: "New enquiry {ref} for {area}.",
  actionLabel: "Open",
  actionPath: "/dashboard/leads/{enquiryId}",
  metaTemplateName: null,
  ...over,
});
const errors = (over: Partial<DraftInput>) => draftProblems(draft(over), ORIGIN).map((p) => p.error);

describe("what a body may say", () => {
  it("passes a body that uses only what the event supplies", () => {
    expect(errors({})).toEqual([]);
  });

  it("refuses a placeholder the event does not supply (B2)", () => {
    const [problem] = draftProblems(draft({ body: "Worth {quotedValue}" }), ORIGIN);
    expect(problem).toEqual({ error: "unknown_placeholder", detail: { names: "{quotedValue}" } });
  });

  it("refuses a name that could only carry contact details, and says so rather than 'not supplied' (B3)", () => {
    expect(errors({ body: "Call {buyerPhone}" })).toEqual(["forbidden_placeholder"]);
    expect(errors({ actionPath: "/x/{buyerEmail}" })).toEqual(["forbidden_placeholder"]);
  });

  it("refuses an empty body and an action link that is not a path", () => {
    expect(errors({ body: "   " })).toEqual(["empty_body"]);
    expect(errors({ actionPath: "https://elsewhere.example" })).toEqual(["action_path_invalid"]);
  });
});

describe("per channel", () => {
  it("needs a subject on email", () => {
    expect(errors({ channel: "email", subject: "" })).toEqual(["email_needs_subject"]);
    expect(errors({ channel: "email", subject: "Enquiry {ref}" })).toEqual([]);
  });

  it("needs a valid Meta name on WhatsApp, and Meta's body limit", () => {
    expect(errors({ channel: "whatsapp", metaTemplateName: null })).toEqual(["whatsapp_needs_meta_name"]);
    expect(errors({ channel: "whatsapp", metaTemplateName: "BL Enquiry" })).toEqual(["meta_name_invalid"]);
    expect(errors({ channel: "whatsapp", metaTemplateName: "bl_enquiry_received_v2" })).toEqual([]);
    expect(errors({ channel: "whatsapp", metaTemplateName: "bl_x", body: "a".repeat(WHATSAPP_BODY_LIMIT + 1) })).toEqual(["whatsapp_too_long"]);
  });

  it("measures an SMS filled in, not as written (B8)", () => {
    // Short as written; `{area}` and `{shortLink}` fill it past 160.
    const body = "New enquiry {ref}: {summary}. {lineCount} lines for {area}, needed by {neededBy}. Closes {closesAt}. Quote now at {shortLink} before it closes.";
    expect(body.length).toBeLessThan(160);
    const [problem] = draftProblems(draft({ channel: "sms", body }), ORIGIN);
    expect(problem?.error).toBe("sms_too_long");
    expect(problem?.detail?.["encoding"]).toBe("gsm7");
  });

  it("holds an SMS with an em dash to 70", () => {
    const [problem] = draftProblems(draft({ channel: "sms", body: "New enquiry {ref} — {lineCount} lines for {area}. {shortLink}" }), ORIGIN);
    expect(problem).toMatchObject({ error: "sms_too_long", detail: { limit: "70", encoding: "unicode", chars: "—" } });
  });
});
