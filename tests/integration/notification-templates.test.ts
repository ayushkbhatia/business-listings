import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";
import type { NotificationChannel, NotificationEvent } from "@/lib/db/generated/enums";
import { deliverQueued, notify, resolveLiveTemplates } from "@/lib/notify/service";
import {
  publishDraft,
  recordMetaDecision,
  saveTemplateVersion,
  sendTestToMe,
  templateBoard,
  templateDetail,
} from "@/lib/notify/templates";
import { purgeAuditRows } from "./audit-cleanup";

/**
 * Board 12g — notification templates, against a real database.
 *
 * An editor over a live mechanism: `lib/notify/service.ts` reads these rows and
 * sends what they say. The rules worth the care are the build notes: a version
 * rather than an overwrite, WhatsApp through Meta without touching the live
 * copy (`B4`), a services twin the carrier actually picks (`B5`), volume that is
 * a query and leaves tests out (`B1`, `B10`), and every change audited.
 *
 * Every row this suite writes is removed afterwards, and every seeded row it
 * retires is put back as it was — the seeded catalogue is shared by the e2e
 * suite and by sibling boards.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });
const REASON = "Board 12g integration test.";

let opsLead: Actor;
let moderator: Actor;
let snapshot: { id: string; status: string }[] = [];
let businessId: string;
let ownerId: string;

beforeAll(async () => {
  const lead = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "staff_ops_lead" } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  opsLead = actor(lead.id, "staff_ops_lead");
  const mod = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "staff_moderator" } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  moderator = actor(mod.id, "staff_moderator");

  snapshot = await prisma.notificationTemplate.findMany({ select: { id: true, status: true }, orderBy: { id: "asc" } });

  const preference = await prisma.notificationPreference.findFirstOrThrow({ orderBy: { businessId: "asc" }, select: { businessId: true } });
  businessId = preference.businessId;
  ownerId = (
    await prisma.user.findFirstOrThrow({ where: { businessId, roles: { has: "seller_owner" } }, orderBy: { id: "asc" }, select: { id: true } })
  ).id;
});

afterAll(async () => {
  const kept = snapshot.map((row) => row.id);
  const made = await prisma.notificationTemplate.findMany({ where: { id: { notIn: kept } }, select: { id: true } });
  await prisma.notificationDelivery.deleteMany({
    where: { OR: [{ templateId: { in: made.map((m) => m.id) } }, { test: true }, { reason: "board_12g_fixture" }] },
  });
  await prisma.notificationTemplate.deleteMany({ where: { id: { in: made.map((m) => m.id) } } });
  for (const row of snapshot) {
    await prisma.notificationTemplate.update({ where: { id: row.id }, data: { status: row.status as never } });
  }
  await purgeAuditRows({ subject: { startsWith: "NotificationTemplate:" }, reason: REASON });
  await prisma.$disconnect();
});

async function head(event: NotificationEvent, channel: NotificationChannel, kind: "goods" | "neutral" | "services" = "goods") {
  return prisma.notificationTemplate.findFirst({
    where: { event, channel, kind: kind === "services" ? "services" : { in: ["goods", "neutral"] } },
    orderBy: [{ version: "desc" }, { id: "asc" }],
  });
}

describe("saving a version", () => {
  it("puts an in-app edit live on save and retires what it replaced, with an audit row (B4)", async () => {
    const before = await head("quote_expiring", "in_app");
    expect(before?.status).toBe("live");

    const result = await saveTemplateVersion({
      actor: opsLead,
      event: "quote_expiring",
      channel: "in_app",
      line: "primary",
      body: "Quote {quoteRef} expires {expiresAt}. Extend it or let it lapse.",
      actionLabel: "Open the quote",
      actionPath: "/dashboard/quotes",
      basedOn: before!.version,
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: true, version: before!.version + 1, status: "live" });

    const rows = await prisma.notificationTemplate.findMany({ where: { event: "quote_expiring", channel: "in_app" }, orderBy: { version: "asc" } });
    expect(rows.map((r) => [r.version, r.status])).toEqual([
      [before!.version, "retired"],
      [before!.version + 1, "live"],
    ]);
    expect(rows.at(-1)?.createdById).toBe(opsLead.id);

    const audit = await prisma.auditEvent.findFirst({
      where: { subject: "NotificationTemplate:quote_expiring.in_app.primary", reason: REASON },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(audit?.action).toBe("notification_template_saved");
  });

  it("refuses a save against a version that is no longer the newest", async () => {
    const current = await head("quote_expiring", "in_app");
    const result = await saveTemplateVersion({
      actor: opsLead,
      event: "quote_expiring",
      channel: "in_app",
      line: "primary",
      body: "Quote {quoteRef} runs out {expiresAt}.",
      actionPath: "/dashboard/quotes",
      basedOn: current!.version - 1,
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: false, error: "stale" });
  });

  it("refuses a save that changes nothing", async () => {
    const current = await head("quote_expiring", "in_app");
    const result = await saveTemplateVersion({
      actor: opsLead,
      event: "quote_expiring",
      channel: "in_app",
      line: "primary",
      body: current!.body,
      actionLabel: current!.actionLabel,
      actionPath: current!.actionPath,
      basedOn: current!.version,
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: false, error: "unchanged" });
  });

  it("refuses a placeholder that names contact details, and an SMS over its segment, with no row written", async () => {
    const count = await prisma.notificationTemplate.count();
    const leaky = await saveTemplateVersion({
      actor: opsLead,
      event: "quote_accepted",
      channel: "email",
      line: "primary",
      subject: "Accepted",
      body: "Call the buyer on {buyerPhone}.",
      actionPath: "/dashboard/leads/{enquiryId}",
      basedOn: (await head("quote_accepted", "email"))!.version,
      reason: REASON,
    });
    expect(leaky).toMatchObject({ ok: false, error: "forbidden_placeholder" });

    const long = await saveTemplateVersion({
      actor: opsLead,
      event: "enquiry_received",
      channel: "sms",
      line: "primary",
      body: "New enquiry {ref} — {summary}. {lineCount} lines for {area}. Quote: {shortLink}",
      basedOn: (await head("enquiry_received", "sms"))!.version,
      reason: REASON,
    });
    expect(long).toMatchObject({ ok: false, error: "sms_too_long", detail: { limit: "70" } });
    expect(await prisma.notificationTemplate.count()).toBe(count);
  });

  it("is an ops lead decision", async () => {
    await expect(
      saveTemplateVersion({
        actor: moderator,
        event: "quote_expiring",
        channel: "in_app",
        line: "primary",
        body: "Anything {quoteRef}",
        basedOn: 1,
        reason: REASON,
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("WhatsApp goes through Meta (B4, Q1)", () => {
  it("sends a save to Meta and leaves the live copy alone; a second save takes the first one's place", async () => {
    const start = await head("quote_accepted", "whatsapp");
    const first = await saveTemplateVersion({
      actor: opsLead,
      event: "quote_accepted",
      channel: "whatsapp",
      line: "primary",
      body: "Your quote {quoteRef} was accepted at {amount}. Contact details are now on the enquiry.",
      actionLabel: "Open the accepted quote",
      actionPath: "/dashboard/leads/{enquiryId}",
      metaTemplateName: "bl_quote_accepted_12g_test_a",
      basedOn: start!.version,
      reason: REASON,
    });
    expect(first).toMatchObject({ ok: true, status: "pending_meta" });

    const second = await saveTemplateVersion({
      actor: opsLead,
      event: "quote_accepted",
      channel: "whatsapp",
      line: "primary",
      body: "Quote {quoteRef} accepted, {amount}. The buyer's contact details are on the enquiry.",
      actionLabel: "Open the accepted quote",
      actionPath: "/dashboard/leads/{enquiryId}",
      metaTemplateName: "bl_quote_accepted_12g_test_b",
      basedOn: first.ok ? first.version : 0,
      reason: REASON,
    });
    expect(second).toMatchObject({ ok: true, status: "pending_meta" });

    const statuses = await prisma.notificationTemplate.findMany({
      where: { event: "quote_accepted", channel: "whatsapp" },
      orderBy: { version: "asc" },
      select: { status: true, submittedAt: true },
    });
    // The seeded v1 was itself still with Meta, so the first save took its place too.
    expect(start!.status).toBe("pending_meta");
    expect(statuses.map((s) => s.status)).toEqual(["superseded", "superseded", "pending_meta"]);
    expect(statuses.at(-1)?.submittedAt).toBeInstanceOf(Date);
  });

  it("refuses a Meta name already used for different wording", async () => {
    const current = await head("quote_accepted", "whatsapp");
    const result = await saveTemplateVersion({
      actor: opsLead,
      event: "quote_accepted",
      channel: "whatsapp",
      line: "primary",
      body: "Different words for {quoteRef}.",
      actionPath: "/dashboard/leads/{enquiryId}",
      metaTemplateName: "bl_quote_accepted_12g_test_b",
      basedOn: current!.version,
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: false, error: "meta_name_taken" });
  });

  it("records a rejection with Meta's reason while the live version carries on", async () => {
    const pending = await head("quote_accepted", "whatsapp");
    expect((await recordMetaDecision({ actor: opsLead, templateId: pending!.id, decision: "rejected", reason: REASON })).ok).toBe(false);

    const rejected = await recordMetaDecision({
      actor: opsLead,
      templateId: pending!.id,
      decision: "rejected",
      metaNote: "Template category does not match the content.",
      reason: REASON,
    });
    expect(rejected).toMatchObject({ ok: true, status: "rejected" });
    const row = await prisma.notificationTemplate.findUniqueOrThrow({ where: { id: pending!.id } });
    expect(row).toMatchObject({ status: "rejected", metaNote: "Template category does not match the content." });

    const detail = await templateDetail("quote_accepted", "whatsapp", "primary");
    expect(detail?.rejected?.id).toBe(pending!.id);
  });

  it("puts an approved version live, retires the old one, and refuses a second decision without auditing it", async () => {
    const saved = await saveTemplateVersion({
      actor: opsLead,
      event: "setup_nudge",
      channel: "whatsapp",
      line: "primary",
      neutral: true,
      body: "Your listing is live and setup is still open: {taskList}. About {minutes} minutes. This is the only reminder we send.",
      actionLabel: "Finish setting up",
      actionPath: "/dashboard/setup",
      metaTemplateName: "bl_setup_nudge_12g_test",
      basedOn: (await head("setup_nudge", "whatsapp", "neutral"))!.version,
      reason: REASON,
    });
    expect(saved.ok).toBe(true);
    const id = saved.ok ? saved.id : "";

    const approved = await recordMetaDecision({ actor: opsLead, templateId: id, decision: "approved", reason: REASON });
    expect(approved).toMatchObject({ ok: true, status: "live" });

    const auditsBefore = await prisma.auditEvent.count({ where: { subject: "NotificationTemplate:setup_nudge.whatsapp.primary" } });
    const again = await recordMetaDecision({ actor: opsLead, templateId: id, decision: "approved", reason: REASON });
    expect(again).toMatchObject({ ok: false, error: "not_pending" });
    expect(await prisma.auditEvent.count({ where: { subject: "NotificationTemplate:setup_nudge.whatsapp.primary" } })).toBe(auditsBefore);

    const live = await prisma.notificationTemplate.findMany({ where: { event: "setup_nudge", channel: "whatsapp", status: "live" } });
    expect(live.map((r) => r.id)).toEqual([id]);

    // A newer save leaves that live version sending until Meta approves the newer one.
    const next = await saveTemplateVersion({
      actor: opsLead,
      event: "setup_nudge",
      channel: "whatsapp",
      line: "primary",
      neutral: true,
      body: "Setup on your listing is still open: {taskList}. About {minutes} minutes. We will not remind you again.",
      actionLabel: "Finish setting up",
      actionPath: "/dashboard/setup",
      metaTemplateName: "bl_setup_nudge_12g_test_2",
      basedOn: saved.ok ? saved.version : 0,
      reason: REASON,
    });
    const nextId = next.ok ? next.id : "";
    expect((await resolveLiveTemplates("setup_nudge", null)).get("whatsapp")?.id).toBe(id);

    expect(await recordMetaDecision({ actor: opsLead, templateId: nextId, decision: "approved", reason: REASON })).toMatchObject({ ok: true });
    expect((await prisma.notificationTemplate.findUniqueOrThrow({ where: { id } })).status).toBe("retired");
    expect((await resolveLiveTemplates("setup_nudge", null)).get("whatsapp")?.id).toBe(nextId);
  });

  it("puts a seeded draft live off WhatsApp, and sends one to Meta on it", async () => {
    const draft = await prisma.notificationTemplate.create({
      data: { event: "weekly_digest", channel: "in_app", kind: "goods", version: 1, status: "draft", body: "Your week on the platform.", actionPath: "/dashboard" },
    });
    expect(await publishDraft(opsLead, draft.id, REASON)).toMatchObject({ ok: true, status: "live" });
    expect(await publishDraft(opsLead, draft.id, REASON)).toMatchObject({ ok: false, error: "not_draft" });
  });
});

describe("the services twin (B5)", () => {
  it("refuses a twin for a body that says nothing about trade kind", async () => {
    const result = await saveTemplateVersion({
      actor: opsLead,
      event: "document_expiring",
      channel: "email",
      line: "services",
      subject: "Your licence",
      body: "Your licence expires {expiresAt}, in {days} days.",
      actionPath: "/dashboard/verification",
      basedOn: null,
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: false, error: "twin_without_goods_body" });
  });

  it("is what a services brief receives once it is live, while a goods enquiry keeps the goods body", async () => {
    const goods = await head("enquiry_received", "in_app");
    // Whatever twin a sibling run or a person left behind; this save goes on top of it.
    const previous = await head("enquiry_received", "in_app", "services");
    const twin = await saveTemplateVersion({
      actor: opsLead,
      event: "enquiry_received",
      channel: "in_app",
      line: "services",
      body: `New brief {ref} — work in {area}, wanted by {neededBy}. ${Date.now()}`,
      actionLabel: "Open and propose",
      actionPath: "/dashboard/leads/{enquiryId}",
      basedOn: previous?.version ?? null,
      reason: REASON,
    });
    expect(twin).toMatchObject({ ok: true, version: (previous?.version ?? 0) + 1, status: "live" });

    expect((await resolveLiveTemplates("enquiry_received", "services")).get("in_app")?.kind).toBe("services");
    expect((await resolveLiveTemplates("enquiry_received", "goods")).get("in_app")?.id).toBe(goods!.id);
    // The goods body was not retired by a save on the other line.
    expect((await prisma.notificationTemplate.findUniqueOrThrow({ where: { id: goods!.id } })).status).toBe("live");
  });

  it("refuses to call a body neutral while its twin exists", async () => {
    const goods = await head("enquiry_received", "in_app");
    const result = await saveTemplateVersion({
      actor: opsLead,
      event: "enquiry_received",
      channel: "in_app",
      line: "primary",
      neutral: true,
      body: "New enquiry {ref} for {area}.",
      actionPath: "/dashboard/leads/{enquiryId}",
      basedOn: goods!.version,
      reason: REASON,
    });
    expect(result).toMatchObject({ ok: false, error: "neutral_with_twin" });
  });

  it("records the trade on the delivery, so goods wording reaching a services brief is counted", async () => {
    const outcomes = await notify({
      event: "review_posted",
      businessId,
      recipientUserId: ownerId,
      tradeKind: "services",
      params: { rating: 4, ref: "ENQ-12G", enquiryId: "board-12g" },
    });
    const ids = outcomes.map((o) => o.deliveryId).filter(Boolean);
    const rows = await prisma.notificationDelivery.findMany({ where: { id: { in: ids } }, select: { tradeKind: true } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.tradeKind).toBe("services");
    await prisma.notificationDelivery.updateMany({ where: { id: { in: ids } }, data: { reason: "board_12g_fixture" } });
  });
});

describe("licence expiry ignores a seller's matrix (B7)", () => {
  it("still goes to email and in-app when the seller switched both off", async () => {
    const preference = await prisma.notificationPreference.findUniqueOrThrow({ where: { businessId } });
    await prisma.notificationPreference.update({ where: { businessId }, data: { routing: { ...(preference.routing as object), document_expiring: [] } } });
    try {
      const outcomes = await notify({
        event: "document_expiring",
        businessId,
        recipientUserId: ownerId,
        params: { expiresAt: "28 Oct 2026", days: "14" },
      });
      expect(outcomes.map((o) => o.channel).sort()).toEqual(["email", "in_app"]);
      await prisma.notificationDelivery.updateMany({ where: { id: { in: outcomes.map((o) => o.deliveryId) } }, data: { reason: "board_12g_fixture" } });
    } finally {
      await prisma.notificationPreference.update({ where: { businessId }, data: { routing: preference.routing as object } });
    }
  });
});

describe("volume is a query, and a test is not reach (B1, B10)", () => {
  it("counts sent and suppressed deliveries from the log, and leaves tests out", async () => {
    const template = await head("review_posted", "in_app", "neutral");
    const before = (await templateBoard()).rows.find((r) => r.event === "review_posted" && r.channel === "in_app")!.volume;

    await prisma.notificationDelivery.createMany({
      data: [
        { templateId: template!.id, event: "review_posted", channel: "in_app", status: "sent", reason: "board_12g_fixture", sentAt: new Date() },
        { templateId: template!.id, event: "review_posted", channel: "in_app", status: "sent", reason: "board_12g_fixture", sentAt: new Date() },
        { templateId: template!.id, event: "review_posted", channel: "in_app", status: "skipped", reason: "board_12g_fixture" },
        { templateId: template!.id, event: "review_posted", channel: "in_app", status: "sent", reason: "board_12g_fixture", test: true, sentAt: new Date() },
      ],
    });

    const after = (await templateBoard()).rows.find((r) => r.event === "review_posted" && r.channel === "in_app")!.volume;
    expect(after.sent - before.sent).toBe(2);
    expect(after.suppressed - before.suppressed).toBe(1);
  });

  it("lists an event that fired with no template as missing", async () => {
    await prisma.notificationDelivery.create({
      data: { event: "product_alert_matched", channel: "email", status: "skipped", reason: "board_12g_fixture" },
    });
    const row = (await templateBoard()).rows.find((r) => r.event === "product_alert_matched" && r.channel === "email");
    expect(row).toMatchObject({ state: "missing", twin: "no_body" });
    expect(row?.volume.suppressed).toBeGreaterThanOrEqual(1);
  });

  it("sends a test through the real sender, records it as a test, and stops after five in ten minutes", async () => {
    const template = await head("review_posted", "in_app", "neutral");
    const now = new Date();
    for (let i = 0; i < 5; i += 1) {
      expect(await sendTestToMe(opsLead, template!.id, now)).toMatchObject({ ok: true, channel: "in_app", delivered: true });
    }
    expect(await sendTestToMe(opsLead, template!.id, now)).toMatchObject({ ok: false, error: "test_throttled" });
    expect(await prisma.notificationDelivery.count({ where: { test: true, recipientUserId: opsLead.id, templateId: template!.id } })).toBe(5);
  });

  it("will not test WhatsApp wording Meta has not approved", async () => {
    const pending = await prisma.notificationTemplate.findFirstOrThrow({ where: { channel: "whatsapp", status: "pending_meta" }, orderBy: { id: "asc" } });
    expect(await sendTestToMe(opsLead, pending.id)).toMatchObject({ ok: false, error: "test_needs_approval" });
  });
});

describe("a buyer's held message reaches them when quiet hours lift", () => {
  it("is addressed from the buyer's account, not from seller seat channels", async () => {
    /*
       Board 12g found `deliverQueued` looking a buyer up in `SeatChannel`, where
       no buyer has a row, so a quote received at 22:00 failed as unaddressable
       at 07:00 even with its wording held.
    */
    const buyer = await prisma.user.findFirstOrThrow({
      where: { roles: { has: "buyer" }, email: { not: null }, businessId: null },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const row = await prisma.notificationDelivery.create({
      data: {
        event: "quote_received",
        channel: "email",
        status: "queued",
        recipientUserId: buyer.id,
        reason: "board_12g_fixture",
        payload: { subject: "A quote arrived", body: "Gulf Pump Engineering sent a quote on ENQ-12G.", actionLabel: null, actionUrl: null, metaTemplateName: null },
      },
    });
    await deliverQueued();
    const after = await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("sent");
    await prisma.notificationDelivery.update({ where: { id: row.id }, data: { reason: "board_12g_fixture" } });
  });
});
