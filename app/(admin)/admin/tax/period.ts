/**
 * Quarters, as a string the URL can carry.
 *
 * `2026-q1`. Not a pair of dates: a VAT return is filed for a quarter, and a
 * date range control invites a return filed for the wrong fortnight.
 */

export interface Quarter {
  year: number;
  /** 1 to 4. */
  quarter: number;
}

export function quarterKey(quarter: Quarter): string {
  return `${quarter.year}-q${quarter.quarter}`;
}

export function currentQuarter(now = new Date()): Quarter {
  return { year: now.getUTCFullYear(), quarter: Math.floor(now.getUTCMonth() / 3) + 1 };
}

/** Parses `2026-q1`, and falls back to the current quarter rather than failing. */
export function quarterFrom(value: string | null, now = new Date()): Quarter {
  const match = /^(\d{4})-q([1-4])$/.exec(value ?? "");
  if (!match) return currentQuarter(now);
  return { year: Number(match[1]), quarter: Number(match[2]) };
}

export function quarterRange(quarter: Quarter): { from: Date; to: Date } {
  const startMonth = (quarter.quarter - 1) * 3;
  return {
    from: new Date(Date.UTC(quarter.year, startMonth, 1)),
    to: new Date(Date.UTC(quarter.year, startMonth + 3, 1)),
  };
}

/** The last `count` quarters, newest first, for the period picker. */
export function recentQuarters(count: number, now = new Date()): Quarter[] {
  const current = currentQuarter(now);
  const quarters: Quarter[] = [];
  for (let step = 0; step < count; step += 1) {
    const index = current.quarter - 1 - step;
    const yearShift = Math.floor(index / 4);
    quarters.push({ year: current.year + yearShift, quarter: ((index % 4) + 4) % 4 + 1 });
  }
  return quarters;
}
