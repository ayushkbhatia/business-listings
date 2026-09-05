import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { notify } from "@/lib/notify/service";
import { onEnquiryDelivered } from "@/lib/notify/events";
import { inQuietHours, quietLiftsAt, route } from "@/lib/notify/routing";

/**
 * Board 7e §3 — an unverified channel receives nothing, and nothing is dropped.
 *
 * The rule that spans this handoff, asserted at the layer that enforces it.
 * Before this, `lib/notify/service.ts` addressed a notification from
 * `user.phone` and `user.email` directly, which made "reachable on" a label
 * rather than a rule: a seat could sit amber on two screens and still receive on
 * the channel both screens said it could not.
 *
 * Fixtures carry `PREFIX` and are deleted by it. The integration project runs
 * `fileParallelism: false` against one shared Postgres, and a leak is somebody
 * else's red test tomorrow.
 */

const PREFIX = "7E-DELIVERY-FIXTURE";

let businessId: string;
let ownerId: string;
let buyerId: string;
/*
   The seeded preference, put back afterwards.

   These tests rewrite the matrix on a real seeded supplier, and a suite that
   left it rewritten would turn somebody else's file red tomorrow with a
   failure that names none of this — which has happened twice in this project.
*/
let originalRouting: unknown;
let originalQuiet: boolean;

const seats: string[] = [];
const enquiries: string[] = [];

beforeAll(async () => {
  const business = await prisma.business.findFirstOrThrow({
    where: {
      claimStatus: "claimed",
      slug: { not: "al-marwan-industrial-supplies-llc" },
      team: { some: { roles: { has: "seller_owner" } } },
      notificationPreference: { isNot: null },
    },
    orderBy: { slug: "asc" },
    select: { id: true },
  });
  businessId = business.id;

  ownerId = (
    await prisma.user.findFirstOrThrow({
      where: { businessId, roles: { has: "seller_owner" } },
      select: { id: true },
    })
  ).id;

  buyerId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "buyer" } },
      orderBy: { id: "asc" },
      select: { id: true },
    })
  ).id;

  const preference = await prisma.notificationPreference.findUniqueOrThrow({
    where: { businessId },
    select: { routing: true, quietHoursEnabled: true },
  });
  originalRouting = preference.routing;
  originalQuiet = preference.quietHoursEnabled;
});

/** Every event this file sends, on, with quiet hours out of the way. */
async function routeEverything(): Promise<void> {
  await prisma.notificationPreference.update({
    where: { businessId },
    data: {
      routing: {
        enquiry_received: ["email", "in_app"],
        enquiry_escalated: ["email", "in_app"],
      },
      quietHoursEnabled: false,
    },
  });
}

afterEach(async () => {
  const ids = enquiries.splice(0);
  if (ids.length > 0) {
    await prisma.notificationDelivery.deleteMany({ where: { enquiryId: { in: ids } } });
    await prisma.enquiry.deleteMany({ where: { id: { in: ids } } });
  }
  const people = seats.splice(0);
  if (people.length > 0) {
    await prisma.notificationDelivery.deleteMany({ where: { recipientUserId: { in: people } } });
    await prisma.seatChannel.deleteMany({ where: { userId: { in: people } } });
    await prisma.user.deleteMany({ where: { id: { in: people } } });
  }
});

afterAll(async () => {
  await prisma.enquiry.deleteMany({ where: { requirement: { contains: PREFIX } } });
  await prisma.notificationPreference.update({
    where: { businessId },
    data: { routing: originalRouting as never, quietHoursEnabled: originalQuiet },
  });
  await prisma.$disconnect();
});

async function seat(options: {
  verified?: ("whatsapp" | "email")[];
  unverified?: ("whatsapp" | "email")[];
}): Promise<string> {
  const id = crypto.randomUUID();
  await prisma.user.create({
    data: {
      id,
      businessId,
      fullName: `${PREFIX} seat`,
      roles: ["seller_sales"] as never,
      // Deliberately set, and deliberately not what the send layer reads. A
      // seat with an address on the `User` row and nothing verified is exactly
      // the case that used to receive.
      email: `${id}@example.test`,
    },
  });
  seats.push(id);

  for (const kind of options.verified ?? []) {
    await prisma.seatChannel.create({
      data: {
        userId: id,
        businessId,
        kind,
        address: kind === "email" ? `verified-${id}@example.test` : "+971501112233",
        verifiedAt: new Date(),
      },
    });
  }
  for (const kind of options.unverified ?? []) {
    await prisma.seatChannel.create({
      data: {
        userId: id,
        businessId,
        kind,
        address: kind === "email" ? `unproven-${id}@example.test` : "+971509998877",
      },
    });
  }
  return id;
}

async function enquiry(label: string, assignedToId: string | null): Promise<string> {
  const row = await prisma.enquiry.create({
    data: {
      ref: `ENQ-${PREFIX}-${label}`,
      buyerId,
      requirement: `${PREFIX} ${label} — gate valves for a riser.`,
      closesAt: new Date(Date.now() + 5 * 86_400_000),
      lines: { create: [{ description: `${PREFIX} valve`, qty: 4, sortOrder: 0 }] },
    },
    select: { id: true },
  });
  enquiries.push(row.id);
  await prisma.enquiryRecipient.create({
    data: {
      enquiryId: row.id,
      businessId,
      ...(assignedToId ? { assignedToId, assignedAt: new Date() } : {}),
    },
  });
  return row.id;
}

describe("an unverified channel receives nothing", () => {
  it("skips it, and says which of the two reasons it was", async () => {
    /*
       "Unverified" and "no address at all" send a seller to different places —
       finish the one you added, or add one — so the delivery log records which,
       and this is what makes that answerable.
    */
    const unproven = await seat({ unverified: ["email"] });
    const enquiryId = await enquiry("A", unproven);

    /*
       `enquiry_escalated` rather than `enquiry_received`, because the template
       lookup happens before the address one: `enquiry_received` has no live
       email template in the seed, so the outcome would be `no_live_template`
       and this test would be asserting nothing about verification at all.
    */
    await routeEverything();

    const outcomes = await notify({
      event: "enquiry_escalated",
      businessId,
      recipientUserId: unproven,
      enquiryId,
      params: { ref: "ENQ-TEST", hours: "2", closesAt: "1 Jan", enquiryId },
    });

    const email = outcomes.find((outcome) => outcome.channel === "email");
    expect(email?.status).toBe("skipped");
    expect(email?.reason).toBe("channel_entered_but_not_verified");
  });

  it("delivers on a channel that has been proven", async () => {
    const proven = await seat({ verified: ["email"] });
    const enquiryId = await enquiry("B", proven);

    await routeEverything();

    const outcomes = await notify({
      event: "enquiry_escalated",
      businessId,
      recipientUserId: proven,
      enquiryId,
      params: { ref: "ENQ-TEST", hours: "2", closesAt: "1 Jan", enquiryId },
    });

    const email = outcomes.find((outcome) => outcome.channel === "email");
    // `sent`, not merely "not skipped". The weaker assertion passed while the
    // template lookup was refusing the send for an unrelated reason, which is
    // how the first version of this test proved nothing.
    expect(email?.status).toBe("sent");
  });
});

describe("nothing is dropped", () => {
  it("tells the assigned seat rather than the owner", async () => {
    // 7e §2: `GOES TO` for a new enquiry is the assigned seat. Before this it
    // was always the owner, which is what left the column with nothing behind it.
    const assignee = await seat({ verified: ["email"] });
    const enquiryId = await enquiry("C", assignee);
    await routeEverything();

    await onEnquiryDelivered({ enquiryId, businessIds: [businessId] });

    const rows = await prisma.notificationDelivery.findMany({
      where: { enquiryId, event: "enquiry_received" },
      select: { recipientUserId: true },
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((row) => row.recipientUserId))).toEqual(new Set([assignee]));
  });

  it("falls back to the owner when the assigned seat cannot be reached", async () => {
    /*
       §2.1, and the failure the whole handoff exists to close: an `assigned`
       that names a seat with no verified channel is a promise nothing keeps.
    */
    const unreachable = await seat({ unverified: ["whatsapp"] });
    const enquiryId = await enquiry("D", unreachable);
    await routeEverything();

    await onEnquiryDelivered({ enquiryId, businessIds: [businessId] });

    const rows = await prisma.notificationDelivery.findMany({
      where: { enquiryId, event: "enquiry_received" },
      select: { recipientUserId: true },
    });
    expect(new Set(rows.map((row) => row.recipientUserId))).toEqual(new Set([ownerId]));

    // And counted. §9 pairs this with board 7d's `unroutable_lead` as the only
    // evidence that a lead arrived and nobody heard it.
    const events = await prisma.productEvent.findMany({
      where: { name: "fallback_to_owner", businessId },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { props: true },
    });
    expect((events[0]?.props as { reason?: string } | null)?.reason).toBe("unreachable");
  });

  it("falls back to the owner when nobody is assigned", async () => {
    const enquiryId = await enquiry("E", null);
    await routeEverything();
    await onEnquiryDelivered({ enquiryId, businessIds: [businessId] });

    const rows = await prisma.notificationDelivery.findMany({
      where: { enquiryId, event: "enquiry_received" },
      select: { recipientUserId: true },
    });
    expect(new Set(rows.map((row) => row.recipientUserId))).toEqual(new Set([ownerId]));
  });
});

describe("quiet hours follow the counter", () => {
  /*
     7e §5: "Source — the Hours page. Same source as the auto-reply and as 7d's
     routing skip. One copy." A second working week stored on this screen is the
     contradiction that surfaces first during Ramadan.
  */
  const window = { enabled: true, fromHour: 21, toHour: 7, onSunday: true };

  it("is quiet when the counter is shut, whatever the stored window says", () => {
    // Midday, which is inside no 21:00–07:00 window, and shut all the same.
    const noon = new Date("2026-09-08T08:00:00Z");
    expect(
      inQuietHours({ ...window, hours: { closedNow: true, opensAt: null } }, noon),
    ).toBe(true);
  });

  it("is not quiet when the counter is open, whatever the stored window says", () => {
    // Three in the morning, inside the stored window, and open all the same —
    // a twenty-four-hour depot.
    const night = new Date("2026-09-07T23:00:00Z");
    expect(
      inQuietHours({ ...window, hours: { closedNow: false, opensAt: null } }, night),
    ).toBe(false);
  });

  it("falls back to the stored window where nobody has published hours", () => {
    // Not "always open" and not "always shut": a business with no week.
    const night = new Date("2026-09-07T23:00:00Z");
    expect(inQuietHours({ ...window, hours: null }, night)).toBe(true);
  });

  it("lifts when the counter opens", () => {
    const opensAt = new Date("2026-09-08T04:00:00Z");
    const night = new Date("2026-09-07T23:00:00Z");
    expect(
      quietLiftsAt({ ...window, hours: { closedNow: true, opensAt } }, night).toISOString(),
    ).toBe(opensAt.toISOString());
  });

  it("never holds in-app, so an escalation is never silenced", () => {
    /*
       §5: "Escalation ignores quiet hours in-app, never sends a 3am WhatsApp.
       The precedence has to be written down or the two features contradict each
       other on the first night shift."
    */
    const decisions = route(
      {
        matrix: { enquiry_escalated: ["whatsapp", "in_app"] },
        quiet: { ...window, hours: { closedNow: true, opensAt: null } },
        highValueOverrideAed: null,
      },
      { event: "enquiry_escalated", now: new Date("2026-09-07T23:00:00Z") },
    );

    expect(decisions.find((d) => d.channel === "in_app")?.action).toBe("send");
    expect(decisions.find((d) => d.channel === "whatsapp")?.action).toBe("defer");
  });
});
