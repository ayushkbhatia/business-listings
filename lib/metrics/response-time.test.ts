import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLE,
  WINDOW_DAYS,
  band,
  latencies,
  median,
  medianResponseMs,
  windowStart,
} from "./response-time";

const HOUR = 3_600_000;
const at = (hoursFromEpoch: number) => new Date(hoursFromEpoch * HOUR);

/** Delivered at hour 0, replied `hours` later. */
const reply = (hours: number | null) => ({
  deliveredAt: at(0),
  firstReplyAt: hours === null ? null : at(hours),
});

describe("latencies", () => {
  it("measures from delivery to first reply", () => {
    expect(latencies([reply(2), reply(5)])).toEqual([2 * HOUR, 5 * HOUR]);
  });

  it("leaves out an enquiry nobody answered, rather than counting it as infinity", () => {
    /*
     * "They did not answer" is a different fact from "they answered slowly".
     * Folding it in would let one ignored enquiry swamp a median that is meant
     * to describe the replies a buyer will actually get.
     */
    expect(latencies([reply(2), reply(null), reply(4)])).toEqual([2 * HOUR, 4 * HOUR]);
  });

  it("ignores a reply stamped before delivery, which is a clock problem", () => {
    expect(latencies([{ deliveredAt: at(5), firstReplyAt: at(3) }])).toEqual([]);
  });

  it("counts an instant reply as zero rather than dropping it", () => {
    expect(latencies([{ deliveredAt: at(1), firstReplyAt: at(1) }])).toEqual([0]);
  });
});

describe("median", () => {
  it("is the middle of an odd count", () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it("is the mean of the two middles on an even count", () => {
    expect(median([1, 3, 5, 9])).toBe(4);
  });

  it("is null for nothing", () => {
    expect(median([])).toBeNull();
  });

  it("is not dragged by one outlier, which is the reason it is a median", () => {
    // Four replies inside two hours and one over Eid. A mean would read red.
    const values = [HOUR, HOUR, 2 * HOUR, 2 * HOUR, 400 * HOUR];
    expect(median(values)).toBe(2 * HOUR);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(80 * HOUR);
  });
});

describe("medianResponseMs", () => {
  it("needs a sample before it says anything", () => {
    // Two enquiries is a coin toss, and showing it invites a new supplier to
    // game it by answering their first in ninety seconds.
    expect(medianResponseMs([reply(1), reply(1)])).toBeNull();
    expect(MIN_SAMPLE).toBe(3);
  });

  it("reports once there is enough", () => {
    expect(medianResponseMs([reply(1), reply(3), reply(2)])).toBe(2 * HOUR);
  });

  it("counts replies, not enquiries, towards the sample", () => {
    // Three enquiries but only two answered is not a measurable supplier.
    expect(medianResponseMs([reply(1), reply(2), reply(null)])).toBeNull();
  });
});

describe("band", () => {
  it("is green under two hours, amber under six, red beyond", () => {
    expect(band(90 * 60_000)).toBe("fast");
    expect(band(2 * HOUR)).toBe("moderate");
    expect(band(5 * HOUR)).toBe("moderate");
    expect(band(6 * HOUR)).toBe("slow");
    expect(band(40 * HOUR)).toBe("slow");
  });

  it("says unmeasured rather than guessing", () => {
    expect(band(null)).toBe("unmeasured");
  });
});

describe("the window", () => {
  it("reaches back ninety days", () => {
    const now = new Date("2026-08-24T12:00:00Z");
    const start = windowStart(now);
    expect((now.getTime() - start.getTime()) / 86_400_000).toBe(WINDOW_DAYS);
  });

  it("means a supplier who was fast last year and slow since reads slow", () => {
    const now = new Date("2026-08-24T12:00:00Z");
    expect(windowStart(now).getTime()).toBeGreaterThan(new Date("2026-01-01T00:00:00Z").getTime());
  });
});
