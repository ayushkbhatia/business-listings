import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/client";
import { emailInvoice } from "@/lib/billing/invoice-delivery";
import { issueInvoice } from "@/lib/billing/invoice";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Board 11g's `DELIVERY` panel — sending an invoice, and the row that says it
 * went. The one write on the invoice screen, and until this file nothing
 * asserted any of its six outcomes.
 *
 * What it pins is two defects and the rule both of them broke: **the address
 * the row records is the address the message went to, and nothing else.**
 *
 * - A cleared one-off address fell through to the billing address. The action
 *   passes `""` for a field that was opened and emptied and says, in a comment,
 *   that this must not reach Settings; `to?.trim() || billingRecipient()` sent
 *   it there anyway.
 * - It checked the seat's role and not the seat's business, so a finance seat
 *   could mail another firm's invoice to an address of its choosing.
 *
 * A business of this file's own, with its own owner and finance seats, because
 * the billing recipient is a lookup across both and a seeded firm's team is
 * whatever the seed and every sibling suite left it.
 */

/*
   The email sender, switchable and captured.

   `resolveNotificationSenders` hands back Resend wherever the key is set, and a
   suite that mails somebody on every run is a suite people stop running. The
   three modes are the three things a sender can be: there, there and refusing,
   and absent — which is production without a key.
*/
const mail = vi.hoisted(() => ({
  mode: "deliver" as "deliver" | "refuse" | "absent",
  sent: [] as { to: string; subject?: string; actionUrl?: string; body: string }[],
}));
vi.mock("@/lib/notify/senders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notify/senders")>();
  return {
    ...actual,
    resolveNotificationSenders: () =>
      mail.mode === "absent"
        ? {}
        : {
            email: {
              name: "test:email",
              channel: "email",
              send: async (message: {
                to: string;
                subject?: string;
                actionUrl?: string;
                body: string;
              }) => {
                if (mail.mode === "refuse") return { delivered: false, detail: "bounced" };
                mail.sent.push({
                  to: message.to,
                  subject: message.subject,
                  actionUrl: message.actionUrl,
                  body: message.body,
                });
                return { delivered: true };
              },
            },
          },
  };
});

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const OWNER_EMAIL = `owner-${stamp}@invoice-delivery.test`;
const FINANCE_EMAIL = `finance-${stamp}@invoice-delivery.test`;
const ACCOUNTS_EMAIL = `accounts-${stamp}@invoice-delivery.test`;

let businessId = "";
let otherBusinessId = "";
let invoiceId = "";
let draftId = "";
let otherInvoiceId = "";
let owner: Actor;
let finance: Actor;
let manager: Actor;
const users: string[] = [];

const actor = (id: string, business: string, ...roles: Role[]): Actor => ({
  id,
  roles,
  businessId: business,
});

async function makeBusiness(label: string): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({
    where: { parentId: null },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  const business = await prisma.business.create({
    data: {
      displayName: `Invoice Delivery ${label} ${stamp}`,
      tradeName: `Invoice Delivery ${label} ${stamp} LLC`,
      slug: `invoice-delivery-${label}-${stamp}`,
      licenceNumber: `DED-ID${label.slice(0, 1)}${stamp.slice(-5)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: category.id,
      claimStatus: "claimed",
      planId: "basic",
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  return business.id;
}

async function makeSeat(business: string, role: Role, email: string): Promise<Actor> {
  const id = randomUUID();
  await prisma.user.create({
    data: { id, email, fullName: `Seat ${role}`, roles: [role], businessId: business },
  });
  users.push(id);
  return actor(id, business, role);
}

async function issue(business: string): Promise<string> {
  const now = new Date();
  const invoice = await issueInvoice({
    businessId: business,
    issuedAt: now,
    paidAt: now,
    lines: [{ kind: "subscription", description: "Basic subscription", fils: 34_900 }],
  });
  return invoice.id;
}

/** Everything about the document that sending it must leave alone. */
async function documentOf(id: string) {
  return prisma.invoice.findUniqueOrThrow({
    where: { id },
    select: {
      ref: true,
      status: true,
      totalFils: true,
      subtotalFils: true,
      vatFils: true,
      paidAt: true,
      billedToName: true,
      pdfPath: true,
    },
  });
}

const events = (id: string) =>
  prisma.invoiceEvent.findMany({
    where: { invoiceId: id, kind: "emailed" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { recipient: true, actorId: true },
  });

beforeAll(async () => {
  businessId = await makeBusiness("own");
  otherBusinessId = await makeBusiness("other");

  owner = await makeSeat(businessId, "seller_owner", OWNER_EMAIL);
  finance = await makeSeat(businessId, "seller_finance", FINANCE_EMAIL);
  manager = await makeSeat(businessId, "seller_manager", `manager-${stamp}@invoice-delivery.test`);
  await makeSeat(otherBusinessId, "seller_owner", `other-${stamp}@invoice-delivery.test`);

  invoiceId = await issue(businessId);
  otherInvoiceId = await issue(otherBusinessId);
  draftId = await issue(businessId);
  await prisma.invoice.update({ where: { id: draftId }, data: { status: "draft" } });
});

beforeEach(async () => {
  mail.mode = "deliver";
  mail.sent.splice(0);
  await prisma.invoiceEvent.deleteMany({
    where: { invoiceId: { in: [invoiceId, otherInvoiceId, draftId] } },
  });
  await prisma.notificationPreference.deleteMany({ where: { businessId } });
});

afterAll(async () => {
  // Invoices, their events and the preference cascade from the business.
  await prisma.business.deleteMany({ where: { id: { in: [businessId, otherBusinessId] } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

describe("where the invoice goes when nobody types an address", () => {
  it("goes to the billing address in Settings, and the row names it", async () => {
    await prisma.notificationPreference.create({
      data: { businessId, billingEmail: ACCOUNTS_EMAIL },
    });

    const result = await emailInvoice(owner, businessId, invoiceId);

    expect(result).toEqual({ ok: true, address: ACCOUNTS_EMAIL });
    expect(mail.sent.map((m) => m.to)).toEqual([ACCOUNTS_EMAIL]);
    expect(await events(invoiceId)).toEqual([{ recipient: ACCOUNTS_EMAIL, actorId: owner.id }]);
  });

  it("falls back to the finance seat, then to the owner", async () => {
    expect(await emailInvoice(owner, businessId, invoiceId)).toEqual({
      ok: true,
      address: FINANCE_EMAIL,
    });

    // With no finance seat, the owner. Removed and put back, so the order of
    // the tests in this file cannot decide what the next one finds.
    await prisma.user.update({ where: { id: finance.id }, data: { roles: ["seller_manager"] } });
    try {
      expect(await emailInvoice(owner, businessId, invoiceId)).toEqual({
        ok: true,
        address: OWNER_EMAIL,
      });
    } finally {
      await prisma.user.update({ where: { id: finance.id }, data: { roles: ["seller_finance"] } });
    }
    expect((await events(invoiceId)).map((e) => e.recipient)).toEqual([FINANCE_EMAIL, OWNER_EMAIL]);
  });

  it("carries a link to the document rather than the document", async () => {
    await emailInvoice(owner, businessId, invoiceId);
    const [message] = mail.sent;
    expect(message?.actionUrl).toMatch(new RegExp(`/dashboard/billing/invoice/${invoiceId}$`));
    const { ref } = await documentOf(invoiceId);
    expect(message?.subject).toContain(ref);
  });
});

describe("a one-off address", () => {
  it("goes where it was typed, and leaves Settings as it was", async () => {
    await prisma.notificationPreference.create({
      data: { businessId, billingEmail: ACCOUNTS_EMAIL },
    });
    const typed = `auditor-${stamp}@invoice-delivery.test`;

    const result = await emailInvoice(finance, businessId, invoiceId, `  ${typed}  `);

    expect(result).toEqual({ ok: true, address: typed });
    expect(mail.sent.map((m) => m.to)).toEqual([typed]);
    expect(await events(invoiceId)).toEqual([{ recipient: typed, actorId: finance.id }]);
    const preference = await prisma.notificationPreference.findUniqueOrThrow({
      where: { businessId },
      select: { billingEmail: true },
    });
    expect(preference.billingEmail).toBe(ACCOUNTS_EMAIL);
  });

  /*
     The defect. Opened, typed into, cleared: `""` reaches the service, and the
     service is the place that has to tell absent from empty — the screen's
     disabled button is a convenience, and a crafted post goes round it.
  */
  it("refuses one that was cleared, rather than sending to the billing address", async () => {
    await prisma.notificationPreference.create({
      data: { businessId, billingEmail: ACCOUNTS_EMAIL },
    });

    for (const cleared of ["", "   "]) {
      const result = await emailInvoice(owner, businessId, invoiceId, cleared);
      expect(result).toEqual({ ok: false, error: "no_address" });
    }
    expect(mail.sent).toHaveLength(0);
    expect(await events(invoiceId)).toHaveLength(0);
  });

  it("refuses one that is not an address", async () => {
    const result = await emailInvoice(owner, businessId, invoiceId, "accounts at example");
    expect(result).toEqual({ ok: false, error: "no_address" });
    expect(mail.sent).toHaveLength(0);
    expect(await events(invoiceId)).toHaveLength(0);
  });
});

describe("the row is written only for a message that went", () => {
  /*
     No configured sender is a refusal, not a silent success. A row saying it
     was emailed is a claim, and with nothing to send it the claim is false.
  */
  it("says so when email is not connected, and records nothing", async () => {
    mail.mode = "absent";
    const result = await emailInvoice(owner, businessId, invoiceId);
    expect(result).toEqual({ ok: false, error: "no_sender" });
    expect(await events(invoiceId)).toHaveLength(0);
  });

  it("says so when the carrier refuses it, and records nothing", async () => {
    mail.mode = "refuse";
    const result = await emailInvoice(owner, businessId, invoiceId);
    expect(result).toEqual({ ok: false, error: "refused" });
    expect(await events(invoiceId)).toHaveLength(0);
  });

  it("refuses when nobody on the account has an address", async () => {
    const bare = await makeBusiness("bare");
    const seat = await makeSeat(bare, "seller_owner", `bare-${stamp}@invoice-delivery.test`);
    await prisma.user.update({ where: { id: seat.id }, data: { email: null } });
    const bareInvoice = await issue(bare);
    try {
      expect(await emailInvoice(seat, bare, bareInvoice)).toEqual({
        ok: false,
        error: "no_address",
      });
      expect(mail.sent).toHaveLength(0);
    } finally {
      await prisma.business.delete({ where: { id: bare } });
    }
  });
});

describe("criterion 10 — sending the invoice does not touch the invoice", () => {
  it("leaves every figure, the status and the stored file as they were", async () => {
    const before = await documentOf(invoiceId);
    await emailInvoice(owner, businessId, invoiceId);
    await emailInvoice(owner, businessId, invoiceId, `copy-${stamp}@invoice-delivery.test`);
    expect(await documentOf(invoiceId)).toEqual(before);
    // Two sends, two rows: the log is of what happened, not of the latest.
    expect(await events(invoiceId)).toHaveLength(2);
  });
});

describe("who may send it", () => {
  it("refuses a seat without billing.manage", async () => {
    await expect(emailInvoice(manager, businessId, invoiceId)).rejects.toThrow(PermissionError);
    expect(mail.sent).toHaveLength(0);
  });

  /*
     The second defect. The role was checked and the business was not, so this
     finance seat could send another firm's invoice to any address — the id is
     in that firm's URL, and the business id beside it in the same form post.
  */
  it("refuses a billing seat of another business, as if the invoice did not exist", async () => {
    const result = await emailInvoice(
      finance,
      otherBusinessId,
      otherInvoiceId,
      `outsider-${stamp}@invoice-delivery.test`,
    );
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(mail.sent).toHaveLength(0);
    expect(await events(otherInvoiceId)).toHaveLength(0);
  });

  it("does not find another business's invoice under this business", async () => {
    const result = await emailInvoice(finance, businessId, otherInvoiceId);
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(mail.sent).toHaveLength(0);
  });

  it("does not send a draft, which is not a document yet", async () => {
    const result = await emailInvoice(owner, businessId, draftId);
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(mail.sent).toHaveLength(0);
  });
});
