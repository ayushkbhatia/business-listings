import "server-only";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/db/generated/client";
import { readAddress, type AddressError, type AddressField, type AddressFields } from "./address";
import { changedDetails, readDetails, type CompanyDetails, type DetailsError, type DetailsField } from "./details";
import { readThreshold } from "./team";
import { asAdmin, Refused, type NotAdmin, type Refusal } from "./guard";
import { activeMembership, writeCompanyEvent } from "./store";

/**
 * Board `7b` — writing the company: its details, its rule, its addresses.
 *
 * Every write here is an admin's, is made under the company's lock, and
 * writes its history row in the same transaction (`B8`). None of them is a
 * staff decision, so none writes `AuditEvent` — that log is the console's,
 * and `actorId` there means a member of staff.
 *
 * The capability check is membership, read from the record on each call: a
 * company role is not an `Actor` role and is never read from a session.
 */

// ── Creating a company ───────────────────────────────────────────────────────

export type CreateResult =
  | { ok: true; companyId: string }
  | { ok: false; error: "already_member" | "provisional" }
  | { ok: false; error: "invalid"; errors: Partial<Record<DetailsField, DetailsError>> };

/**
 * A buyer sets up the company they buy for, and becomes its admin.
 *
 * The first writer `User.buyerCompanyId` has ever had — through the
 * membership, whose trigger writes the column.
 */
export async function createCompany(
  actorId: string,
  raw: Partial<Record<DetailsField, string>>,
  now: Date = new Date(),
): Promise<CreateResult> {
  const read = readDetails(raw);
  if (!read.ok) return { ok: false, error: "invalid", errors: read.errors };

  const user = await prisma.user.findUnique({ where: { id: actorId }, select: { isProvisional: true } });
  // A buyer with only a claim token has no account to put a company on.
  if (!user || user.isProvisional) return { ok: false, error: "provisional" };

  try {
    const companyId = await prisma.$transaction(async (tx) => {
      // The person, not the company, is what two tabs would race on.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`buyer_company_member:${actorId}`}))`;
      if (await activeMembership(tx, actorId)) throw new Refused("already_member");

      const company = await tx.buyerCompany.create({
        data: { ...read.value, createdAt: now },
        select: { id: true },
      });
      await tx.buyerCompanyMember.create({
        data: { companyId: company.id, userId: actorId, role: "company_admin", joinedAt: now },
      });
      await writeCompanyEvent(tx, {
        companyId: company.id,
        actorId,
        kind: "company_created",
        subject: `company:${company.id}`,
        after: read.value as unknown as Prisma.InputJsonValue,
        at: now,
      });
      return company.id;
    });
    return { ok: true, companyId };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: "already_member" };
    // The partial unique index is the backstop the advisory lock stands in front of.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "already_member" };
    }
    throw error;
  }
}

// ── Details ──────────────────────────────────────────────────────────────────

export type DetailsResult =
  | { ok: true; changed: DetailsField[] }
  | Refusal<NotAdmin>
  | { ok: false; error: "invalid"; errors: Partial<Record<DetailsField, DetailsError>> };

/**
 * The four details. `B8`: the accepted supplier puts these on the tax invoice
 * they issue, so the history keeps what each field was before.
 */
export async function updateDetails(
  actorId: string,
  raw: Partial<Record<DetailsField, string>>,
  now: Date = new Date(),
): Promise<DetailsResult> {
  const read = readDetails(raw);
  if (!read.ok) return { ok: false, error: "invalid", errors: read.errors };

  return asAdmin(actorId, async (tx, seat) => {
    const current = await tx.buyerCompany.findUniqueOrThrow({
      where: { id: seat.companyId },
      select: { name: true, trn: true, licenceNumber: true, accountsEmail: true },
    });
    const changed = changedDetails(current as CompanyDetails, read.value);
    if (changed.length === 0) return { ok: true as const, changed };

    await tx.buyerCompany.update({ where: { id: seat.companyId }, data: read.value });
    await writeCompanyEvent(tx, {
      companyId: seat.companyId,
      actorId,
      kind: "details_changed",
      subject: `company:${seat.companyId}`,
      before: pick(current, changed),
      after: pick({ ...read.value }, changed),
      at: now,
    });
    return { ok: true as const, changed };
  });
}

function pick(row: Record<string, unknown>, fields: readonly string[]): Prisma.InputJsonValue {
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? null])) as Prisma.InputJsonValue;
}

// ── The rule ─────────────────────────────────────────────────────────────────

export type RuleResult =
  | { ok: true }
  | Refusal<NotAdmin | "approver_not_admin">
  | { ok: false; error: "invalid_threshold" | "threshold_too_large" };

/**
 * The threshold and who approves above it. Saved together because they are
 * one sentence on the card.
 *
 * The approver must be an active admin of this company: approving above the
 * threshold commits any amount, and only an admin's authority is unlimited.
 * An empty approver reads *an admin approves*.
 */
export async function updateRule(
  actorId: string,
  raw: { thresholdAed?: string; approverId?: string },
  now: Date = new Date(),
): Promise<RuleResult> {
  const threshold = readThreshold(raw.thresholdAed);
  if (!threshold.ok) {
    return { ok: false, error: threshold.error === "too_large" ? "threshold_too_large" : "invalid_threshold" };
  }
  const approverId = raw.approverId?.trim() || null;

  return asAdmin<RuleResult, "approver_not_admin">(actorId, async (tx, seat) => {
    if (approverId) {
      const approver = await tx.buyerCompanyMember.findFirst({
        where: { companyId: seat.companyId, userId: approverId, deactivatedAt: null, role: "company_admin" },
        select: { id: true },
      });
      if (!approver) throw new Refused("approver_not_admin");
    }
    const current = await tx.buyerCompany.findUniqueOrThrow({
      where: { id: seat.companyId },
      select: { approvalThresholdAed: true, approverId: true, approver: { select: { fullName: true, email: true } } },
    });
    const next = { approvalThresholdAed: threshold.value, approverId };
    if (current.approvalThresholdAed === next.approvalThresholdAed && current.approverId === next.approverId) {
      return { ok: true };
    }
    const nextApprover = approverId
      ? await tx.user.findUnique({ where: { id: approverId }, select: { fullName: true, email: true } })
      : null;
    await tx.buyerCompany.update({ where: { id: seat.companyId }, data: next });
    await writeCompanyEvent(tx, {
      companyId: seat.companyId,
      actorId,
      kind: "rule_changed",
      subject: `company:${seat.companyId}`,
      // Names beside the ids: the history is read by people, and an approver
      // who has since left is still who the rule named.
      before: {
        approvalThresholdAed: current.approvalThresholdAed,
        approverId: current.approverId,
        approverName: current.approver ? current.approver.fullName ?? current.approver.email : null,
      },
      after: {
        ...next,
        approverName: nextApprover ? nextApprover.fullName ?? nextApprover.email : null,
      },
      at: now,
    });
    return { ok: true };
  });
}

export const RULE_FLAGS = [
  "requirePoNumber",
  "requireCostCode",
  "unverifiedNeedsApproval",
  "tellAdminsOffPlatform",
] as const;
export type RuleFlag = (typeof RULE_FLAGS)[number];

export function isRuleFlag(value: string): value is RuleFlag {
  return (RULE_FLAGS as readonly string[]).includes(value);
}

/** One toggle. A toggle applies immediately, so this is one write and one history line. */
export async function setRuleFlag(
  actorId: string,
  flag: RuleFlag,
  value: boolean,
  now: Date = new Date(),
): Promise<{ ok: true; value: boolean } | Refusal<NotAdmin>> {
  return asAdmin(actorId, async (tx, seat) => {
    const current = await tx.buyerCompany.findUniqueOrThrow({
      where: { id: seat.companyId },
      select: { [flag]: true } as Record<RuleFlag, true>,
    });
    const before = (current as Record<RuleFlag, boolean>)[flag];
    if (before === value) return { ok: true as const, value };
    await tx.buyerCompany.update({ where: { id: seat.companyId }, data: { [flag]: value } });
    await writeCompanyEvent(tx, {
      companyId: seat.companyId,
      actorId,
      kind: "rule_changed",
      subject: `company:${seat.companyId}`,
      before: { [flag]: before },
      after: { [flag]: value },
      at: now,
    });
    return { ok: true as const, value };
  });
}

// ── Addresses ────────────────────────────────────────────────────────────────

export type AddressResult =
  | { ok: true; addressId: string }
  | Refusal<NotAdmin | "not_found" | "area_mismatch" | "default_needs_replacement">
  | { ok: false; error: "invalid"; errors: Partial<Record<AddressField, AddressError>> };

/** An area named on an address must be in the emirate named beside it. */
async function checkArea(tx: Prisma.TransactionClient, value: AddressFields): Promise<void> {
  if (!value.areaId) return;
  const area = await tx.area.findFirst({ where: { id: value.areaId, emirate: value.emirate }, select: { id: true } });
  if (!area) throw new Refused("area_mismatch");
}

function addressJson(value: AddressFields): Prisma.InputJsonValue {
  return { ...value } as unknown as Prisma.InputJsonValue;
}

/** Add an address. The company's first one is its default, because an enquiry needs one to preselect. */
export async function addAddress(
  actorId: string,
  raw: Partial<Record<AddressField, string>>,
  now: Date = new Date(),
): Promise<AddressResult> {
  const read = readAddress(raw);
  if (!read.ok) return { ok: false, error: "invalid", errors: read.errors };
  return asAdmin<AddressResult, "area_mismatch">(actorId, async (tx, seat) => {
    await checkArea(tx, read.value);
    const hasDefault = await tx.buyerDeliveryAddress.count({
      where: { companyId: seat.companyId, isDefault: true, archivedAt: null },
    });
    const address = await tx.buyerDeliveryAddress.create({
      data: { ...read.value, companyId: seat.companyId, isDefault: hasDefault === 0, createdAt: now, updatedAt: now },
      select: { id: true },
    });
    await writeCompanyEvent(tx, {
      companyId: seat.companyId,
      actorId,
      kind: "address_added",
      subject: `address:${address.id}`,
      after: addressJson(read.value),
      note: read.value.label,
      at: now,
    });
    return { ok: true, addressId: address.id };
  });
}

const ADDRESS_SELECT = {
  label: true,
  addressLine: true,
  emirate: true,
  areaId: true,
  attnName: true,
  attnPhone: true,
  accessPoint: true,
  accessFrom: true,
  accessUntil: true,
  loadLimit: true,
} as const;

export async function updateAddress(
  actorId: string,
  addressId: string,
  raw: Partial<Record<AddressField, string>>,
  now: Date = new Date(),
): Promise<AddressResult> {
  const read = readAddress(raw);
  if (!read.ok) return { ok: false, error: "invalid", errors: read.errors };
  return asAdmin<AddressResult, "not_found" | "area_mismatch">(actorId, async (tx, seat) => {
    const current = await tx.buyerDeliveryAddress.findFirst({
      where: { id: addressId, companyId: seat.companyId, archivedAt: null },
      select: ADDRESS_SELECT,
    });
    if (!current) throw new Refused("not_found");
    await checkArea(tx, read.value);
    const fields = (Object.keys(read.value) as AddressField[]).filter(
      (field) => (current as Record<string, unknown>)[field] !== read.value[field],
    );
    if (fields.length === 0) return { ok: true, addressId };
    await tx.buyerDeliveryAddress.update({ where: { id: addressId }, data: { ...read.value, updatedAt: now } });
    await writeCompanyEvent(tx, {
      companyId: seat.companyId,
      actorId,
      kind: "address_changed",
      subject: `address:${addressId}`,
      before: pick(current, fields),
      after: pick(read.value as unknown as Record<string, unknown>, fields),
      note: read.value.label,
      at: now,
    });
    return { ok: true, addressId };
  });
}

/**
 * Archive an address. The enquiries that went there keep their snapshot.
 *
 * The default cannot be archived while another address could take its place —
 * a company with addresses and no default would send its next enquiry with
 * nothing preselected, silently. Make another the default first. The last
 * address can go.
 */
export async function archiveAddress(
  actorId: string,
  addressId: string,
  now: Date = new Date(),
): Promise<AddressResult> {
  return asAdmin<AddressResult, "not_found" | "default_needs_replacement">(actorId, async (tx, seat) => {
    const current = await tx.buyerDeliveryAddress.findFirst({
      where: { id: addressId, companyId: seat.companyId, archivedAt: null },
      select: { ...ADDRESS_SELECT, isDefault: true },
    });
    if (!current) throw new Refused("not_found");
    if (current.isDefault) {
      const others = await tx.buyerDeliveryAddress.count({
        where: { companyId: seat.companyId, archivedAt: null, id: { not: addressId } },
      });
      if (others > 0) throw new Refused("default_needs_replacement");
    }
    await tx.buyerDeliveryAddress.update({
      where: { id: addressId },
      data: { archivedAt: now, isDefault: false, updatedAt: now },
    });
    await writeCompanyEvent(tx, {
      companyId: seat.companyId,
      actorId,
      kind: "address_archived",
      subject: `address:${addressId}`,
      before: { label: current.label },
      note: current.label,
      at: now,
    });
    return { ok: true, addressId };
  });
}

/** Make this the default. The old default is cleared first: the partial index allows one. */
export async function setDefaultAddress(
  actorId: string,
  addressId: string,
  now: Date = new Date(),
): Promise<AddressResult> {
  return asAdmin<AddressResult, "not_found">(actorId, async (tx, seat) => {
    const target = await tx.buyerDeliveryAddress.findFirst({
      where: { id: addressId, companyId: seat.companyId, archivedAt: null },
      select: { id: true, isDefault: true, label: true },
    });
    if (!target) throw new Refused("not_found");
    if (target.isDefault) return { ok: true, addressId };
    const previous = await tx.buyerDeliveryAddress.findFirst({
      where: { companyId: seat.companyId, isDefault: true, archivedAt: null },
      select: { id: true, label: true },
    });
    if (previous) {
      await tx.buyerDeliveryAddress.update({ where: { id: previous.id }, data: { isDefault: false, updatedAt: now } });
    }
    await tx.buyerDeliveryAddress.update({ where: { id: addressId }, data: { isDefault: true, updatedAt: now } });
    await writeCompanyEvent(tx, {
      companyId: seat.companyId,
      actorId,
      kind: "default_address_changed",
      subject: `address:${addressId}`,
      before: previous ? { label: previous.label } : null,
      after: { label: target.label },
      note: target.label,
      at: now,
    });
    return { ok: true, addressId };
  });
}
