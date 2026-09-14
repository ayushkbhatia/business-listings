import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { escapeHtml, renderMaintenanceDocument } from "./document";
import { parseWindow, viewAt, type MaintenanceRecord, type MaintenanceWindow } from "./window";
import { SPECIMEN_WINDOW as DRAWN } from "./specimen";

function ok(record: MaintenanceRecord): MaintenanceWindow {
  const result = parseWindow(record);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.window;
}

function render(record: MaintenanceRecord, now: string, options = {}) {
  const html = renderMaintenanceDocument(viewAt(ok(record), new Date(now)), options);
  const doc = new DOMParser().parseFromString(html, "text/html");
  return { html, doc };
}

const DURING = "2026-09-20T02:30:00+04:00";
const OVERRUN = "2026-09-20T03:40:00+04:00";

describe("renderMaintenanceDocument", () => {
  it("reads as drawn: the end time as the headline, the work, the trust sentence, four rows", () => {
    const { doc } = render(DRAWN, DURING);
    expect(doc.querySelector("h1 [data-when=now]")?.textContent).toBe("Back at 03:00 GST");
    expect(doc.querySelector(".mw-eyebrow")?.textContent).toBe("Planned work · 503");
    expect(doc.querySelector(".mw-body")?.textContent).toBe(
      "Planned work on the search index, about 40 minutes. Enquiries already sent are safe and suppliers are still being notified — nothing you submitted is waiting on this.",
    );
    expect(doc.querySelector(".mw-retry")?.textContent).toBe("This page does not reload itself. Try again after 03:00 GST.");
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
  });

  it("is a real table with scoped heads, and states are words (B8)", () => {
    const { doc } = render(DRAWN, DURING);
    const table = doc.querySelector("table")!;
    expect(table.querySelector("caption")?.textContent).toBe("What is affected");
    expect([...table.querySelectorAll("thead th")].map((th) => th.getAttribute("scope"))).toEqual(["col", "col"]);
    const rows = [...table.querySelectorAll("tbody tr")].map((tr) => [
      tr.querySelector("th[scope=row]")?.textContent,
      tr.querySelector("td")?.textContent,
    ]);
    expect(rows).toEqual([
      ["Search and filters", "Down"],
      ["Posting a new requirement", "Down"],
      ["Quotes already in flight", "Running"],
      ["Seller notifications", "Running"],
    ]);
    for (const dot of table.querySelectorAll(".mw-dot")) expect(dot.getAttribute("aria-hidden")).toBe("true");
  });

  it("links nowhere but WhatsApp (B3)", () => {
    const { doc } = render(DRAWN, DURING);
    const hrefs = [...doc.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["https://wa.me/971501184400"]);
    expect(doc.querySelector("nav, footer, form, input")).toBeNull();
  });

  it("draws no contact card when nobody is staffing a line (B6)", () => {
    const { doc } = render({ ...DRAWN, whatsapp: undefined }, DURING);
    expect(doc.querySelector(".mw-contact")).toBeNull();
    expect(doc.querySelectorAll("a")).toHaveLength(0);
  });

  it("stops saying back at 03:00 once 03:00 has passed", () => {
    const { doc, html } = render(DRAWN, OVERRUN);
    expect(doc.querySelector("h1")?.textContent).toBe("Running past 03:00 GST");
    expect(doc.querySelector(".mw-body")?.textContent).toMatch(/^Planned work on the search index is taking longer than the 40 minutes we set aside\./);
    expect(doc.querySelector(".mw-retry")?.textContent).toBe("No new time is set yet. Try again in 5 minutes.");
    expect(html).not.toContain("Back at");
    expect(html).not.toContain("<script>");
  });

  it("carries the open-tab text and the script that swaps to it, and polls nothing (Q1)", () => {
    const { doc, html } = render(DRAWN, DURING);
    expect(doc.querySelector("h1 [data-when=passed]")?.textContent).toBe("Due back at 03:00 GST");
    expect(doc.querySelector("[data-when=passed] .mw-retry")?.textContent).toMatch(/That time has passed/);
    expect(doc.querySelector("main")?.getAttribute("data-ends-at")).toBe("2026-09-19T23:00:00.000Z");
    const script = doc.querySelector("script")?.textContent ?? "";
    expect(script).not.toMatch(/fetch|XMLHttpRequest|setInterval|http-equiv/);
    expect(html).not.toMatch(/http-equiv="refresh"/);
  });

  it("removes the trust sentence when everything is down", () => {
    const { doc } = render(
      { ...DRAWN, work: "database", affected: DRAWN.affected.map((r) => ({ ...r, state: "down" as const })) },
      DURING,
    );
    expect(doc.querySelector(".mw-body")?.textContent).toBe("Planned work on the database, about 40 minutes.");
    expect(doc.querySelector(".mw-lede")?.textContent).toBe("The whole directory is off while we work on its database.");
  });

  it("is noindex, declares its direction and can be mirrored", () => {
    expect(render(DRAWN, DURING).doc.querySelector("meta[name=robots]")?.getAttribute("content")).toBe("noindex, nofollow");
    expect(render(DRAWN, DURING).doc.documentElement.getAttribute("dir")).toBe("ltr");
    expect(render(DRAWN, DURING, { direction: "rtl" }).doc.documentElement.getAttribute("dir")).toBe("rtl");
  });

  it("escapes what it interpolates", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("maintenance.css", () => {
  const css = readFileSync(join(process.cwd(), "public/maintenance/maintenance.css"), "utf8");

  it("writes no colour — every value is a token from docs/tokens.css", () => {
    expect(css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)).toBeNull();
    const tokens = readFileSync(join(process.cwd(), "docs/tokens.css"), "utf8");
    for (const [, name] of css.matchAll(/var\((--[\w-]+)\)/g)) {
      expect(tokens, `${name} is not in docs/tokens.css`).toContain(`${name}:`);
    }
  });

  it("points only at fonts that exist", () => {
    for (const [, file] of css.matchAll(/url\("\/fonts\/([^"]+)"\)/g)) {
      expect(() => readFileSync(join(process.cwd(), "public/fonts", file!))).not.toThrow();
    }
  });

  it("assumes no direction", () => {
    expect(css).not.toMatch(/\b(margin|padding)-(left|right)\b|text-align:\s*(left|right)|\bleft:|\bright:/);
  });
});
