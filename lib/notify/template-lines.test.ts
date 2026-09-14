import { describe, expect, it } from "vitest";
import {
  headOf,
  liveOf,
  nextVersion,
  owesTwin,
  pendingOf,
  pickLive,
  primaryKind,
  primaryState,
  twinState,
  type VersionRow,
} from "./template-lines";

/**
 * Board 12g `B4` and `B5`, as rules over rows. The console's two columns and
 * the carrier's choice of body are all answered here, so these are the cases
 * the three have to agree on.
 */

let n = 0;
const row = (over: Partial<VersionRow>): VersionRow => ({ id: `r${++n}`, kind: "goods", version: 1, status: "live", ...over });

describe("the live version", () => {
  it("is the highest live version, not the newest row — v3 sends while v4 waits (B4)", () => {
    const rows = [row({ version: 3, status: "live" }), row({ version: 4, status: "pending_meta" })];
    expect(liveOf(rows, "primary")?.version).toBe(3);
    expect(pendingOf(rows, "primary")?.version).toBe(4);
    expect(headOf(rows, "primary")?.version).toBe(4);
  });

  it("counts versions within a line, so a twin's first version is v1", () => {
    const rows = [row({ version: 6 }), row({ kind: "services", version: 1, status: "pending_meta" })];
    expect(nextVersion(rows, "primary")).toBe(7);
    expect(nextVersion(rows, "services")).toBe(2);
    expect(nextVersion([], "services")).toBe(1);
  });

  it("treats goods and neutral as one line, whichever a version was saved as", () => {
    const rows = [row({ version: 1, kind: "goods", status: "retired" }), row({ version: 2, kind: "neutral" })];
    expect(liveOf(rows, "primary")?.version).toBe(2);
    expect(primaryKind(rows)).toBe("neutral");
  });
});

describe("SERVICES TWIN — no trade-kind language and not written are different states (B5)", () => {
  it("reads a neutral body as owing nothing", () => {
    const state = twinState([row({ kind: "neutral" })]);
    expect(state).toBe("neutral");
    expect(owesTwin(state)).toBe(false);
  });

  it("reads a goods body with no services row as not written", () => {
    const state = twinState([row({})]);
    expect(state).toBe("not_written");
    expect(owesTwin(state)).toBe(true);
  });

  it("reads a live twin as written, and a twin with Meta as in review", () => {
    expect(twinState([row({}), row({ kind: "services" })])).toBe("written");
    expect(twinState([row({}), row({ kind: "services", status: "pending_meta" })])).toBe("in_review");
  });

  it("reads a rejected twin as rejected until something newer is saved", () => {
    expect(twinState([row({}), row({ kind: "services", status: "rejected" })])).toBe("rejected");
  });

  it("reads a twin whose versions were all retired as not written — it sends nothing", () => {
    expect(twinState([row({}), row({ kind: "services", status: "retired" })])).toBe("not_written");
  });

  it("decides the body's kind from the live version, not a newer draft", () => {
    const rows = [row({ version: 1, kind: "goods" }), row({ version: 2, kind: "neutral", status: "pending_meta" })];
    expect(primaryKind(rows)).toBe("goods");
  });
});

describe("STATE", () => {
  it("is live while anything sends, whatever is newer", () => {
    expect(primaryState([row({ version: 1 }), row({ version: 2, status: "rejected" })])).toBe("live");
  });

  it("names each way of sending nothing", () => {
    expect(primaryState([row({ status: "pending_meta" })])).toBe("in_review");
    expect(primaryState([row({ status: "rejected" })])).toBe("rejected");
    expect(primaryState([row({ status: "draft" })])).toBe("draft");
    expect(primaryState([row({ status: "retired" })])).toBe("retired");
    expect(primaryState([])).toBe("missing");
  });
});

describe("which body a message uses", () => {
  const goods = row({ id: "goods", version: 3 });
  const twin = row({ id: "twin", kind: "services", version: 1 });

  it("gives a services brief the live twin", () => {
    expect(pickLive([goods, twin], "services")).toEqual({ row: twin, fellBack: false });
  });

  it("gives a services brief the goods body when no twin is live, and says it fell back", () => {
    expect(pickLive([goods, row({ kind: "services", status: "pending_meta" })], "services")).toEqual({ row: goods, fellBack: true });
  });

  it("never gives a goods enquiry the twin", () => {
    expect(pickLive([goods, twin], "goods")?.row.id).toBe("goods");
    expect(pickLive([goods, twin], null)?.row.id).toBe("goods");
  });

  it("does not count a neutral body as a fallback — it was never goods wording", () => {
    const neutral = row({ id: "neutral", kind: "neutral" });
    expect(pickLive([neutral], "services")).toEqual({ row: neutral, fellBack: false });
  });

  it("sends nothing when nothing is live", () => {
    expect(pickLive([row({ status: "pending_meta" })], "goods")).toBeNull();
  });
});
