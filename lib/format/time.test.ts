import { describe, expect, it } from "vitest";
import { formatClock, formatShifts, formatTime, formatTimeRange } from "./time";

describe("formatTime", () => {
  it("is 24-hour and always zero-padded", () => {
    expect(formatTime("8:00")).toBe("08:00");
    expect(formatTime("08:00")).toBe("08:00");
    expect(formatTime("16:30")).toBe("16:30");
    expect(formatTime("00:00")).toBe("00:00");
  });

  it("never emits am or pm", () => {
    for (const t of ["08:00", "12:00", "16:30", "23:59"]) {
      expect(formatTime(t)).not.toMatch(/[ap]\.?m/i);
    }
  });

  it("keeps 24:00 distinct from 00:00 — a closing time is not a midnight", () => {
    expect(formatTime("24:00")).toBe("24:00");
    expect(formatTime(24 * 60)).toBe("24:00");
  });

  it("accepts minutes since midnight", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(8 * 60)).toBe("08:00");
    expect(formatTime(16 * 60 + 30)).toBe("16:30");
  });

  it("reads an instant in Dubai", () => {
    expect(formatTime(new Date("2026-08-14T05:30:00Z"))).toBe("09:30");
    expect(formatTime(new Date("2026-08-14T05:30:00Z"), { timeZone: "UTC" })).toBe("05:30");
  });

  it("rejects malformed input rather than guessing", () => {
    expect(() => formatTime("8")).toThrow(TypeError);
    expect(() => formatTime("8:5")).toThrow(TypeError);
    expect(() => formatTime("25:00")).toThrow(RangeError);
    expect(() => formatTime("08:70")).toThrow(RangeError);
    expect(() => formatTime(-1)).toThrow(RangeError);
  });
});

describe("formatTimeRange", () => {
  it("joins with an en dash and no spaces", () => {
    expect(formatTimeRange("08:00", "18:00")).toBe("08:00–18:00");
  });

  it("uses an en dash, never a hyphen", () => {
    expect(formatTimeRange("08:00", "18:00")).not.toContain("-");
  });
});

describe("formatShifts", () => {
  it("renders the split shift that most of Al Quoz actually works", () => {
    expect(
      formatShifts([
        { open: "08:00", close: "13:00" },
        { open: "16:00", close: "20:00" },
      ]),
    ).toBe("08:00–13:00, 16:00–20:00");
  });

  it("says closed rather than printing an empty string", () => {
    expect(formatShifts([])).toBe("closed");
  });
});

describe("formatClock", () => {
  it("renders an instant as a 24-hour clock in Dubai", () => {
    expect(formatClock(new Date("2026-08-14T05:30:00Z"))).toBe("09:30");
  });
});
