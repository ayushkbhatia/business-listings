import { describe, expect, it } from "vitest";
import { visibleTo } from "./visibility";
import type { ConsoleJob } from "./overview";
import type { Actor } from "@/lib/auth/roles";

/**
 * The overview links every count to the screen that fixes it, and §07 does not
 * give every seat every screen. A number linking into a 404 is what happens
 * when the two lists are kept separately — which they were, until the revenue
 * screens made `/admin/dunning` real and finance-only.
 */

const jobs: ConsoleJob[] = [
  {
    key: "money",
    labelKey: "console.job.money",
    metrics: [
      {
        key: "past_due",
        labelKey: "console.metric.past_due",
        count: 3,
        isQueue: false,
        late: null,
        oldestDays: null,
        navKey: "dunning",
        href: "/admin/dunning",
      },
      {
        key: "unpaid",
        labelKey: "console.metric.unpaid",
        count: 1,
        isQueue: false,
        late: null,
        oldestDays: null,
        navKey: "invoices",
        href: "/admin/invoices",
      },
    ],
  },
  {
    key: "supply",
    labelKey: "console.job.supply",
    metrics: [
      {
        key: "queue",
        labelKey: "console.metric.queue",
        count: 4,
        isQueue: true,
        late: 1,
        oldestDays: 6,
        navKey: "queue",
        href: "/admin/queue",
      },
    ],
  },
];

const actor = (...roles: Actor["roles"]): Actor => ({ id: "u1", roles });

describe("what an overview shows whom", () => {
  it("keeps the money numbers away from an ops lead", () => {
    // `revenue.read` and `subscription.credit` are both finance in §07.
    const seen = visibleTo(jobs, actor("staff_ops_lead"));
    expect(seen.find((job) => job.key === "money")!.metrics).toEqual([]);
  });

  it("keeps the panel even when it has nothing to show", () => {
    /*
     * The six jobs are what the platform has to do, not what the reader has to
     * do. Dropping the panel would tell an ops lead the money looks after
     * itself.
     */
    const seen = visibleTo(jobs, actor("staff_ops_lead"));
    expect(seen).toHaveLength(2);
    expect(seen.map((job) => job.key)).toEqual(["money", "supply"]);
  });

  it("gives finance the money numbers", () => {
    const seen = visibleTo(jobs, actor("staff_finance"));
    expect(seen.find((job) => job.key === "money")!.metrics).toHaveLength(2);
  });

  it("gives a moderator neither the money nor anything else they cannot open", () => {
    const seen = visibleTo(jobs, actor("staff_moderator"));
    expect(seen.find((job) => job.key === "money")!.metrics).toEqual([]);
    // A moderator does decide the queue.
    expect(seen.find((job) => job.key === "supply")!.metrics).toHaveLength(1);
  });
});
