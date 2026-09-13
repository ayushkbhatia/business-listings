import { describe, expect, it } from "vitest";
import { ENGAGEMENT_TYPES } from "@/lib/services/scope-sheet";
import {
  BRIEF_ENGAGEMENTS,
  BRIEF_MAX_RECIPIENTS,
  MAX_BRIEF_ATTACHMENTS,
  briefSubjectLine,
  checkServiceBrief,
  matchState,
  parseSiteValue,
  reachesSite,
  selectBriefRecipients,
  siteLabel,
  siteValue,
  type BriefCandidate,
  type BriefDraft,
} from "./service-brief";

/** Board `1h-s` — the brief's rules, without a database. */

const TODAY = "2026-09-13";
const AREAS = new Map([
  ["area-bb", "dubai"],
  ["area-aq", "dubai"],
  ["area-mu", "abu_dhabi"],
]);
const context = { today: TODAY, areaEmirate: (id: string) => (AREAS.get(id) as never) ?? null };

const draft = (patch: Partial<BriefDraft> = {}): BriefDraft => ({
  site: "area:area-bb",
  building: "",
  description: "Quarterly PPM on chillers, AHUs and pumps across two towers.",
  engagement: "ongoing_contract",
  cadence: "quarterly",
  startMode: "from_date",
  startsOn: "2026-11-01",
  scale: "",
  attachments: [],
  contactPhone: null,
  ...patch,
});

describe("the five questions — B1, B3", () => {
  it("offers the seller's engagement enum exactly, all three of it", () => {
    expect(BRIEF_ENGAGEMENTS).toEqual(ENGAGEMENT_TYPES);
    expect(BRIEF_ENGAGEMENTS).toEqual(["ongoing_contract", "one_off_job", "call_off"]);
  });

  it("asks no quantity: a clean brief carries none", () => {
    const checked = checkServiceBrief(draft(), context);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(Object.keys(checked.value)).not.toContain("qty");
    expect(Object.keys(checked.value)).not.toContain("targetUnitPriceAed");
  });
});

describe("the description — B2", () => {
  it("is kept byte for byte, whitespace and all", () => {
    const typed = "  1. Chillers\n\n  2. AHUs — quarterly\t\n";
    const checked = checkServiceBrief(draft({ description: typed }), context);
    expect(checked.ok && checked.value.description).toBe(typed);
  });

  it("is measured on what a reader would count", () => {
    const checked = checkServiceBrief(draft({ description: "   PPM      " }), context);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.refusals).toContainEqual({ field: "description", reason: "too_short", min: 10 });
  });
});

describe("cadence — B4", () => {
  it("belongs to an ongoing contract, and is optional there", () => {
    expect(checkServiceBrief(draft({ cadence: "" }), context).ok).toBe(true);
    const oneOff = checkServiceBrief(draft({ engagement: "one_off_job", cadence: "monthly" }), context);
    expect(oneOff.ok).toBe(false);
    if (oneOff.ok) return;
    expect(oneOff.refusals).toEqual([{ field: "cadence", reason: "not_ongoing" }]);
  });

  it("refuses an engagement nobody offered", () => {
    const checked = checkServiceBrief(draft({ engagement: "retainer", cadence: "" }), context);
    expect(checked.ok || checked.refusals).toEqual([{ field: "engagement", reason: "missing" }]);
  });
});

describe("the start", () => {
  it("is a date from today, or as soon as possible — never neither", () => {
    expect(checkServiceBrief(draft({ startMode: "asap", startsOn: "2026-11-01" }), context)).toMatchObject({
      ok: true,
      value: { startMode: "asap", startsOn: null },
    });
    expect(checkServiceBrief(draft({ startsOn: TODAY }), context).ok).toBe(true);
    for (const [patch, reason] of [
      [{ startMode: "" }, "missing"],
      [{ startsOn: "" }, "missing"],
      [{ startsOn: "2026-09-12" }, "past"],
      [{ startsOn: "01/11/2026" }, "invalid"],
    ] as const) {
      const checked = checkServiceBrief(draft(patch), context);
      expect(checked.ok || checked.refusals).toEqual([{ field: "start", reason }]);
    }
  });
});

describe("scale — B6, B7", () => {
  it("is one optional line, never parsed, null when empty", () => {
    expect(checkServiceBrief(draft({ scale: "   " }), context)).toMatchObject({ ok: true, value: { scale: null } });
    expect(
      checkServiceBrief(draft({ scale: " 12 floors,  3 chillers, about 40,000 sq ft " }), context),
    ).toMatchObject({ ok: true, value: { scale: "12 floors, 3 chillers, about 40,000 sq ft" } });
    const long = checkServiceBrief(draft({ scale: "x".repeat(121) }), context);
    expect(long.ok || long.refusals).toEqual([{ field: "scale", reason: "too_long", max: 120 }]);
  });
});

describe("files — B8", () => {
  it("allows a set, from the bucket's own types, and says when it is too many", () => {
    const pdf = { type: "application/pdf", bytes: 400_000 };
    expect(checkServiceBrief(draft({ attachments: [pdf, pdf] }), context).ok).toBe(true);
    const many = checkServiceBrief(draft({ attachments: Array(MAX_BRIEF_ATTACHMENTS + 1).fill(pdf) }), context);
    expect(many.ok || many.refusals).toEqual([{ field: "attachments", reason: "too_many", max: MAX_BRIEF_ATTACHMENTS }]);
    const sheet = checkServiceBrief(
      draft({ attachments: [{ type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: 1 }] }),
      context,
    );
    expect(sheet.ok || sheet.refusals).toEqual([{ field: "attachments", reason: "type" }]);
  });
});

describe("the site", () => {
  it("round-trips through the one select, and refuses a place the taxonomy does not hold", () => {
    expect(parseSiteValue("area:area-bb", context.areaEmirate)).toEqual({ emirate: "dubai", areaId: "area-bb" });
    expect(parseSiteValue("emirate:fujairah", context.areaEmirate)).toEqual({ emirate: "fujairah", areaId: null });
    expect(parseSiteValue("area:area-gone", context.areaEmirate)).toBeNull();
    expect(parseSiteValue("emirate:oman", context.areaEmirate)).toBeNull();
    expect(siteValue({ emirate: "dubai", areaId: null })).toBe("emirate:dubai");
    const missing = checkServiceBrief(draft({ site: "" }), context);
    expect(missing.ok || missing.refusals).toEqual([{ field: "site", reason: "missing" }]);
  });

  it("is worded for a notification", () => {
    expect(siteLabel({ emirate: "dubai", areaId: "area-bb" }, "Business Bay")).toBe("Business Bay, Dubai");
    expect(siteLabel({ emirate: "abu_dhabi", areaId: null }, null)).toBe("Abu Dhabi");
  });
});

describe("coverage — B5, the union reaching the site", () => {
  const dubai = { emirate: "dubai" as const, areaId: null };
  const alQuoz = { emirate: "dubai" as const, areaId: "area-aq" };
  const businessBay = { emirate: "dubai" as const, areaId: "area-bb" };

  it("reaches an area by that area or its whole emirate, never a neighbour", () => {
    expect(reachesSite([dubai], businessBay, "area")).toBe(true);
    expect(reachesSite([businessBay], businessBay, "area")).toBe(true);
    expect(reachesSite([alQuoz], businessBay, "area")).toBe(false);
  });

  it("reaches an emirate-wide brief, or a widened one, by any claim inside it", () => {
    expect(reachesSite([alQuoz], { emirate: "dubai", areaId: null }, "area")).toBe(true);
    expect(reachesSite([alQuoz], businessBay, "emirate")).toBe(true);
    expect(reachesSite([{ emirate: "sharjah", areaId: null }], businessBay, "emirate")).toBe(false);
  });
});

describe("the cap and the ranking", () => {
  const firm = (id: string, patch: Partial<BriefCandidate> = {}): BriefCandidate => ({
    businessId: id,
    slug: id,
    displayName: id,
    exactTrade: true,
    offersEngagement: false,
    responseTimeMedianMs: null,
    enquiriesPerMonth: null,
    enquiriesThisMonth: 0,
    ...patch,
  });

  it("skips a firm at its monthly cap and records it, never shows it (D4)", () => {
    const result = selectBriefRecipients([firm("a"), firm("b", { enquiriesPerMonth: 3, enquiriesThisMonth: 3 })]);
    expect(result.recipients.map((r) => r.businessId)).toEqual(["a"]);
    expect(result.skipped).toEqual([{ businessId: "b", reason: "at_monthly_cap" }]);
  });

  it("takes no more than the cap, and states the match below it", () => {
    const many = Array.from({ length: 12 }, (_, i) => firm(`f${String(i).padStart(2, "0")}`));
    expect(selectBriefRecipients(many).recipients).toHaveLength(BRIEF_MAX_RECIPIENTS);
    expect(selectBriefRecipients(many.slice(0, 6)).recipients).toHaveLength(6);
  });

  it("ranks the engagement sold, then the exact trade, then measured speed, then the id", () => {
    const ranked = selectBriefRecipients([
      firm("slow-exact", { responseTimeMedianMs: 20 * 3_600_000 }),
      firm("unmeasured"),
      firm("neighbour", { exactTrade: false, responseTimeMedianMs: 60_000 }),
      firm("fast", { responseTimeMedianMs: 3_600_000 }),
      firm("sells-it", { offersEngagement: true, responseTimeMedianMs: 30 * 3_600_000 }),
    ]).recipients.map((r) => r.businessId);
    expect(ranked).toEqual(["sells-it", "fast", "unmeasured", "slow-exact", "neighbour"]);
  });
});

describe("what the rail says", () => {
  const site = { emirate: "dubai" as const, areaId: "area-bb" };

  it("names each state from the counts, and never pads", () => {
    expect(matchState({ site: null, pinned: false, scope: "area", count: 0, emirateCount: null })).toEqual({ kind: "no_site" });
    expect(matchState({ site, pinned: false, scope: "area", count: 6, emirateCount: null })).toEqual({
      kind: "matched",
      count: 6,
      thin: false,
    });
    expect(matchState({ site, pinned: false, scope: "area", count: 2, emirateCount: null })).toMatchObject({ thin: true });
    expect(matchState({ site, pinned: false, scope: "area", count: 0, emirateCount: 4 })).toEqual({
      kind: "widen",
      emirateCount: 4,
    });
    expect(matchState({ site, pinned: false, scope: "emirate", count: 0, emirateCount: 4 })).toEqual({ kind: "none" });
    expect(matchState({ site: { emirate: "dubai", areaId: null }, pinned: false, scope: "area", count: 0, emirateCount: null })).toEqual({
      kind: "none",
    });
    expect(matchState({ site: null, pinned: true, scope: "area", count: 1, emirateCount: null })).toEqual({
      kind: "pinned",
      count: 1,
    });
  });
});

describe("the subject line", () => {
  it("names the service or the trade, and is never quantified", () => {
    expect(briefSubjectLine({ name: "Hard FM & MEP maintenance" }, null)).toEqual({
      description: "Hard FM & MEP maintenance",
      qty: null,
      serviceId: null,
    });
    expect(briefSubjectLine({ name: "x" }, { id: "s1", name: "Chiller call-out" })).toEqual({
      description: "Chiller call-out",
      qty: null,
      serviceId: "s1",
    });
  });
});
