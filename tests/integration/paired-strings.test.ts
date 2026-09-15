import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { actorFromDevSeller } from "@/lib/auth/dev-seller";
import type { Actor, Role } from "@/lib/auth/roles";
import { cancellationView } from "@/lib/billing/cancellation";
import { en } from "@/lib/i18n/en";
import { copiesFrom, PAIRED_STRINGS } from "@/lib/i18n/paired";
import { pairedBoard, pairingCountNow, restoreHalf, suppressHalf, writeHalf } from "@/lib/strings/service";
import { readEntryRows, readPairedCopyFor } from "@/lib/strings/store";
import { purgeAuditRows } from "./audit-cleanup";

/**
 * Board `12g-s` — paired strings against a real database.
 *
 * Every test starts with no `string_entry` rows — the seed state, every half at
 * its code default — and the suite removes the audit rows it wrote.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });
const REASON = "A practice has no catalogue, so the line said the wrong thing.";

let ops: Actor;
let moderator: Actor;

beforeAll(async () => {
  const [opsRow, moderatorRow] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { roles: { has: "staff_ops_lead" } }, orderBy: { id: "asc" }, select: { id: true } }),
    prisma.user.findFirstOrThrow({ where: { roles: { has: "staff_moderator" } }, orderBy: { id: "asc" }, select: { id: true } }),
  ]);
  ops = actor(opsRow.id, "staff_ops_lead");
  moderator = actor(moderatorRow.id, "staff_moderator");
  await prisma.stringEntry.deleteMany({});
});

afterEach(async () => {
  await prisma.stringEntry.deleteMany({});
});

afterAll(async () => {
  await purgeAuditRows({ action: { startsWith: "string_" } });
});

const version = async (key: string, kind: "goods" | "services") =>
  (await prisma.stringEntry.findUnique({ where: { key_locale_kind: { key, locale: "en", kind } }, select: { updatedAt: true } }))?.updatedAt.toISOString() ??
  null;

describe("writing a half", () => {
  it("writes the missing twin, moves the count, and audits who, why, before and after", async () => {
    const before = await pairingCountNow();
    const value = "One enquiry matched the services you offer after you reached the {cap}-enquiry limit on {plan}.";

    expect(await writeHalf({ actor: ops, key: "overview.missed_body_one", half: "services", value, reason: REASON, basedOn: null })).toEqual({
      ok: true,
      state: "written",
    });

    const after = await pairingCountNow();
    expect(after.unpaired).toBe(before.unpaired - 1);
    expect(after.paired).toBe(before.paired + 1);
    expect(after.staffDecisions).toBe(1);

    expect((await readPairedCopyFor("services"))["overview.missed_body_one"]).toBe(value);
    // The goods half is untouched, and a firm that sells both reads it.
    expect((await readPairedCopyFor("both"))["overview.missed_body_one"]).toBe(en["overview.missed_body_one"]);

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "string_written", subject: "StringEntry:overview.missed_body_one.services" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(audit.actorId).toBe(ops.id);
    expect(audit.reason).toBe(REASON);
    expect(audit.before).toMatchObject({ state: "missing", source: "code" });
    expect(audit.after).toEqual({ state: "written", value, source: "staff" });
  });

  it("refuses a placeholder the screen does not supply, a banned word, an empty half and an unchanged one", async () => {
    const base = { actor: ops, key: "overview.missed_body", half: "services" as const, reason: REASON, basedOn: null };
    expect(await writeHalf({ ...base, value: "{qty} enquiries matched your services" })).toEqual({
      ok: false,
      error: "unknown_placeholder",
      detail: { placeholders: ["qty"] },
    });
    expect(await writeHalf({ ...base, value: "{n} enquiries went to checkout" })).toMatchObject({ error: "vocabulary", detail: { rule: "banned", match: "checkout" } });
    expect(await writeHalf({ ...base, value: "   " })).toMatchObject({ error: "empty" });
    expect(await writeHalf({ ...base, key: "section.reviews.title", value: "What clients said" })).toMatchObject({ error: "unchanged" });
    expect(await writeHalf({ ...base, key: "nothing.declared", value: "Words" })).toMatchObject({ error: "not_found" });
    expect(await prisma.stringEntry.count()).toBe(0);
  });

  it("refuses a stale editor, so two people cannot overwrite each other unseen", async () => {
    await writeHalf({ actor: ops, key: "section.reviews.title", half: "services", value: "What clients wrote", reason: REASON, basedOn: null });
    expect(
      await writeHalf({ actor: ops, key: "section.reviews.title", half: "services", value: "What clients told us", reason: REASON, basedOn: null }),
    ).toMatchObject({ error: "stale" });
    const current = await version("section.reviews.title", "services");
    expect(
      await writeHalf({ actor: ops, key: "section.reviews.title", half: "services", value: "What clients told us", reason: REASON, basedOn: current }),
    ).toEqual({ ok: true, state: "written" });
  });

  it("is an ops lead's, and carries a reason", async () => {
    await expect(
      writeHalf({ actor: moderator, key: "section.reviews.title", half: "services", value: "What clients wrote", reason: REASON, basedOn: null }),
    ).rejects.toBeInstanceOf(PermissionError);
    await expect(
      writeHalf({ actor: ops, key: "section.reviews.title", half: "services", value: "What clients wrote", reason: " ", basedOn: null }),
    ).rejects.toBeInstanceOf(AuditReasonError);
    expect(await prisma.stringEntry.count()).toBe(0);
  });
});

describe("suppressing and restoring (B2)", () => {
  it("suppresses only where the registry allows it, and restores the code's decision by deleting the row", async () => {
    expect(
      await suppressHalf({ actor: ops, key: "section.reviews.title", half: "services", reason: REASON, basedOn: null }),
    ).toMatchObject({ error: "not_suppressible" });
    expect(await suppressHalf({ actor: ops, key: "change.row.csv_import", half: "services", reason: REASON, basedOn: null })).toMatchObject({
      error: "unchanged",
    });

    // A written half brings the control back for a firm that sells work; suppressing takes it away again.
    await writeHalf({ actor: ops, key: "change.row.csv_import", half: "services", value: "CSV import", reason: REASON, basedOn: null });
    expect((await readPairedCopyFor("services"))["change.row.csv_import"]).toBe("CSV import");
    const written = await version("change.row.csv_import", "services");
    expect(await suppressHalf({ actor: ops, key: "change.row.csv_import", half: "services", reason: REASON, basedOn: written })).toEqual({
      ok: true,
      state: "suppressed",
    });
    const stored = await prisma.stringEntry.findUniqueOrThrow({
      where: { key_locale_kind: { key: "change.row.csv_import", locale: "en", kind: "services" } },
    });
    expect(stored).toMatchObject({ state: "suppressed", value: null });
    expect((await readPairedCopyFor("services"))["change.row.csv_import"]).toBeNull();

    expect(
      await restoreHalf({ actor: ops, key: "change.row.csv_import", half: "services", reason: REASON, basedOn: stored.updatedAt.toISOString() }),
    ).toEqual({ ok: true, state: "restored" });
    expect(await prisma.stringEntry.count()).toBe(0);
    expect(await restoreHalf({ actor: ops, key: "change.row.csv_import", half: "services", reason: REASON, basedOn: null })).toMatchObject({
      error: "nothing_to_restore",
    });
  });

  it("holds a value to exactly the written rows in the database itself", async () => {
    await expect(
      prisma.stringEntry.create({ data: { key: "section.reviews.title", kind: "services", state: "suppressed", value: "x", updatedById: ops.id } }),
    ).rejects.toThrow();
    await expect(
      prisma.stringEntry.create({ data: { key: "section.reviews.title", kind: "services", state: "written", value: null, updatedById: ops.id } }),
    ).rejects.toThrow();
  });
});

describe("the board and its consumers (B3)", () => {
  it("lists every declared key once, with the count computed from the rows", async () => {
    await writeHalf({ actor: ops, key: "overview.missed_body", half: "services", value: "{n} enquiries matched your services this month after you reached the {cap}-enquiry limit on {plan}.", reason: REASON, basedOn: null });
    const board = await pairedBoard();
    expect(board.rows.map((row) => row.key)).toEqual(PAIRED_STRINGS.map((entry) => entry.key));
    expect(board.count).toEqual({ ...(await pairingCountNow()) });
    const row = board.rows.find((candidate) => candidate.key === "overview.missed_body")!;
    expect(row.services).toMatchObject({ state: "written", source: "staff", codeState: "missing" });
    expect(row.services.decidedBy).not.toBeNull();
    expect(board.catalogueKeys).toBe(Object.keys(en).length);
    expect(copiesFrom(await readEntryRows()).services["overview.missed_body"]).toContain("matched your services");
  });

  it("takes the CSV import row out of a firm that sells work's cancellation table, and keeps it for a stockist", async () => {
    // The paid stockist `cancellation.test.ts` uses, read only — its sells kind is flipped and put back.
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: "harbour-point-trading-llc" },
      select: { id: true, sellsKind: true, team: { where: { roles: { has: "seller_owner" } }, select: { id: true, roles: true }, take: 1 } },
    });
    const seat = business.team[0]!;
    const owner = actorFromDevSeller({ userId: seat.id, roles: seat.roles, businessId: business.id });

    const goods = await cancellationView(owner, business.id);
    expect(goods?.kind).toBe("cancellable");
    expect(goods?.kind === "cancellable" && goods.rows.some((row) => row.key === "csv_import")).toBe(true);

    await prisma.business.update({ where: { id: business.id }, data: { sellsKind: "services" } });
    try {
      const services = await cancellationView(owner, business.id);
      expect(services?.kind).toBe("cancellable");
      expect(services?.kind === "cancellable" && services.rows.some((row) => row.key === "csv_import")).toBe(false);
    } finally {
      await prisma.business.update({ where: { id: business.id }, data: { sellsKind: business.sellsKind } });
    }
  });
});
