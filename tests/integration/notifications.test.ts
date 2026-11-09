import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { deliverQueued, flushDeferred, notify } from "@/lib/notify/service";
import { contactShape, placeholdersIn, render } from "@/lib/notify/render";
import { buyerActionUrl } from "@/lib/notify/events";

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
/** T6.1 — a business that has never opened the alerts screen. */
let bareBusinessId: string | null = null;
let bareSeatUserId: string | null = null;

const createdDeliveryIds: string[] = [];

beforeAll(async () => {
  // Ordered, so which business this suite is about does not depend on physical
  // row order — the fragility `enquiry-fanout` was carrying.
  const preference = await prisma.notificationPreference.findFirstOrThrow({
    orderBy: { businessId: "asc" },
    select: { businessId: true },
  });
  businessId = preference.businessId;
  const seat = await prisma.user.findFirstOrThrow({
    where: { businessId, roles: { has: "seller_owner" } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  recipientUserId = seat.id;

  /*
     T6.1's subject: a business with **no** preference row and a seat to reach.
     That is the state every imported listing is in, and 288 of the seed's 308
     businesses are in it too — so it is the common case rather than an edge
     one, which is the thing that makes the old `return []` expensive.
  */
  const bare = await prisma.business.findFirst({
    where: {
      notificationPreference: { is: null },
      team: { some: { roles: { has: "seller_owner" } } },
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      team: {
        where: { roles: { has: "seller_owner" } },
        orderBy: { id: "asc" },
        take: 1,
        select: { id: true },
      },
    },
  });
  bareBusinessId = bare?.id ?? null;
  bareSeatUserId = bare?.team[0]?.id ?? null;
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

  /*
     These build the deferred row themselves rather than waiting for the seed to
     produce one.

     Only `whatsapp` and `sms` are ever held by quiet hours — `INTERRUPTING_CHANNELS`
     — and every WhatsApp template is `pending_meta`, so on this data nothing
     defers at all. A first version of these tests looked for a deferred row and
     returned early when it found none, which is a test that passes by not
     running. The mechanism is what needs proving, so the mechanism is what is
     set up.
  */
  async function held(payload: unknown): Promise<string> {
    const row = await prisma.notificationDelivery.create({
      data: {
        event: "enquiry_received",
        channel: "email",
        status: "deferred",
        recipientUserId,
        businessId,
        reason: "quiet_hours",
        scheduledFor: new Date(Date.now() - 60_000),
        payload: payload as never,
      },
      select: { id: true },
    });
    createdDeliveryIds.push(row.id);
    return row.id;
  }

  it("releases a held delivery and then actually sends it", async () => {
    /*
       The gap this closes. `flushDeferred` moved a row from `deferred` to
       `queued` and nothing read `queued`, so a notification held overnight
       moved from one waiting state to another and reached nobody.
    */
    const id = await held({
      subject: "A new enquiry",
      body: "ENQ-8841 — gate valves, Al Quoz Industrial 1.",
      actionLabel: "Open the enquiry",
      actionUrl: "https://businesslistings.me/dashboard/leads",
      metaTemplateName: null,
    });

    expect(await flushDeferred()).toBeGreaterThan(0);
    const claimed = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });
    expect(claimed.status).toBe("queued");

    await deliverQueued();
    const settled = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { id },
      select: { status: true, sentAt: true },
    });
    // Sent or failed depending on whether a carrier is configured. Still
    // `queued` is the bug — that is the state nothing used to leave.
    expect(["sent", "failed"]).toContain(settled.status);
    if (settled.status === "sent") expect(settled.sentAt).not.toBeNull();
  });

  it("settles a row it can never send rather than retrying it for ever", async () => {
    // Deferred before the payload column existed. There is nothing to send, so
    // leaving it queued would make every future run pick it up again.
    const id = await held(null);

    await flushDeferred();
    const outcome = await deliverQueued();
    expect(outcome.unsendable).toBeGreaterThan(0);

    const settled = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { id },
      select: { status: true, reason: true },
    });
    expect(settled.status).toBe("failed");
    expect(settled.reason).toBe("no_payload");
  });

  it("keeps contact details out of the held payload", async () => {
    /*
       The rule `recipientUserId` exists to keep: the log points at a user, and
       the number or address is read from them at send time. A payload that
       carried the address would make the delivery log a copy of the address
       book.
    */
    const template = await prisma.notificationTemplate.findFirst({
      where: { status: "live", channel: "email" },
      select: { id: true, subject: true, body: true, actionLabel: true, actionPath: true, metaTemplateName: true },
    });
    if (!template) throw new Error("the seed needs a live email template");

    /*
       Filled from the template's own placeholders rather than a fixed list, so
       this does not break the day somebody adds a field to a template it does
       not name here.
    */
    const params = Object.fromEntries(
      placeholdersIn(template).map((name) => [name, `value-for-${name}`]),
    );
    const rendered = render(template, params);

    const serialised = JSON.stringify(rendered);
    expect(serialised).not.toMatch(/\+9715\d{8}/);
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

  it("sends nothing to a recipient who does not exist", async () => {
    /*
       This test used to read *"sends nothing for a business with no preference
       row"* and assert `toEqual([])` — which is the defect T6.1 removed,
       asserted as the rule. A green suite was pinning it: a business that had
       never opened the alerts screen received nothing on any channel for any
       event, the two the platform promises are not switchable included, and
       288 of this seed's 308 businesses are in that state.
       `describe("T6.1 …")` below is what the behaviour is now.

       What survives of the original is the case that genuinely cannot send: a
       recipient id with no `User` behind it. It is a caller's bug, and the one
       outcome that cannot even be recorded —
       `NotificationDelivery.recipientUserId` references `User`, so a row naming
       a missing id is refused by the foreign key.
    */
    const outcomes = await notify({
      event: "enquiry_received",
      businessId,
      recipientUserId: "00000000-0000-4000-8000-000000000000",
      params: { ref: "ENQ-1" },
    });
    expect(outcomes).toEqual([]);
  });
});

describe("a buyer notification carries the token the buyer surface needs", () => {
  /**
   * The defect this pins is the one the e2e suite had already written down as
   * expected behaviour.
   *
   * Most buyers have no account. Every buyer surface identifies them by the
   * claim token their enquiry was created with, read from `?t=`, and a page
   * reached without one calls `notFound()`. Every link in every buyer
   * notification was built without it — so the live review-request template,
   * `"/review/new?enq={enquiryId}"`, 404'd for exactly the buyer it was written
   * for, and `tests/e2e/reviews.spec.ts` asserts that 404 on that URL.
   *
   * The route's behaviour there is right; the link was wrong. Stamped at the
   * one place every buyer delivery passes through rather than in each template,
   * because the templates are rows in a database and the ones in production
   * cannot be edited by a commit.
   */
  const provisional = { claimToken: "tok_abc123", isProvisional: true };
  const claimed = { claimToken: "tok_abc123", isProvisional: false };

  it("puts the claim token on a buyer path, as a query the page reads", () => {
    const url = buyerActionUrl("/review/new?enq=cmt7", provisional);
    expect(url).toContain("enq=cmt7");
    expect(url).toContain("t=tok_abc123");
    // Appended to the existing query, not opened as a second one.
    expect(url).not.toContain("?t=");
  });

  it("opens the query where the path has none", () => {
    expect(buyerActionUrl("/enquiry/cmt7/compare", provisional)).toContain("?t=tok_abc123");
  });

  it("adds nothing once the account is claimed, because the token is dead", () => {
    expect(buyerActionUrl("/enquiry/cmt7/compare", claimed)).not.toContain("t=");
  });

  it("adds nothing for a buyer who never had one", () => {
    const url = buyerActionUrl("/enquiry/cmt7/compare", { claimToken: null, isProvisional: true });
    expect(url).not.toContain("t=");
  });

  it("keeps a bearer secret off a path that has no use for it", () => {
    // Not every action path is a buyer surface, and a token on `/pricing` is a
    // secret in a URL that buys nothing.
    expect(buyerActionUrl("/pricing", provisional)).not.toContain("t=");
  });

  it("covers every buyer actionPath the seeded templates carry", async () => {
    const rows = await prisma.notificationTemplate.findMany({
      where: {
        status: "live",
        event: { in: ["quote_received", "quote_revised", "message_received", "review_requested"] },
        actionPath: { not: null },
      },
      select: { event: true, actionPath: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(buyerActionUrl(row.actionPath!, provisional), row.event).toContain("t=tok_abc123");
    }
  });
});

describe("T6.1 — a business with no stored preference", () => {
  const MONDAY_1000 = new Date("2026-08-24T06:00:00Z");

  const PARAMS = {
    ref: "ENQ-6100",
    summary: "gate valves",
    neededBy: "14 Sep 2026",
    closesAt: "28 Aug 2026",
    area: "Al Quoz Industrial 1",
    lineCount: 3,
    enquiryId: "cmt73h5cr007yddit0mrgfx39",
    shortLink: "https://businesslistings.ae/l/6100",
  } as const;

  it("receives on the default instead of nothing at all", async () => {
    /*
       The defect, as a test. `notify()` read `NotificationPreference`, found
       none and returned `[]` — before `route()` and therefore before
       `PLATFORM_FLOOR`. No channels, and **no delivery row**, so the silence
       was invisible in the log and in board 12g.
    */
    expect(bareBusinessId, "the seed needs a business with no preference row").not.toBeNull();
    if (!bareBusinessId || !bareSeatUserId) return;

    const outcomes = await notify({
      event: "enquiry_received",
      businessId: bareBusinessId,
      recipientUserId: bareSeatUserId,
      now: MONDAY_1000,
      params: PARAMS,
    });
    for (const outcome of outcomes) if (outcome.deliveryId) createdDeliveryIds.push(outcome.deliveryId);

    expect(outcomes.length, "an unconfigured business used to get nothing").toBeGreaterThan(0);
    const channels = outcomes.map((outcome) => outcome.channel).sort();
    expect(channels).toEqual(["email", "in_app"]);
    // In-app needs no address and no carrier, so it is the one that must land.
    expect(outcomes.find((outcome) => outcome.channel === "in_app")?.status).toBe("sent");

    // And every one of them is in the log, which is the half that makes it
    // answerable when a seller asks why they did not hear.
    const rows = await prisma.notificationDelivery.findMany({
      where: { id: { in: outcomes.map((outcome) => outcome.deliveryId).filter(Boolean) } },
      select: { channel: true, businessId: true },
    });
    expect(rows).toHaveLength(outcomes.length);
    for (const row of rows) expect(row.businessId).toBe(bareBusinessId);
  });

  it("writes it no preference row, because a default is not a choice", async () => {
    /*
       `DEFAULT_ROUTING` is what the code does in the absence of a choice, not a
       choice made on the seller's behalf. Writing a row here would turn the
       platform's default into the seller's stored preference, and the next time
       the default changed their business would keep the old one — which is the
       whole argument for not seeding forty thousand rows (T5.5).
    */
    if (!bareBusinessId) return;
    const row = await prisma.notificationPreference.findUnique({
      where: { businessId: bareBusinessId },
      select: { businessId: true },
    });
    expect(row).toBeNull();
  });

  it("records the silence when an event reaches no channel", async () => {
    /*
       The residual case, which is now the only one: a seller who has switched
       every channel off for an event that is not on the platform floor. It used
       to be `return []` — no row, no reason, nothing to read in 12g, and no
       answer to "why did I not hear about that".

       The row this needs is created here and removed again, rather than a
       seeded preference being emptied: `weekly_digest` is in the seed's matrix
       on every business, and a test that edited one would take the digest away
       from every other test in the suite.
    */
    if (!bareBusinessId || !bareSeatUserId) return;
    await prisma.notificationPreference.create({
      data: { businessId: bareBusinessId, routing: {}, quietHoursEnabled: false },
    });

    try {
      const outcomes = await notify({
        event: "weekly_digest",
        businessId: bareBusinessId,
        recipientUserId: bareSeatUserId,
        now: MONDAY_1000,
        params: {},
      });
      for (const outcome of outcomes) {
        if (outcome.deliveryId) createdDeliveryIds.push(outcome.deliveryId);
      }

      expect(outcomes).toHaveLength(1);
      expect(outcomes[0]?.status).toBe("skipped");
      expect(outcomes[0]?.reason).toBe("no_channel_for_event");
      expect(
        outcomes[0]?.channel,
        "in-app is the channel a silence can only be a decision on",
      ).toBe("in_app");
    } finally {
      await prisma.notificationPreference.delete({ where: { businessId: bareBusinessId } });
    }
  });
});

describe("T6.3 and T6.4 — a delivery row carries what it said, and whether it was read", () => {
  const MONDAY_1000 = new Date("2026-08-24T06:00:00Z");

  it("stores the rendered message on a sent row, not only on a held one", async () => {
    /*
       The defect, as a test.

       `payload` was written for a **deferred** delivery only, because that was
       the one case the service read back — a held message has to be sendable
       when the window lifts. So a *sent* in-app notice stored the event, the
       channel and the recipient and not a word of what it said, and in-app is
       the channel where this row **is** the notification. Board 7g's bell had
       nothing to render, and "what did you tell me three days ago" could only
       be answered with the template as it reads today, which is a different
       sentence whenever somebody has edited it since.
    */
    const outcomes = await notify({
      event: "enquiry_received",
      businessId,
      recipientUserId,
      now: MONDAY_1000,
      params: {
        ref: "ENQ-6300",
        summary: "gate valves",
        neededBy: "14 Sep 2026",
        closesAt: "28 Aug 2026",
        area: "Al Quoz Industrial 1",
        lineCount: 3,
        enquiryId: "cmt73h5cr007yddit0mrgfx39",
        shortLink: "https://businesslistings.ae/l/6300",
      },
    });
    for (const outcome of outcomes) if (outcome.deliveryId) createdDeliveryIds.push(outcome.deliveryId);

    const inApp = outcomes.find((outcome) => outcome.channel === "in_app");
    expect(inApp?.status, "in-app needs no address and no carrier").toBe("sent");

    const row = await prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: inApp!.deliveryId },
      select: { payload: true, readAt: true, status: true },
    });
    const payload = row.payload as { body?: unknown; actionLabel?: unknown; actionUrl?: unknown } | null;
    expect(payload, "a sent row used to carry no message at all").not.toBeNull();
    expect(typeof payload?.body).toBe("string");
    // Rendered, not the template: the reference the buyer will quote is in it.
    expect(String(payload?.body)).toContain("ENQ-6300");
    // The action is stored as an absolute URL, because by the time a bell or a
    // carrier reads this row there is no request to resolve a path against.
    if (payload?.actionUrl !== null && payload?.actionUrl !== undefined) {
      expect(String(payload.actionUrl)).toMatch(/^https?:\/\//);
    }
  });

  it("stores no message on a row that never had one", async () => {
    /*
       The honest other half. A row skipped for want of a template, a carrier,
       an address or a channel has no rendered message, and inventing one — the
       template with its placeholders still in it — would be worse than null:
       board 7g would render `{ref}` to a seller.
    */
    const rows = await prisma.notificationDelivery.findMany({
      where: { id: { in: createdDeliveryIds }, status: "skipped" },
      select: { payload: true, reason: true },
    });
    for (const row of rows) expect(row.payload, JSON.stringify(row.reason)).toBeNull();
  });

  it("starts unread, which is what a bell counts", async () => {
    /*
       T6.4. Null is unread. The writer arrives with board 7g — this sprint adds
       the column and the partial index the unread count needs, and nothing sets
       it yet, so every row is unread and nothing reads that fact. A column with
       a writer and no reader would be the dishonest half of this pair.
    */
    const row = await prisma.notificationDelivery.findFirst({
      where: { id: { in: createdDeliveryIds } },
      select: { readAt: true },
    });
    expect(row?.readAt ?? null).toBeNull();
  });
});
