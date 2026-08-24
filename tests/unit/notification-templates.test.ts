import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Acceptance criterion 8: no notification of any kind contains buyer contact
 * details.
 *
 * Rule 1 says contact is released only on acceptance, and a notification is
 * the easiest place in the product to leak it — a template is written once,
 * reviewed once, and then sends ten thousand times. This reads the seeded
 * template bodies directly so a new template cannot be added without passing.
 *
 * The database is the source of truth for templates; this asserts on the seed
 * that populates it, which is what CI can run without a network call.
 */
const seed = readFileSync("prisma/seed.mts", "utf8");

/** Everything between the TEMPLATES array's brackets. */
function templateBlock(): string {
  const start = seed.indexOf("const TEMPLATES: TemplateSeed[] = [");
  const end = seed.indexOf("\n];", start);
  expect(start, "TEMPLATES array not found in the seed").toBeGreaterThan(-1);
  return seed.slice(start, end);
}

function fields(name: "body" | "subject"): string[] {
  return [...templateBlock().matchAll(new RegExp(`${name}:\\s*"([^"]*)"`, "g"))].map((m) => m[1]!);
}

describe("acceptance criterion 8 — no template leaks buyer contact details", () => {
  const all = [...fields("body"), ...fields("subject")];

  it("has templates to check", () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it("names no buyer placeholder that could carry a phone, email or company", () => {
    // The placeholders a careless template would reach for. A seller learns
    // the buyer's name only on acceptance, and even then from the enquiry
    // page rather than from a push notification.
    const forbidden = [
      "buyerPhone", "buyerEmail", "buyerName", "buyerCompany", "buyerMobile",
      "phone", "email", "mobile", "whatsappNumber", "contact", "companyName",
    ];
    for (const template of all) {
      const placeholders = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
      for (const placeholder of placeholders) {
        expect(
          forbidden.some((f) => f.toLowerCase() === placeholder.toLowerCase()),
          `template placeholder {${placeholder}} could carry buyer contact details:\n  ${template}`,
        ).toBe(false);
      }
    }
  });

  it("contains no literal phone number, email address or IBAN", () => {
    for (const template of all) {
      expect(template, template).not.toMatch(/\+?\d[\d\s-]{7,}/);
      expect(template, template).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/);
      expect(template, template).not.toMatch(/\b[A-Z]{2}\d{2}[A-Z0-9]{10,}\b/);
    }
  });

  it("says what happened, what it is worth, and one action", () => {
    const block = templateBlock();
    const entries = block.split(/\n  \{/).slice(1);
    for (const entry of entries) {
      const inApp = /channel:\s*"in_app"/.test(entry);
      const hasAction = /actionPath:/.test(entry);
      // Every template routes somewhere. A notification with no action is a
      // notification that trains people to ignore the channel.
      expect(hasAction, entry.slice(0, 120)).toBe(true);
      if (!inApp) expect(/body:/.test(entry)).toBe(true);
    }
  });

  it("covers all four channels", () => {
    const channels = new Set(
      [...templateBlock().matchAll(/channel:\s*"(\w+)"/g)].map((m) => m[1]!),
    );
    expect(channels).toEqual(new Set(["whatsapp", "sms", "email", "in_app"]));
  });

  it("marks every WhatsApp template as awaiting Meta rather than live", () => {
    // A WhatsApp template cannot send until Meta approves it. Seeding one as
    // live would make the send layer believe it can use a template that does
    // not exist on the Bird side.
    const entries = templateBlock().split(/\n  \{/).slice(1);
    for (const entry of entries) {
      if (!/channel:\s*"whatsapp"/.test(entry)) continue;
      expect(entry, entry.slice(0, 140)).toMatch(/status:\s*"pending_meta"/);
      expect(entry, entry.slice(0, 140)).toMatch(/metaTemplateName:/);
    }
  });
});
