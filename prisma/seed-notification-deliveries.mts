// ─────────────────────────────────────────────────────────────────────────────
// Notification deliveries — thirty days of what the send path would have logged.
//
// Board 12g's list is ordered by `SENT 30D`, a query over this table, and on a
// fresh database nothing has sent anything: every row reads 0 and the order is
// alphabetical by accident. A job-fed screen has only its empty state until the
// job has run, so the seed writes what it would have written.
//
// Deliberately anonymous. No business, recipient or enquiry: the jobs that read
// this table to decide what has already gone out — the licence notices, the
// setup nudge, the quote-expiry notice, the Ramadan shift — all scope by one of
// those ids, so a row with none of them cannot convince any of them that a
// seller has been told something. And every status is terminal (sent, skipped,
// failed): nothing here is `deferred` or `queued`, so `flushDeferred` and
// `deliverQueued` have nothing to pick up.
//
// Counts are fixed rather than random, so the console reads the same on every
// machine and a test can assert a number. Two shapes are here on purpose:
//
//   - services briefs sent through goods wording, which is the board's defect
//     measured — the red panel's "N messages about services briefs";
//   - `enquiry_escalated` on WhatsApp skipped with `no_live_template`, which is
//     what production held on 14 Sep 2026 (22 of them) and what the list shows as
//     *No template*.
// ─────────────────────────────────────────────────────────────────────────────

import type { Prisma, PrismaClient } from "../lib/db/generated/client.js";

type Db = PrismaClient;

interface Volume {
  event: string;
  channel: string;
  sent: number;
  /** Of `sent`, how many were about a services brief. */
  services?: number;
  skipped?: { reason: string; count: number }[];
  failed?: { reason: string; count: number }[];
}

const VOLUMES: Volume[] = [
  { event: "enquiry_received", channel: "in_app", sent: 184, services: 31 },
  { event: "enquiry_received", channel: "sms", sent: 96, services: 14, skipped: [{ reason: "channel_entered_but_not_verified", count: 9 }] },
  { event: "quote_received", channel: "in_app", sent: 141, services: 22 },
  { event: "quote_revised", channel: "in_app", sent: 52, services: 6 },
  { event: "quote_accepted", channel: "email", sent: 38, services: 5, failed: [{ reason: "Resend refused the send with HTTP 422", count: 1 }] },
  { event: "quote_accepted", channel: "sms", sent: 21, skipped: [{ reason: "recipient_has_no_address_for_this_channel", count: 4 }] },
  { event: "quote_expiring", channel: "in_app", sent: 17, services: 2 },
  { event: "enquiry_escalated", channel: "email", sent: 22 },
  { event: "enquiry_escalated", channel: "in_app", sent: 22 },
  { event: "message_received", channel: "in_app", sent: 64 },
  { event: "review_requested", channel: "email", sent: 19, services: 3 },
  { event: "review_posted", channel: "email", sent: 11 },
  { event: "document_expiring", channel: "email", sent: 12 },
  { event: "subscription_renewed", channel: "email", sent: 9 },
];

/** Production's own shape on 14 Sep 2026: an escalation matrix that lists WhatsApp, and no template for it. */
const ORPHANS = [{ event: "enquiry_escalated", channel: "whatsapp", reason: "no_live_template", count: 22 }];

const DAY = 86_400_000;
/** Events about a subscription or a licence rather than a request, so they carry no trade kind — as the emitters write them. */
const UNKINDED = new Set(["document_expiring", "subscription_renewed"]);

export async function seedNotificationDeliveries(db: Db): Promise<void> {
  console.log("→ notification deliveries");
  const templates = await db.notificationTemplate.findMany({
    where: { status: "live", locale: "en", kind: { in: ["goods", "neutral"] } },
    select: { id: true, event: true, channel: true },
  });
  const templateFor = new Map(templates.map((t) => [`${t.event}.${t.channel}`, t.id]));

  // Wall clock, not the seed's noon anchor: "the last 30 days" is measured from now.
  const now = Date.now();
  const at = (i: number, of: number) => new Date(now - Math.floor(((i + 0.5) / Math.max(of, 1)) * 29 * DAY));

  const rows: Prisma.NotificationDeliveryCreateManyInput[] = [];
  for (const volume of VOLUMES) {
    const templateId = templateFor.get(`${volume.event}.${volume.channel}`) ?? null;
    if (!templateId) continue;
    const base = { templateId, event: volume.event as never, channel: volume.channel as never };
    for (let i = 0; i < volume.sent; i += 1) {
      const createdAt = at(i, volume.sent);
      rows.push({ ...base, status: "sent", sentAt: createdAt, createdAt, tradeKind: UNKINDED.has(volume.event) ? null : i < (volume.services ?? 0) ? "services" : "goods" });
    }
    for (const skip of volume.skipped ?? []) {
      for (let i = 0; i < skip.count; i += 1) rows.push({ ...base, status: "skipped", reason: skip.reason, createdAt: at(i, skip.count) });
    }
    for (const failure of volume.failed ?? []) {
      for (let i = 0; i < failure.count; i += 1) rows.push({ ...base, status: "failed", reason: failure.reason, createdAt: at(i, failure.count) });
    }
  }
  for (const orphan of ORPHANS) {
    for (let i = 0; i < orphan.count; i += 1) {
      rows.push({ event: orphan.event as never, channel: orphan.channel as never, status: "skipped", reason: orphan.reason, createdAt: at(i, orphan.count) });
    }
  }

  const { count } = await db.notificationDelivery.createMany({ data: rows });
  console.log(`   ${count} deliveries over 30 days, none tied to a business`);
}
