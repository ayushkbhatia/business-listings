import { describe, expect, it } from "vitest";

import { fetchedAt } from "@/app/(admin)/admin/queue/credential/view";

/**
 * Board 4c-s — when a register read was taken, as the review screen says it.
 *
 * `fetchedAt` has two renderings and the boundary between them is a Dubai day,
 * not an elapsed duration: a read half an hour old is the clock alone at 09:14
 * and a date and clock at 00:10, because the second one was taken yesterday.
 * `tests/e2e/admin-credential-review.spec.ts` reads the unavailable notice, and
 * its seed stamps that read from the wall clock, so a shard that seeds between
 * 00:00 and 00:30 Dubai gets the second rendering — which is what failed twice
 * on 2026-09-15. The spec's regex accepts both; these pin what "both" is, so a
 * change to either shape fails here rather than in one CI shard at midnight.
 */
describe("fetchedAt", () => {
  // 00:10 on 16 Sep in Dubai, which is 20:10 on 15 Sep in UTC.
  const now = new Date("2026-09-15T20:10:00.000Z");

  it("gives the clock alone for a read taken today in Dubai", () => {
    expect(fetchedAt("2026-09-15T20:05:00.000Z", now)).toBe("00:05");
  });

  it("gives the date and the clock for a read taken on the Dubai day before", () => {
    // Thirty minutes earlier by the clock, and a day earlier in Dubai.
    expect(fetchedAt("2026-09-15T19:40:00.000Z", now)).toBe("15 Sep 2026, 23:40");
  });

  it("renders in one of the two shapes the e2e notice allows", () => {
    const shape = /^(?:\d{1,2} \w{3} \d{4}, )?\d{2}:\d{2}$/;
    expect(fetchedAt("2026-09-15T20:05:00.000Z", now)).toMatch(shape);
    expect(fetchedAt("2026-09-15T19:40:00.000Z", now)).toMatch(shape);
    // A read months back is still one of the two.
    expect(fetchedAt("2026-01-02T00:05:00.000Z", now)).toMatch(shape);
  });
});
