import { describe, expect, it } from "vitest";
import { hrefFor, presentBoard, presentDetail, readFilters } from "@/app/(admin)/admin/notifications/present";
import type { TemplateBoard, TemplateDetail, TemplateRow, VersionView } from "@/lib/notify/templates";

/**
 * Board 12g — the screen's numbers against the rows under them.
 *
 * *"If a header, a note or a section title states a count, count the
 * elements."* The board this replaces printed `4,182` as a send count because it
 * was the string total pasted twice. So every figure here is asserted against
 * the rows it claims to count.
 */

const NOW = new Date("2026-09-14T08:00:00Z");

const row = (over: Partial<TemplateRow>): TemplateRow => ({
  event: "enquiry_received",
  channel: "whatsapp",
  audience: "seller",
  firedBy: ["1h", "1h-s"],
  emitted: true,
  state: "live",
  twin: "not_written",
  liveVersion: 3,
  pendingVersion: 4,
  volume: { sent: 0, suppressed: 0, failed: 0, servicesInGoodsWording: 0 },
  ...over,
});

const ROWS: TemplateRow[] = [
  row({ volume: { sent: 3_908, suppressed: 41, failed: 2, servicesInGoodsWording: 118 } }),
  row({ event: "quote_received", channel: "in_app", audience: "buyer", firedBy: ["3k", "3j-s"], volume: { sent: 2_714, suppressed: 0, failed: 0, servicesInGoodsWording: 0 } }),
  row({ event: "document_expiring", channel: "email", firedBy: ["3e"], twin: "neutral", volume: { sent: 418, suppressed: 3, failed: 0, servicesInGoodsWording: 0 } }),
  row({ event: "weekly_digest", channel: "email", firedBy: [], emitted: false }),
  row({ event: "ramadan_dates_moved", channel: "email", firedBy: ["3d"], twin: "no_body", state: "missing", liveVersion: null, pendingVersion: null, volume: { sent: 0, suppressed: 12, failed: 0, servicesInGoodsWording: 0 } }),
];

const board = (rows: TemplateRow[]): TemplateBoard => ({
  rows,
  since: new Date(NOW.getTime() - 30 * 86_400_000),
  counts: {
    templates: rows.length,
    byChannel: {
      whatsapp: rows.filter((r) => r.channel === "whatsapp").length,
      email: rows.filter((r) => r.channel === "email").length,
      sms: rows.filter((r) => r.channel === "sms").length,
      in_app: rows.filter((r) => r.channel === "in_app").length,
    },
    owesTwin: rows.filter((r) => r.twin !== "neutral" && r.twin !== "written" && r.twin !== "no_body").length,
    neutral: rows.filter((r) => r.twin === "neutral").length,
    twinsLive: rows.filter((r) => r.twin === "written").length,
    missing: rows.filter((r) => r.state === "missing").length,
  },
});

describe("the list", () => {
  const filters = readFilters({});
  const view = presentBoard(board(ROWS), filters, ROWS);

  it("puts the same count on the All chip, the header and the footnote as there are rows", () => {
    expect(view.chips[0]).toMatchObject({ count: "5", selected: true });
    expect(view.meta).toContain("5 templates");
    expect(view.footnote).toContain("All 5 shown");
    expect(view.rows).toHaveLength(5);
  });

  it("sums the channel chips to the All chip", () => {
    const sum = view.chips.slice(1).reduce((total, chip) => total + Number(chip.count), 0);
    expect(sum).toBe(5);
  });

  it("counts twins owed and neutral bodies from the rows, and states both", () => {
    expect(view.footnote).toContain("No template has a services twin. 3 carry trade-kind language and still need one; 1 does not.");
  });

  it("reads no trade-kind language and not written differently (B5)", () => {
    expect(view.rows.find((r) => r.event === "document_expiring")).toMatchObject({ twin: "No trade-kind language", twinChip: false });
    expect(view.rows.find((r) => r.event === "enquiry_received")).toMatchObject({ twin: "Not written", twinChip: true });
  });

  it("shows suppressed and failed beside sent, so volume does not imply reach", () => {
    expect(view.rows[0]).toMatchObject({ sent: "3,908", notSent: "41 suppressed · 2 failed" });
  });

  it("says when nothing sends an event, and lists an event that fired with no template", () => {
    expect(view.rows.find((r) => r.event === "weekly_digest")?.firedBy).toBe("Nothing sends this");
    expect(view.rows.find((r) => r.event === "ramadan_dates_moved")).toMatchObject({ state: "No template", stateTone: "bad" });
    expect(view.footnote).toContain("1 fired in the last 30 days with no template to send, and is listed as No template.");
  });

  it("filters by channel and says how many of how many", () => {
    const email = presentBoard(board(ROWS), readFilters({ channel: "email" }), ROWS);
    expect(email.rows.map((r) => r.event)).toEqual(["document_expiring", "weekly_digest", "ramadan_dates_moved"]);
    expect(email.footnote).toContain("3 of 5 shown");
  });

  it("keeps the open template and the order in every link", () => {
    const f = readFilters({ sort: "twin", t: "quote_received.in_app", line: "services" });
    expect(hrefFor(f, { channel: "email" })).toBe("/admin/notifications?channel=email&sort=twin&t=quote_received.in_app&line=services");
    expect(readFilters({ t: "not a key", channel: "fax" })).toMatchObject({ open: null, channel: "all" });
  });
});

const version = (over: Partial<VersionView>): VersionView => ({
  id: `v${over.version ?? 1}-${over.kind ?? "goods"}`,
  kind: "goods",
  line: "primary",
  version: 1,
  status: "live",
  subject: null,
  body: "New enquiry {ref} for {summary}. {lineCount} lines.",
  actionLabel: "Open and quote",
  actionPath: "/dashboard/leads/{enquiryId}",
  metaTemplateName: "bl_enquiry_received_v1",
  metaNote: null,
  submittedAt: null,
  decidedAt: null,
  createdAt: new Date("2026-09-01T08:00:00Z"),
  createdBy: null,
  ...over,
});

function detail(over: Partial<TemplateDetail>): TemplateDetail {
  const live = version({ version: 3 });
  const pending = version({ version: 4, status: "pending_meta", submittedAt: new Date("2026-09-12T08:00:00Z") });
  return {
    event: "enquiry_received",
    channel: "whatsapp",
    audience: "seller",
    firedBy: ["1h"],
    emitted: true,
    variables: ["ref", "summary", "neededBy", "closesAt", "area", "lineCount", "enquiryId", "shortLink"],
    line: "primary",
    primaryKind: "goods",
    twin: "not_written",
    live,
    pending,
    rejected: null,
    head: pending,
    seed: pending,
    nextVersion: 5,
    versions: [pending, live],
    primaryLive: null,
    origin: "https://businesslistings.me",
    ...over,
  };
}

describe("one template", () => {
  const filters = readFilters({ t: "enquiry_received.whatsapp" });

  it("shows the live version and the pending one at once (B4)", () => {
    const view = presentDetail(detail({}), filters, NOW, 0);
    expect(view.versionsMeta).toBe("v3 live · v4 with Meta");
    expect(view.meta?.body[0]).toContain("v3 keeps sending until v4 is approved");
    expect(view.meta?.body[0]).toContain("2 d ago");
    expect(view.saveLabel).toBe("Send v5 to Meta");
    expect(view.pendingId).toBe("v4-goods");
  });

  it("puts Meta's reason against a rejected version while the live one carries on", () => {
    const rejected = version({ version: 4, status: "rejected", metaNote: "Promotional wording in a utility template" });
    const view = presentDetail(detail({ pending: null, rejected, head: rejected, versions: [rejected, version({ version: 3 })] }), filters, NOW, 0);
    expect(view.meta).toMatchObject({ tone: "bad" });
    expect(view.meta?.body).toEqual(["v4 was rejected: Promotional wording in a utility template", "v3 is untouched and keeps sending."]);
  });

  it("measures the cost of the missing twin rather than asserting it", () => {
    expect(presentDetail(detail({}), filters, NOW, 118).twinPanel?.body[1]).toBe(
      "118 messages about services briefs went out in this wording in the last 30 days.",
    );
    expect(presentDetail(detail({}), filters, NOW, 0).twinPanel?.body[1]).toContain("No message about a services brief");
  });

  it("offers no twin panel and no line tabs on a neutral body", () => {
    const view = presentDetail(detail({ primaryKind: "neutral", twin: "neutral" }), filters, NOW, 0);
    expect(view.twinPanel).toBeNull();
    expect(view.lineTabs).toBeNull();
  });

  it("tests only the live WhatsApp version, and says why when there is none", () => {
    expect(presentDetail(detail({}), filters, NOW, 0).testable).toEqual({ id: "v3-goods", label: "Send test of v3 to me" });
    const none = presentDetail(detail({ live: null, versions: [version({ version: 4, status: "pending_meta" })] }), filters, NOW, 0);
    expect(none.testable).toBeNull();
    expect(none.testBlocked).toContain("Meta has approved");
  });

  it("names the platform floor on licence expiry, and the buyer default on a buyer event (B7)", () => {
    const expiring = presentDetail(detail({ event: "document_expiring", channel: "email" }), filters, NOW, 0);
    expect(expiring.optOut.body[1]).toContain("email and in-app");
    const buyer = presentDetail(detail({ event: "quote_received", channel: "in_app", audience: "buyer" }), filters, NOW, 0);
    expect(buyer.optOut.body[0]).toContain("WhatsApp and in-app");
    expect(buyer.optOut.body[0]).toContain("21:00 and 07:00");
  });

  it("marks which declared variables the body uses", () => {
    const view = presentDetail(detail({}), filters, NOW, 0);
    expect(view.variables.filter((v) => v.used).map((v) => v.name)).toEqual(["ref", "summary", "lineCount", "enquiryId"]);
    expect(view.variablesLabel).toBe("Variables · 8");
  });
});
