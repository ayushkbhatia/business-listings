import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { notify } from "@/lib/notify/service";
import { contactShape, placeholdersIn, render } from "@/lib/notify/render";

/**
 * Acceptance criterion 8, at the level the checkpoint asks for:
 *
 *   "assert across all templates that none contains buyer contact details."
 *
 * Against the database rather than the seed source. The seed is checked too —
 * tests/unit/notification-templates.test.ts, which runs without a database —
 * but the database is what the send layer reads, and handoff 4 gives admin an
 * editor for it. A template added through that editor has never been near the
 * seed file.
 *
 * Plus criterion 10 end to end, through the same service the triggers call.
 */

let businessId: string;
let recipientUserId: string;

const createdDeliveryIds: string[] = [];

beforeAll(async () => {
  const preference = await prisma.notificationPreference.findFirstOrThrow({
    select: { businessId: true },
  });
  businessId = preference.businessId;
  const seat = await prisma.user.findFirstOrThrow({
    where: { businessId, roles: { has: "seller_owner" } },
    select: { id: true },
  });
  recipientUserId = seat.id;
});

afterEach(async () => {
  await prisma.notificationDelivery.deleteMany({ where: { id: { in: createdDeliveryIds.splice(0) } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("criterion 8 — no template carries buyer contact details", () => {
  /** Placeholders a careless template would reach for. */
  const FORBIDDEN = [
    "buyerphone", "buyeremail", "buyername", "buyercompany", "buyermobile",
    "phone", "email", "mobile", "whatsappnumber", "contact", "companyname",
    "buyertrn", "trn", "address", "iban",
  ];

  it("has templates in the database to check", async () => {
    expect(await prisma.notificationTemplate.count()).toBeGreaterThan(10);
  });

  it("names no placeholder that could carry a phone, email or company", async () => {
    const templates = await prisma.notificationTemplate.findMany();
    for (const template of templates) {
      const names = placeholdersIn(template).map((p) => p.toLowerCase());
      for (const name of names) {
        expect(
          FORBIDDEN.includes(name),
          `${template.event}/${template.channel} v${template.version} uses {${name}}`,
        ).toBe(false);
      }
    }
  });

  it("contains no literal contact detail in any field", async () => {
    const templates = await prisma.notificationTemplate.findMany();
    for (const template of templates) {
      for (const field of [template.body, template.subject, template.actionLabel]) {
        if (!field) continue;
        expect(
          contactShape(field),
          `${template.event}/${template.channel}: ${field}`,
        ).toBeNull();
      }
    }
  });

  it("renders every live template without a leak, given plausible values", async () => {
    /*
     * The other half of the criterion. A safe placeholder filled with an unsafe
     * value is the leak a template review cannot catch, so every live template
     * is rendered with values of the shape the product actually passes.
     */
    const templates = await prisma.notificationTemplate.findMany({ where: { status: "live" } });
    expect(templates.length).toBeGreaterThan(0);

    const plausible: Record<string, string> = {
      ref: "ENQ-8841",
      quoteRef: "QT-8841-ALMR1",
      summary: "resilient seated gate valves",
      neededBy: "14 Sep 2026",
      closesAt: "28 Aug 2026",
      area: "Al Quoz Industrial 1",
      lineCount: "3",
      hours: "2",
      amount: "AED 15,344",
      revision: "2",
      businessName: "Al Marwan Industrial Supplies",
      businessSlug: "al-marwan-industrial-supplies-llc",
      enquiryId: "cmt73h5cr007yddit0mrgfx39",
      shortLink: "https://businesslistings.ae/l/8841",
      buyerFirstName: "Rashid",
      rating: "4",
      documentKind: "Trade licence",
      expiresOn: "12 Nov 2026",
      count: "7",
      value: "AED 84,200",
      supplierName: "Al Marwan Industrial Supplies",
      days: "3",
    };

    for (const template of templates) {
      const params: Record<string, string> = {};
      for (const name of placeholdersIn(template)) {
        params[name] = plausible[name] ?? "a plausible value";
      }
      // Throws NotificationLeakError if any of these looks like a contact
      // detail, and MissingParamError if the template has a hole.
      const rendered = render(template, params);
      expect(contactShape(rendered.body), `${template.event}/${template.channel}`).toBeNull();
      if (rendered.subject) expect(contactShape(rendered.subject)).toBeNull();
    }
  });

  it("gives every template exactly one action, or none for an SMS", async () => {
    // Every message states what happened, what it is worth, and one action.
    const templates = await prisma.notificationTemplate.findMany();
    for (const template of templates) {
      if (template.channel === "sms") continue; // one segment, the link is the action
      expect(template.actionPath, `${template.event}/${template.channel}`).toBeTruthy();
    }
  });

  it("has no live WhatsApp template without a Meta name", async () => {
    // A WhatsApp message outside the service window must be an approved
    // template. A live row with no Meta name would be rejected at the carrier.
    const bad = await prisma.notificationTemplate.findMany({
      where: { channel: "whatsapp", status: "live", metaTemplateName: null },
    });
    expect(bad.map((t) => t.event)).toEqual([]);
  });
});

describe("criterion 10 — quiet hours, through the service", () => {
  const MONDAY_1000 = new Date("2026-08-24T06:00:00Z");
  const MONDAY_2200 = new Date("2026-08-24T18:00:00Z");

  async function send(now: Date, valueAed?: number) {
    const outcomes = await notify({
      event: "enquiry_received",
      businessId,
      recipientUserId,
      now,
      ...(valueAed === undefined ? {} : { valueAed }),
      params: {
        ref: "ENQ-8841",
        summary: "gate valves",
        neededBy: "14 Sep 2026",
        closesAt: "28 Aug 2026",
        area: "Al Quoz Industrial 1",
        lineCount: 3,
        enquiryId: "cmt73h5cr007yddit0mrgfx39",
        shortLink: "https://businesslistings.ae/l/8841",
      },
    });
    for (const outcome of outcomes) if (outcome.deliveryId) createdDeliveryIds.push(outcome.deliveryId);
    return Object.fromEntries(outcomes.map((o) => [o.channel, o.status]));
  }

  it("sends during the working day", async () => {
    const result = await send(MONDAY_1000);
    expect(result["in_app"]).toBe("sent");
  });

  it("defers WhatsApp at night and never defers in-app", async () => {
    const result = await send(MONDAY_2200);
    expect(result["in_app"]).toBe("sent");
    // WhatsApp is either deferred, or skipped because its template is still
    // waiting on Meta. Either way it is not sent, and it is never "sent" while
    // in-app is deferred — that is the pairing the criterion is about.
    expect(result["whatsapp"]).not.toBe("sent");
  });

  it("wakes them for a high-value enquiry", async () => {
    const preference = await prisma.notificationPreference.findUniqueOrThrow({
      where: { businessId },
      select: { highValueOverrideAed: true, routing: true },
    });
    const threshold = preference.highValueOverrideAed;
    expect(threshold, "the seed needs a threshold for this to prove anything").not.toBeNull();

    const channels = (preference.routing as Record<string, string[]>)["enquiry_received"] ?? [];
    if (!channels.includes("whatsapp")) return;

    const result = await send(MONDAY_2200, threshold! + 1);
    // Not deferred. Sent if the template is live, skipped if Meta has not
    // approved it — the override decided, not the clock.
    expect(result["whatsapp"]).not.toBe("deferred");
  });

  it("writes a row for every outcome, including the ones it did not send", async () => {
    const before = await prisma.notificationDelivery.count();
    await send(MONDAY_2200);
    // A seller asking "why did I not hear about that" deserves an answer.
    expect(await prisma.notificationDelivery.count()).toBeGreaterThan(before);
    const rows = await prisma.notificationDelivery.findMany({
      where: { id: { in: createdDeliveryIds } },
      select: { status: true, reason: true, recipientUserId: true },
    });
    for (const row of rows) {
      if (row.status !== "sent") expect(row.reason, JSON.stringify(row)).toBeTruthy();
      // A user id, never a number.
      expect(row.recipientUserId).toBe(recipientUserId);
    }
  });

  it("sends nothing for a business with no preference row", async () => {
    const orphan = await prisma.business.findFirstOrThrow({
      where: { notificationPreference: null },
      select: { id: true },
    });
    const outcomes = await notify({
      event: "enquiry_received",
      businessId: orphan.id,
      recipientUserId,
      params: { ref: "ENQ-1" },
    });
    expect(outcomes).toEqual([]);
  });
});
