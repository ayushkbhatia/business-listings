import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  currentSession,
  endViewAs,
  minutesLeft,
  startViewAs,
  VIEW_AS_MINUTES,
} from "@/lib/support/view-as";
import { callList, callHistory, logCall } from "@/lib/crm/call-list";
import { saveProfile, requestModeratedChange } from "@/lib/listing/service";
import { inviteSeat } from "@/lib/team/service";
import { changePlan } from "@/lib/billing/service";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Criteria 7 and 8.
 *
 *   7. "The CRM call list is generated from demand signals with no manual
 *       entry, and logging a call outcome updates the account state."
 *   8. "View-as is read-only, expires at 30 minutes, and writes an audit row
 *       naming the ticket."
 *
 * The half of criterion 8 that passes by accident is "read-only". A test that
 * checks the buttons are hidden proves nothing — a server action is a URL. So
 * the tests below call the seller's own mutation **services** with the staff
 * actor a view-as session carries, and assert each one refuses.
 */

const PREFIX = "crm-";
const ENQUIRY_PREFIX = "ENQ-CRM";
const BUYER_NAME = "CRM Buyer";

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;
let categoryId: string;
let areaId: string;
let seq = 0;

/**
 * Every row this suite writes.
 *
 * The listings are published, so a leaked one is not inert — it shows on the
 * home page and in `/dev/seat`. CI never saw the accumulation because each job
 * gets its own `supabase start`; a local database is shared with every sibling
 * worktree and keeps what it is given.
 *
 * The business goes first and takes the missed enquiries, view-as sessions,
 * call outcomes, change requests, invitations and subscription rows with it —
 * all of those cascade. The buyers go last, because until the business is gone
 * they still hold rows the foreign keys will not let go of.
 */
async function removeFixtures() {
  const ours = await prisma.business.findMany({
    where: { slug: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = ours.map((row) => row.id);

  if (ids.length > 0) {
    // `AuditEvent.subject` is a string, not a foreign key — nothing cascades it.
    await prisma.auditEvent.deleteMany({
      where: { subject: { in: ids.map((id) => `Business:${id}`) } },
    });
    await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  }

  await prisma.enquiry.deleteMany({ where: { ref: { startsWith: ENQUIRY_PREFIX } } });
  await prisma.user.deleteMany({ where: { fullName: { startsWith: BUYER_NAME } } });
}

beforeAll(async () => {
  opsLeadId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      // One of two seeded ops leads, and always the same one: board 6f
      // needs a second for dual control, and `findFirst` has no defined
      // order without this.
      orderBy: { id: "asc" as const },
      select: { id: true },
    })
  ).id;
  moderatorId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_moderator" } },
      select: { id: true },
    })
  ).id;
  categoryId = (
    await prisma.category.findFirstOrThrow({ where: { parentId: null }, select: { id: true } })
  ).id;
  areaId = (await prisma.area.findFirstOrThrow({ select: { id: true } })).id;

  await removeFixtures();
});

afterAll(async () => {
  await removeFixtures();
});

async function listing(name: string) {
  seq += 1;
  const stamp = `${Date.now()}${String(seq).padStart(2, "0")}`;
  return prisma.business.create({
    data: {
      tradeName: `${name} ${stamp}`,
      displayName: `${name} ${stamp}`,
      slug: `${PREFIX}${name.toLowerCase().replace(/\s+/g, "-")}-${stamp}`,
      licenceNumber: `DED-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      planId: "free",
      publishedAt: new Date(),
      locations: {
        create: {
          type: "head_office",
          emirate: "dubai",
          areaId,
          addressLine: "Unit 7, Street 3",
          published: true,
        },
      },
    },
    select: { id: true, slug: true, displayName: true, description: true },
  });
}

const REASON = "Seller says their catalogue is not showing. Looking at what they see.";
const TICKET = "SUP-8841";

describe("starting a view-as session", () => {
  it("writes an audit row naming the ticket", async () => {
    const business = await listing("Viewed");
    const started = await startViewAs({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: business.id,
      ticketRef: TICKET,
      reason: REASON,
    });
    expect(started.ok).toBe(true);

    const rows = await prisma.auditEvent.findMany({
      where: { action: "view_as", subject: `Business:${business.id}` },
      select: { reason: true, after: true },
    });
    expect(rows).toHaveLength(1);
    // The ticket in front of the prose, the way a review-removal ground is.
    expect(rows[0]!.reason).toContain(TICKET);
    expect((rows[0]!.after as { ticketRef: string }).ticketRef).toBe(TICKET);

    await endViewAs(opsLeadId);
  });

  it("refuses without a ticket, because the ticket is the reason", async () => {
    const business = await listing("No Ticket");
    const result = await startViewAs({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: business.id,
      ticketRef: "  ",
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: false, error: "needs_a_ticket" });
  });

  it("refuses a second live session for the same person", async () => {
    const first = await listing("First Account");
    const second = await listing("Second Account");

    await startViewAs({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: first.id,
      ticketRef: TICKET,
      reason: REASON,
    });
    const again = await startViewAs({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: second.id,
      ticketRef: "SUP-9000",
      reason: REASON,
    });
    expect(again).toMatchObject({ ok: false, error: "already_viewing" });

    await endViewAs(opsLeadId);
  });

  it("refuses a field verifier — support.view_as is moderator or ops lead", async () => {
    const business = await listing("Not Field");
    const fieldOfficer = await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_field" } },
      select: { id: true },
    });

    await expect(
      startViewAs({
        actor: actor(fieldOfficer.id, "staff_field"),
        businessId: business.id,
        ticketRef: TICKET,
        reason: REASON,
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("thirty minutes is a fact the server checks", () => {
  it("expires, whether or not anything swept it", async () => {
    const business = await listing("Expiring");
    const started = await startViewAs({
      actor: actor(moderatorId, "staff_moderator"),
      businessId: business.id,
      ticketRef: TICKET,
      reason: REASON,
    });
    if (!started.ok) throw new Error("start failed");

    // Live now.
    expect(await currentSession(moderatorId)).not.toBeNull();

    // And over at thirty minutes and one second, with no job having run.
    const past = new Date(Date.now() + (VIEW_AS_MINUTES * 60_000 + 1000));
    expect(await currentSession(moderatorId, past)).toBeNull();

    await endViewAs(moderatorId);
  });

  it("counts down in whole minutes", () => {
    const now = new Date("2026-08-26T10:00:00Z");
    expect(minutesLeft(new Date("2026-08-26T10:30:00Z"), now)).toBe(30);
    expect(minutesLeft(new Date("2026-08-26T10:00:30Z"), now)).toBe(1);
    expect(minutesLeft(new Date("2026-08-26T09:59:00Z"), now)).toBe(0);
  });

  it("ends when somebody ends it", async () => {
    const business = await listing("Ended");
    await startViewAs({
      actor: actor(moderatorId, "staff_moderator"),
      businessId: business.id,
      ticketRef: TICKET,
      reason: REASON,
    });
    await endViewAs(moderatorId);
    expect(await currentSession(moderatorId)).toBeNull();
  });
});

describe("read-only is enforced where the mutations are", () => {
  /*
   * The half of criterion 8 that passes by accident. A view-as session does not
   * swap the actor for the seller — it changes the business and keeps the staff
   * member's own roles — so every seller mutation is refused by the same
   * `assertCan` that refuses a sales seat.
   *
   * These call the services directly, which is what a server action is a
   * wrapper around. Hiding the buttons is fine and is not the fence.
   */
  const staffActor = () => ({ ...actor(opsLeadId, "staff_ops_lead"), businessId: undefined });

  it("cannot edit the listing profile", async () => {
    const business = await listing("Profile Locked");
    await expect(
      saveProfile({ ...staffActor(), businessId: business.id } as Actor, business.id, {
        description: "Edited by somebody who is only looking.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("cannot submit a moderated change", async () => {
    const business = await listing("Change Locked");
    await expect(
      requestModeratedChange(
        { ...staffActor(), businessId: business.id } as Actor,
        business.id,
        "trade_name",
        "Renamed While Looking LLC",
      ),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("cannot invite a team seat", async () => {
    const business = await listing("Team Locked");
    const plan = await prisma.plan.findUniqueOrThrow({ where: { id: "free" } });
    await expect(
      inviteSeat(
        { ...staffActor(), businessId: business.id } as Actor,
        business.id,
        { contact: "someone@example.com", roles: ["seller_sales"] },
        plan,
      ),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("cannot change the plan", async () => {
    const business = await listing("Plan Locked");
    await expect(
      changePlan({ ...staffActor(), businessId: business.id } as Actor, business.id, "pro"),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("leaves the listing exactly as it was", async () => {
    const business = await listing("Untouched");
    await startViewAs({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: business.id,
      ticketRef: TICKET,
      reason: REASON,
    });

    const before = await prisma.business.findUniqueOrThrow({
      where: { id: business.id },
      select: { tradeName: true, description: true, planId: true },
    });

    await expect(
      saveProfile({ ...staffActor(), businessId: business.id } as Actor, business.id, {
        description: "Nope.",
      }),
    ).rejects.toThrow();

    expect(
      await prisma.business.findUniqueOrThrow({
        where: { id: business.id },
        select: { tradeName: true, description: true, planId: true },
      }),
    ).toEqual(before);

    await endViewAs(opsLeadId);
  });
});

describe("the call list builds itself", () => {
  it("has no insert path at all", async () => {
    /*
     * Criterion 7's "no manual entry" is a property you get by having nowhere
     * to type. There is no CallTask model, and `lib/crm/call-list.ts` exports
     * exactly one writer — `logCall`, which records what happened *after* a
     * call rather than putting somebody on the list.
     */
    const models = Object.keys(prisma).filter((key) => !key.startsWith("$") && !key.startsWith("_"));
    expect(models).not.toContain("callTask");
    expect(models).not.toContain("prospect");
    expect(models).toContain("callOutcome");
  });

  it("puts a capped free seller on the list, with the number the call opens with", async () => {
    const business = await listing("Capped Seller");
    const buyer = await prisma.user.create({
      data: { id: crypto.randomUUID(), fullName: BUYER_NAME, roles: ["buyer"] },
      select: { id: true },
    });

    for (let i = 0; i < 3; i += 1) {
      const enquiry = await prisma.enquiry.create({
        data: {
          ref: `${ENQUIRY_PREFIX}-${Date.now()}${seq}${i}`,
          buyerId: buyer.id,
          requirement: "Gate valves, DN100.",
          closesAt: new Date(Date.now() + 7 * 86_400_000),
        },
        select: { id: true },
      });
      await prisma.missedEnquiry.create({
        data: { enquiryId: enquiry.id, businessId: business.id, reason: "at_monthly_cap" },
      });
    }

    const list = await callList(500);
    const prospect = list.find((p) => p.businessId === business.id);
    expect(prospect).toBeTruthy();
    expect(prospect!.signal).toBe("missed_at_cap");
    // Lead with their missed demand, not with our product.
    expect(prospect!.value).toBe(3);
  }, 60_000);

  it("drops somebody who was called this week", async () => {
    const business = await listing("Called Already");
    const buyer = await prisma.user.create({
      data: { id: crypto.randomUUID(), fullName: `${BUYER_NAME} 2`, roles: ["buyer"] },
      select: { id: true },
    });
    const enquiry = await prisma.enquiry.create({
      data: {
        ref: `${ENQUIRY_PREFIX}2-${Date.now()}${seq}`,
        buyerId: buyer.id,
        requirement: "Butterfly valves.",
        closesAt: new Date(Date.now() + 7 * 86_400_000),
      },
      select: { id: true },
    });
    await prisma.missedEnquiry.create({
      data: { enquiryId: enquiry.id, businessId: business.id, reason: "at_monthly_cap" },
    });

    expect((await callList(500)).some((p) => p.businessId === business.id)).toBe(true);

    await logCall({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: business.id,
      kind: "no_answer",
      signal: "missed_at_cap",
    });

    // A list that offers the same person every morning gets somebody rung twice.
    expect((await callList(500)).some((p) => p.businessId === business.id)).toBe(false);
  }, 60_000);

  it("records what happened, and which signal it was", async () => {
    const business = await listing("Logged");
    await logCall({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: business.id,
      kind: "reached",
      signal: "missed_at_cap",
      note: "Spoke to the owner. They did not know about the cap.",
    });

    const history = await callHistory(business.id);
    expect(history).toHaveLength(1);
    expect(history[0]!.kind).toBe("reached");
    expect(history[0]!.signal).toBe("missed_at_cap");
    expect(history[0]!.staff.id).toBe(opsLeadId);
  });

  it("refuses a call-back with no date", async () => {
    const business = await listing("No Date");
    const result = await logCall({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: business.id,
      kind: "call_back",
      signal: "missed_at_cap",
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("refuses a date on anything but a call-back", async () => {
    const business = await listing("Stray Date");
    const result = await logCall({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: business.id,
      kind: "reached",
      signal: "missed_at_cap",
      callBackAt: new Date(),
    });
    expect(result).toMatchObject({ ok: false });
  });

  it("never offers a suspended or merged listing", async () => {
    const business = await listing("Suspended Prospect");
    const buyer = await prisma.user.create({
      data: { id: crypto.randomUUID(), fullName: `${BUYER_NAME} 3`, roles: ["buyer"] },
      select: { id: true },
    });
    const enquiry = await prisma.enquiry.create({
      data: {
        ref: `${ENQUIRY_PREFIX}3-${Date.now()}${seq}`,
        buyerId: buyer.id,
        requirement: "Pipes.",
        closesAt: new Date(Date.now() + 7 * 86_400_000),
      },
      select: { id: true },
    });
    await prisma.missedEnquiry.create({
      data: { enquiryId: enquiry.id, businessId: business.id, reason: "at_monthly_cap" },
    });
    await prisma.business.update({
      where: { id: business.id },
      data: { suspendedAt: new Date() },
    });

    expect((await callList(500)).some((p) => p.businessId === business.id)).toBe(false);
  }, 60_000);
});
