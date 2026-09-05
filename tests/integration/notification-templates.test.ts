import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { promoteTemplate, saveTemplate, templateLibrary } from "@/lib/notify/templates";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Board 12g — notification templates, against a real database.
 *
 * An editor over a live mechanism: `lib/notify/events.ts` reads these rows and
 * sends what they say. The two rules worth the care are that an edit is a new
 * version rather than an overwrite, and that a WhatsApp template cannot reach
 * `live` without going past Meta.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let moderatorId: string;
const madeIds: string[] = [];

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
});

afterAll(async () => {
  // Versions this suite created, and only those. The seeded v1 rows stay.
  await prisma.notificationTemplate.deleteMany({ where: { id: { in: madeIds } } });
  await prisma.notificationTemplate.deleteMany({ where: { version: { gt: 1 } } });
  await prisma.notificationTemplate.updateMany({
    where: { version: 1, status: "retired" },
    data: { status: "live" },
  });
  await prisma.$disconnect();
});

/**
 * A seeded template for a pair that actually exists.
 *
 * `enquiry_received` is seeded on WhatsApp, in-app and SMS — not email, which
 * is on `enquiry_escalated`. Asking for a pair the seed does not have is how
 * the first version of this file failed seven tests at once.
 */
async function seeded(
  event: "enquiry_received" | "enquiry_escalated",
  channel: "email" | "whatsapp" | "sms" | "in_app",
) {
  return prisma.notificationTemplate.findFirstOrThrow({
    where: { channel, event },
    orderBy: { version: "desc" },
  });
}

describe("what a template may say", () => {
  it("refuses a placeholder the event does not supply", async () => {
    /*
     * `render()` throws `MissingParamError` at send time, which is a seller not
     * being told something. Caught here it is a red line under a textarea.
     */
    const template = await seeded("enquiry_received", "in_app");
    const result = await saveTemplate({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: template.id,
      body: "You have an enquiry worth {quotedValue}.",
      reason: "Trying a placeholder the event does not supply.",
    });
    expect(result).toMatchObject({ ok: false, error: "unknown_placeholder" });
  }, 60_000);

  it("takes one that uses only what the event supplies", async () => {
    const template = await seeded("enquiry_received", "in_app");
    const result = await saveTemplate({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: template.id,
      body: "{summary} — closes {closesAt}. Open it: {shortLink}",
      reason: "Tightening the in-app enquiry notice.",
    });
    expect(result.ok).toBe(true);
    if (result.ok) madeIds.push(result.id);
  }, 60_000);

  it("refuses an email with no subject", async () => {
    // Email is seeded on the escalation event, which supplies no params.
    const template = await seeded("enquiry_escalated", "email");
    const result = await saveTemplate({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: template.id,
      subject: "",
      body: "An enquiry has gone unanswered long enough to escalate.",
      reason: "Trying an email with no subject.",
    });
    expect(result).toMatchObject({ ok: false, error: "email_needs_subject" });
  }, 60_000);

  it("refuses an empty body", async () => {
    const template = await seeded("enquiry_received", "whatsapp");
    const result = await saveTemplate({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: template.id,
      body: "   ",
      reason: "Trying an empty body.",
    });
    expect(result).toMatchObject({ ok: false, error: "empty_body" });
  }, 60_000);
});

describe("an edit is a new version, not an overwrite", () => {
  it("supersedes rather than rewriting what was already sent", async () => {
    /*
     * `NotificationDelivery` points at the template that produced it. Editing
     * in place would make what a seller was sent last week become what the
     * template says today.
     */
    const before = await seeded("enquiry_received", "in_app");
    const result = await saveTemplate({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: before.id,
      body: "{summary}. Closes {closesAt}.",
      reason: "Shortening the in-app notice for phone screens.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    madeIds.push(result.id);

    expect(result.version).toBeGreaterThan(before.version);

    const original = await prisma.notificationTemplate.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(original.body).toBe(before.body);

    // And the new one is a draft: an edit does not put itself live.
    const created = await prisma.notificationTemplate.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(created.status).toBe("draft");
  }, 60_000);
});

describe("the WhatsApp approval path", () => {
  it("goes to Meta before it goes live, never straight there", async () => {
    const template = await seeded("enquiry_received", "whatsapp");
    const draft = await saveTemplate({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: template.id,
      body: "New enquiry {ref}: {summary}. Open it {shortLink}",
      metaTemplateName: "enquiry_received_v2",
      reason: "Reworded for the Meta submission.",
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    madeIds.push(draft.id);

    const first = await promoteTemplate(
      actor(opsLeadId, "staff_ops_lead"),
      draft.id,
      "Submitting to Meta.",
    );
    expect(first).toMatchObject({ ok: true, status: "pending_meta" });

    const second = await promoteTemplate(
      actor(opsLeadId, "staff_ops_lead"),
      draft.id,
      "Meta approved it this morning.",
    );
    expect(second).toMatchObject({ ok: true, status: "live" });
  }, 120_000);

  it("refuses to submit one with no Meta template name", async () => {
    const template = await seeded("enquiry_received", "whatsapp");
    const draft = await saveTemplate({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: template.id,
      body: "New enquiry {ref}",
      reason: "A draft without a Meta name.",
    });
    if (!draft.ok) throw new Error("fixture failed");
    madeIds.push(draft.id);
    await prisma.notificationTemplate.update({
      where: { id: draft.id },
      data: { metaTemplateName: null },
    });

    const result = await promoteTemplate(
      actor(opsLeadId, "staff_ops_lead"),
      draft.id,
      "Trying to submit with no Meta name.",
    );
    expect(result).toMatchObject({ ok: false, error: "whatsapp_needs_meta_name" });
  }, 60_000);

  it("puts an email live in one step, because Meta does not approve email", async () => {
    const template = await seeded("enquiry_escalated", "email");
    const draft = await saveTemplate({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: template.id,
      subject: "An enquiry needs attention",
      body: "An enquiry has gone unanswered long enough to escalate.",
      reason: "A straightforward email edit.",
    });
    if (!draft.ok) throw new Error("fixture failed");
    madeIds.push(draft.id);

    const result = await promoteTemplate(
      actor(opsLeadId, "staff_ops_lead"),
      draft.id,
      "Putting the shorter email live.",
    );
    expect(result).toMatchObject({ ok: true, status: "live" });
  }, 60_000);

  it("retires the version it replaces, so two are never live at once", async () => {
    /*
     * `events.ts` takes the highest live version. Two live versions of one
     * event and channel is a coin toss over which a seller gets.
     */
    const template = await seeded("enquiry_received", "sms");
    const draft = await saveTemplate({
      actor: actor(opsLeadId, "staff_ops_lead"),
      templateId: template.id,
      body: "Enquiry {ref}: {summary}",
      reason: "A shorter SMS.",
    });
    if (!draft.ok) throw new Error("fixture failed");
    madeIds.push(draft.id);

    await promoteTemplate(actor(opsLeadId, "staff_ops_lead"), draft.id, "Putting the SMS live.");

    const live = await prisma.notificationTemplate.findMany({
      where: { event: "enquiry_received", channel: "sms", status: "live" },
      select: { id: true },
    });
    expect(live).toHaveLength(1);
    expect(live[0]!.id).toBe(draft.id);
  }, 60_000);
});

describe("the library a screen reads", () => {
  it("flags templates using something their event does not supply", async () => {
    const library = await templateLibrary();
    expect(library.length).toBeGreaterThan(0);
    for (const entry of library) {
      // Every seeded template should be clean against its own event.
      if (entry.emitted && entry.version === 1) {
        expect(entry.unknown, `${entry.event}/${entry.channel}`).toEqual([]);
      }
    }
  }, 60_000);

  it("says which events nothing sends yet", async () => {
    const library = await templateLibrary();
    const dormant = library.filter((entry) => !entry.emitted);
    expect(dormant.length).toBeGreaterThan(0);
    for (const entry of dormant) expect(entry.available).toEqual([]);
  }, 60_000);

  it("refuses a moderator", async () => {
    const template = await seeded("enquiry_received", "in_app");
    await expect(
      saveTemplate({
        actor: actor(moderatorId, "staff_moderator"),
        templateId: template.id,
        body: "{summary}",
        reason: "Not my row.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  }, 60_000);
});
