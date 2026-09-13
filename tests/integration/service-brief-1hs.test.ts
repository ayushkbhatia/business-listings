import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  briefFirstReplyMedianMs,
  briefWanted,
  findBriefCandidates,
  previewBrief,
  sendServiceBrief,
  type SendServiceBriefInput,
} from "@/lib/enquiry/service-brief-server";
import { confirmEnquiryAttachment, type StorageDeps } from "@/lib/enquiry/service-enquiry-server";
import { reviseRequirement } from "@/lib/enquiry/revise";
import { MAX_BRIEF_ATTACHMENTS } from "@/lib/enquiry/service-brief";
import { getLeadDetail } from "@/lib/db/queries/seller";
import { getBuyerEnquiry } from "@/lib/db/queries/enquiry";

/**
 * Board `1h-s` — the brief, against a database.
 *
 * What a unit test cannot reach: that the four clauses of B5 are applied by
 * the query and not only by the ranking; that coverage is the union of a firm's
 * live services and not its default line; that a sent brief is **one** enquiry
 * with N recipients, one `ServiceBrief` and one unquantified line; that the
 * description a supplier reads is byte for byte what was typed; that a null
 * scale reaches both sides as null; and that a brief nobody can take writes
 * nothing at all.
 *
 * A trade of its own, so the seed's facilities firms cannot move a count here.
 */

const PREFIX = "brief-1hs-";
let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

const businesses: string[] = [];
const users: string[] = [];
let sectorId: string;
let tradeId: string;
let neighbourId: string;
let goodsId: string;
let alQuoz: { id: string; emirate: "dubai" };
let deira: { id: string; emirate: "dubai" };
let buyerId: string;

type Scope = { emirate: "dubai" | "sharjah" | "abu_dhabi"; areaId: string | null };

async function makeFirm(fields: {
  tier?: number;
  sellsKind?: "services" | "both" | "goods";
  claimed?: boolean;
  expired?: boolean;
  primary?: string;
  coverage?: Scope[];
  services?: { categoryId?: string; engagementType?: "ongoing_contract" | "one_off_job" | "call_off"; status?: "live" | "draft"; coverage?: Scope[] }[];
  plan?: string;
  replyMs?: number | null;
} = {}) {
  const mark = stamp();
  const firm = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-B${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + (fields.expired ? -2 : 300) * 86_400_000),
      primaryCategoryId: fields.primary ?? tradeId,
      claimStatus: fields.claimed === false ? "unclaimed" : "claimed",
      sellsKind: fields.sellsKind ?? "services",
      publishedAt: new Date(),
      verificationTier: fields.tier ?? 2,
      responseTimeMedianMs: fields.replyMs ?? null,
      ...(fields.plan ? { planId: fields.plan } : {}),
    },
    select: { id: true, slug: true, displayName: true },
  });
  businesses.push(firm.id);

  await prisma.serviceCoverage.createMany({
    data: (fields.coverage ?? [{ emirate: "dubai", areaId: null }]).map((row) => ({ businessId: firm.id, ...row })),
  });
  for (const [i, service] of (fields.services ?? []).entries()) {
    const row = await prisma.service.create({
      data: {
        businessId: firm.id,
        categoryId: service.categoryId ?? tradeId,
        name: `Service ${i}`,
        slug: `service-${i}`,
        status: service.status ?? "live",
        position: i,
        engagementType: service.engagementType ?? "ongoing_contract",
      },
      select: { id: true },
    });
    if (service.coverage) {
      await prisma.serviceCoverage.createMany({
        data: service.coverage.map((scope) => ({ businessId: firm.id, serviceId: row.id, ...scope })),
      });
    }
  }
  return firm;
}

const ids = async (request: Parameters<typeof findBriefCandidates>[0]) =>
  (await findBriefCandidates(request)).map((c) => c.businessId).filter((id) => businesses.includes(id));

const brief = (over: Partial<SendServiceBriefInput> = {}): SendServiceBriefInput => ({
  categoryId: tradeId,
  kind: null,
  site: `area:${alQuoz.id}`,
  widen: false,
  building: "",
  description: `${PREFIX}  1. Quarterly PPM on two chillers\n\n  2. A 24/7 reactive line.\t`,
  engagement: "ongoing_contract",
  cadence: "quarterly",
  startMode: "asap",
  startsOn: "",
  scale: "",
  pinned: null,
  service: null,
  attachments: [],
  contactPhone: "",
  contactName: "",
  ...over,
});

function fakeStorage(stored: { bytes: number; mimeType: string | null } | null = null) {
  const calls = { signed: [] as string[] };
  const deps: StorageDeps = {
    sign: async (_bucket, path) => {
      calls.signed.push(path);
      return { path, token: "token", url: `https://storage.test/${path}` };
    },
    stat: async () => stored,
    remove: async () => undefined,
  };
  return { deps, calls };
}

beforeAll(async () => {
  const mark = stamp();
  const sector = await prisma.category.create({
    data: { name: `${PREFIX}sector`, slug: `${PREFIX}sector-${mark}`, code: "BS", tradeKind: "services" },
    select: { id: true },
  });
  sectorId = sector.id;
  const [trade, neighbour, goods] = await Promise.all([
    prisma.category.create({
      data: { parentId: sectorId, name: `${PREFIX}trade`, slug: `${PREFIX}trade-${mark}`, code: "BT" },
      select: { id: true },
    }),
    prisma.category.create({
      data: { parentId: sectorId, name: `${PREFIX}neighbour`, slug: `${PREFIX}neighbour-${mark}`, code: "BN" },
      select: { id: true },
    }),
    prisma.category.create({
      data: { name: `${PREFIX}goods`, slug: `${PREFIX}goods-${mark}`, code: "BG", tradeKind: "goods" },
      select: { id: true },
    }),
  ]);
  tradeId = trade.id;
  neighbourId = neighbour.id;
  goodsId = goods.id;

  const areas = await prisma.area.findMany({
    where: { slug: { in: ["al-quoz-industrial-1", "deira"] } },
    select: { id: true, slug: true },
  });
  alQuoz = { id: areas.find((a) => a.slug === "al-quoz-industrial-1")!.id, emirate: "dubai" };
  deira = { id: areas.find((a) => a.slug === "deira")!.id, emirate: "dubai" };

  buyerId = randomUUID();
  await prisma.user.create({
    data: { id: buyerId, phone: `+97150${Date.now().toString().slice(-7)}`, fullName: "Rania Haddad", roles: ["buyer"] },
  });
  users.push(buyerId);
});

afterAll(async () => {
  await prisma.enquiry.deleteMany({ where: { requirement: { startsWith: PREFIX } } });
  await prisma.business.deleteMany({ where: { id: { in: businesses } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.category.deleteMany({ where: { id: { in: [tradeId, neighbourId, goodsId] } } });
  await prisma.category.deleteMany({ where: { id: sectorId } });
});

describe("briefWanted — which composer the route mounts", () => {
  it("follows the trade's kind, a named firm that sells only work, and a kind=services with live work behind it", async () => {
    expect(await briefWanted({ categoryId: tradeId, kindParam: null, pinnedSellsKind: null })).toBe(true);
    expect(await briefWanted({ categoryId: goodsId, kindParam: null, pinnedSellsKind: null })).toBe(false);
    expect(await briefWanted({ categoryId: goodsId, kindParam: null, pinnedSellsKind: "services" })).toBe(true);
    // A hand-typed kind cannot turn a trade nobody sells work in into a brief.
    expect(await briefWanted({ categoryId: goodsId, kindParam: "services", pinnedSellsKind: null })).toBe(false);
    await makeFirm({ primary: goodsId, services: [{ categoryId: goodsId }] });
    expect(await briefWanted({ categoryId: goodsId, kindParam: "services", pinnedSellsKind: null })).toBe(true);
  });
});

describe("findBriefCandidates — B5", () => {
  it("routes only on a verified, current licence, to a claimed firm that sells work", async () => {
    const verified = await makeFirm();
    const unverified = await makeFirm({ tier: 1 });
    const expired = await makeFirm({ expired: true });
    const unclaimed = await makeFirm({ claimed: false });
    const goodsSeller = await makeFirm({ sellsKind: "goods" });
    const both = await makeFirm({ sellsKind: "both" });

    const found = await ids({ categoryId: tradeId, site: { emirate: "dubai", areaId: null }, scope: "area", engagement: null });
    expect(found).toContain(verified.id);
    expect(found).toContain(both.id);
    for (const excluded of [unverified, expired, unclaimed, goodsSeller]) expect(found).not.toContain(excluded.id);
  });

  it("matches the trade by listing or by a live service, and the sector's children under it", async () => {
    const listed = await makeFirm();
    const byService = await makeFirm({ primary: goodsId, services: [{}] });
    const byDraft = await makeFirm({ primary: goodsId, services: [{ status: "draft" }] });
    const neighbour = await makeFirm({ primary: neighbourId });

    const site = { emirate: "dubai" as const, areaId: null };
    const inTrade = await ids({ categoryId: tradeId, site, scope: "area", engagement: null });
    expect(inTrade).toEqual(expect.arrayContaining([listed.id, byService.id]));
    expect(inTrade).not.toContain(byDraft.id);
    expect(inTrade).not.toContain(neighbour.id);

    // Downward only: the sector reaches its children.
    expect(await ids({ categoryId: sectorId, site, scope: "area", engagement: null })).toEqual(
      expect.arrayContaining([listed.id, neighbour.id]),
    );
  });

  it("reaches an area by the area or its emirate, and reads the union of live services, not the default", async () => {
    const wholeDubai = await makeFirm();
    const alQuozOnly = await makeFirm({ coverage: [{ emirate: "dubai", areaId: alQuoz.id }] });
    // Default says Sharjah; its one live service narrows to Deira. The union is Deira.
    const narrowed = await makeFirm({
      coverage: [{ emirate: "sharjah", areaId: null }],
      services: [{ coverage: [{ emirate: "dubai", areaId: deira.id }] }],
    });

    const atAlQuoz = await ids({ categoryId: tradeId, site: { emirate: "dubai", areaId: alQuoz.id }, scope: "area", engagement: null });
    expect(atAlQuoz).toEqual(expect.arrayContaining([wholeDubai.id, alQuozOnly.id]));
    expect(atAlQuoz).not.toContain(narrowed.id);

    const atDeira = await ids({ categoryId: tradeId, site: { emirate: "dubai", areaId: deira.id }, scope: "area", engagement: null });
    expect(atDeira).toEqual(expect.arrayContaining([wholeDubai.id, narrowed.id]));
    expect(atDeira).not.toContain(alQuozOnly.id);

    // Widened to the emirate, a firm working anywhere in Dubai counts.
    expect(
      await ids({ categoryId: tradeId, site: { emirate: "dubai", areaId: deira.id }, scope: "emirate", engagement: null }),
    ).toContain(alQuozOnly.id);

    const inSharjah = await ids({ categoryId: tradeId, site: { emirate: "sharjah", areaId: null }, scope: "area", engagement: null });
    expect(inSharjah).not.toContain(narrowed.id);
  });

  it("marks the engagement a firm sells, for ranking and never for filtering", async () => {
    const callOff = await makeFirm({ coverage: [{ emirate: "abu_dhabi", areaId: null }], services: [{ engagementType: "call_off" }] });
    const ongoing = await makeFirm({ coverage: [{ emirate: "abu_dhabi", areaId: null }], services: [{ engagementType: "ongoing_contract" }] });
    const candidates = (
      await findBriefCandidates({ categoryId: tradeId, site: { emirate: "abu_dhabi", areaId: null }, scope: "area", engagement: "call_off" })
    ).filter((c) => [callOff.id, ongoing.id].includes(c.businessId));
    expect(candidates.find((c) => c.businessId === callOff.id)?.offersEngagement).toBe(true);
    expect(candidates.find((c) => c.businessId === ongoing.id)?.offersEngagement).toBe(false);
  });
});

describe("sendServiceBrief — one enquiry, one brief, N recipients", () => {
  it("writes the brief verbatim, with one unquantified line and no scale invented", async () => {
    const a = await makeFirm({ coverage: [{ emirate: "dubai", areaId: alQuoz.id }], replyMs: 3_600_000 });
    const b = await makeFirm({ coverage: [{ emirate: "dubai", areaId: alQuoz.id }] });
    const typed = brief().description;

    const result = await sendServiceBrief(brief({ building: " Tower  B " }), { buyerId }, fakeStorage().deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const enquiry = await prisma.enquiry.findUniqueOrThrow({
      where: { id: result.enquiryId },
      select: {
        requirement: true,
        emirate: true,
        areaId: true,
        deliverToArea: true,
        scale: true,
        neededBy: true,
        lines: { select: { description: true, qty: true, targetUnitPriceAed: true } },
        recipients: { select: { businessId: true } },
        serviceBrief: true,
      },
    });
    // AC2: byte for byte.
    expect(enquiry.requirement).toBe(typed);
    // AC11: one brief, one line, and the line asks no quantity (AC1).
    expect(enquiry.lines).toEqual([{ description: `${PREFIX}trade`, qty: null, targetUnitPriceAed: null }]);
    expect(enquiry.serviceBrief).toMatchObject({
      categoryId: tradeId,
      engagementType: "ongoing_contract",
      cadence: "quarterly",
      startMode: "asap",
      startsOn: null,
      building: "Tower B",
    });
    // AC7, AC8: an empty scale is stored as null, never a default.
    expect(enquiry.scale).toBeNull();
    expect(enquiry.neededBy).toBeNull();
    // The picked area written directly, and the words a notification prints.
    expect(enquiry).toMatchObject({ emirate: "dubai", areaId: alQuoz.id, deliverToArea: "Al Quoz Industrial 1, Dubai" });
    expect(enquiry.recipients.map((r) => r.businessId).sort()).toEqual(
      expect.arrayContaining([a.id, b.id].sort()),
    );
  });

  it("carries the null scale to both sides of the enquiry, and hides the buyer's number — B7, B9", async () => {
    const firm = await makeFirm({ coverage: [{ emirate: "dubai", areaId: deira.id }] });
    const result = await sendServiceBrief(
      brief({ site: `area:${deira.id}`, engagement: "one_off_job", cadence: "", startMode: "from_date", startsOn: "2099-01-31" }),
      { buyerId },
      fakeStorage().deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const lead = await getLeadDetail(firm.id, result.enquiryId);
    expect(lead?.scale).toBeNull();
    expect(lead?.brief).toMatchObject({ engagementType: "one_off_job", cadence: null, startMode: "from_date", areaName: "Deira" });
    expect(lead?.buyer).toEqual({ released: false, firstName: "Rania" });

    const mine = await getBuyerEnquiry(buyerId, result.enquiryId);
    expect(mine?.brief?.startsOn?.toISOString().slice(0, 10)).toBe("2099-01-31");
    expect(mine?.scale).toBeNull();
  });

  it("caps at eight and records the firms at their monthly cap, never delivering to them — D4", async () => {
    const site = { emirate: "sharjah" as const, areaId: null };
    const free = await prisma.plan.findFirst({ where: { enquiriesPerMonth: { not: null } }, select: { id: true, enquiriesPerMonth: true } });
    const firms = await Promise.all(Array.from({ length: 9 }, () => makeFirm({ coverage: [site] })));
    const capped = free ? await makeFirm({ coverage: [site], plan: free.id }) : null;
    if (capped && free?.enquiriesPerMonth) {
      // Fill the month with recipient rows on a throwaway enquiry.
      for (let i = 0; i < free.enquiriesPerMonth; i += 1) {
        await prisma.enquiry.create({
          data: {
            ref: `ENQ-${PREFIX}${stamp()}`,
            buyerId,
            requirement: `${PREFIX}filler`,
            closesAt: new Date(Date.now() + 86_400_000),
            recipients: { create: { businessId: capped.id } },
          },
        });
      }
    }

    const result = await sendServiceBrief(brief({ site: "emirate:sharjah", cadence: "" }), { buyerId }, fakeStorage().deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const written = await prisma.enquiry.findUniqueOrThrow({
      where: { id: result.enquiryId },
      select: { recipients: { select: { businessId: true } }, missedBy: { select: { businessId: true, reason: true } } },
    });
    expect(written.recipients).toHaveLength(8);
    if (capped) {
      expect(written.recipients.map((r) => r.businessId)).not.toContain(capped.id);
      expect(written.missedBy).toContainEqual({ businessId: capped.id, reason: "at_monthly_cap" });
    }
    expect(firms.length).toBe(9);
  });

  it("writes nothing — no enquiry, no identity — when nobody can take it", async () => {
    const before = await prisma.enquiry.count({ where: { requirement: { startsWith: PREFIX } } });
    const phone = `05${Date.now().toString().slice(-8)}`;
    const result = await sendServiceBrief(
      brief({ site: "emirate:fujairah", cadence: "", contactPhone: phone, contactName: "Nobody" }),
      { buyerId: null },
      fakeStorage().deps,
    );
    expect(result).toEqual({ ok: false, error: "no_recipients" });
    expect(await prisma.enquiry.count({ where: { requirement: { startsWith: PREFIX } } })).toBe(before);
    expect(await prisma.user.findFirst({ where: { phone: `+971${phone.slice(1)}` } })).toBeNull();
  });

  it("refuses an answer the composer never offers, and a brief against a goods trade", async () => {
    await makeFirm();
    const refused = await sendServiceBrief(brief({ engagement: "one_off_job", cadence: "monthly" }), { buyerId }, fakeStorage().deps);
    expect(refused).toEqual({ ok: false, refusals: [{ field: "cadence", reason: "not_ongoing" }] });

    const goods = await sendServiceBrief(brief({ categoryId: goodsId }), { buyerId }, fakeStorage().deps);
    expect(goods).toEqual({ ok: false, error: "not_found" });
  });

  it("sends a named firm's brief to that firm alone, on the service it came from", async () => {
    const named = await makeFirm({ coverage: [{ emirate: "abu_dhabi", areaId: null }], services: [{ engagementType: "call_off" }] });
    await makeFirm({ coverage: [{ emirate: "dubai", areaId: null }] });

    const result = await sendServiceBrief(
      brief({ site: "emirate:dubai", pinned: named.slug, service: "service-0", cadence: "" }),
      { buyerId },
      fakeStorage().deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const written = await prisma.enquiry.findUniqueOrThrow({
      where: { id: result.enquiryId },
      select: { recipients: { select: { businessId: true } }, lines: { select: { description: true, serviceId: true } } },
    });
    expect(written.recipients).toEqual([{ businessId: named.id }]);
    expect(written.lines[0]?.description).toBe("Service 0");
    expect(written.lines[0]?.serviceId).not.toBeNull();
  });

  it("signs every file under the brief once it exists, and confirms up to five — B8", async () => {
    await makeFirm({ coverage: [{ emirate: "dubai", areaId: null }] });
    const { deps, calls } = fakeStorage({ bytes: 20_000, mimeType: "application/pdf" });
    const files = Array.from({ length: MAX_BRIEF_ATTACHMENTS }, (_, i) => ({
      filename: `Drawing ${i}.pdf`,
      type: "application/pdf",
      bytes: 20_000,
    }));
    const result = await sendServiceBrief(brief({ attachments: files }), { buyerId }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.uploads).toHaveLength(MAX_BRIEF_ATTACHMENTS);
    expect(calls.signed.every((path) => path.startsWith(`enquiries/${result.enquiryId}/`))).toBe(true);

    for (const upload of result.uploads) {
      const confirmed = await confirmEnquiryAttachment(
        { enquiryId: result.enquiryId, path: upload.path, filename: upload.filename, claimToken: null },
        { actorId: buyerId },
        deps,
      );
      expect(confirmed.ok).toBe(true);
    }
    const sixth = await confirmEnquiryAttachment(
      { enquiryId: result.enquiryId, path: `enquiries/${result.enquiryId}/extra-abc.pdf`, filename: "extra.pdf", claimToken: null },
      { actorId: buyerId },
      deps,
    );
    expect(sixth).toEqual({ ok: false, reason: "full" });

    // Every recipient reads the same set.
    const recipients = await prisma.enquiryRecipient.findMany({ where: { enquiryId: result.enquiryId }, select: { businessId: true } });
    for (const { businessId } of recipients) {
      expect((await getLeadDetail(businessId, result.enquiryId))?.attachments).toHaveLength(MAX_BRIEF_ATTACHMENTS);
    }
  });
});

describe("previewBrief — the rail and the send read one match", () => {
  it("counts what the send writes, and offers the emirate only when an area found nobody", async () => {
    const site = { emirate: "abu_dhabi" as const, areaId: null };
    await makeFirm({ coverage: [site] });

    const preview = await previewBrief({ categoryId: neighbourId, site, scope: "area", engagement: null });
    expect(preview.count).toBe(0);
    expect(preview.emirateCount).toBeNull();

    const mussafah = await prisma.area.findFirstOrThrow({ where: { slug: "mussafah-m17" }, select: { id: true } });
    const firm = await makeFirm({ primary: neighbourId, coverage: [{ emirate: "abu_dhabi", areaId: mussafah.id }] });
    const atAlAin = await prisma.area.findFirstOrThrow({ where: { slug: "al-ain" }, select: { id: true } });
    const widen = await previewBrief({ categoryId: neighbourId, site: { emirate: "abu_dhabi", areaId: atAlAin.id }, scope: "area", engagement: null });
    expect(widen).toEqual({ count: 0, names: [], emirateCount: 1 });

    const widened = await previewBrief({ categoryId: neighbourId, site: { emirate: "abu_dhabi", areaId: atAlAin.id }, scope: "emirate", engagement: null });
    expect(widened.names).toEqual([firm.displayName]);
  });
});

describe("briefFirstReplyMedianMs — measured, or not said", () => {
  it("is null under the floor and the median of first replies above it", async () => {
    const firm = await makeFirm({ coverage: [{ emirate: "dubai", areaId: null }] });
    const baseline = await briefFirstReplyMedianMs();
    const hour = 3_600_000;
    for (const replyAfter of [hour, 2 * hour, 3 * hour, 4 * hour, 5 * hour]) {
      const created = new Date(Date.now() - 10 * hour);
      await prisma.enquiry.create({
        data: {
          ref: `ENQ-${PREFIX}${stamp()}`,
          buyerId,
          requirement: `${PREFIX}measured`,
          createdAt: created,
          closesAt: new Date(Date.now() + 86_400_000),
          serviceBrief: { create: { categoryId: tradeId, engagementType: "one_off_job", startMode: "asap" } },
          recipients: { create: { businessId: firm.id, createdAt: created, firstReplyAt: new Date(created.getTime() + replyAfter) } },
        },
      });
    }
    const median = await briefFirstReplyMedianMs();
    expect(median).not.toBeNull();
    // Five briefs a test added; the seed has none. With nothing else measured the
    // median is exactly the third.
    if (baseline === null) expect(median).toBe(3 * hour);
  });
});

describe("reviseRequirement — adding detail after send", () => {
  it("keeps a brief verbatim, clears a scale on an empty answer, and refuses a revision that changes nothing", async () => {
    await makeFirm({ coverage: [{ emirate: "dubai", areaId: null }] });
    const sent = await sendServiceBrief(brief({ scale: "12 floors" }), { buyerId }, fakeStorage().deps);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const current = await prisma.enquiry.findUniqueOrThrow({ where: { id: sent.enquiryId }, select: { requirement: true } });

    expect(await reviseRequirement({ buyerId, ref: sent.ref, requirement: current.requirement, scale: "12 floors" })).toEqual({
      ok: false,
      error: "unchanged",
    });

    const more = `${current.requirement}\n  3. Access out of hours only. `;
    const revised = await reviseRequirement({ buyerId, ref: sent.enquiryId, requirement: more, scale: "" });
    expect(revised).toMatchObject({ ok: true, revision: 2 });
    const after = await prisma.enquiry.findUniqueOrThrow({ where: { id: sent.enquiryId }, select: { requirement: true, scale: true } });
    expect(after).toEqual({ requirement: more, scale: null });
  });
});
