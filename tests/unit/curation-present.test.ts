import { describe, expect, it } from "vitest";
import { presentCuration, type CurationData } from "@/app/(admin)/admin/content/home/present";
import type { HomeRail } from "@/lib/content/home-rails";
import type { CuratedBusiness, SlotRow } from "@/lib/content/homepage";
import { formatDate } from "@/lib/format";

/**
 * Board 6h — the screen's words and numbers against the rows under them.
 *
 * "If a header, a note or a section title states a count, count the elements."
 */

const NOW = new Date("2026-09-14T08:00:00Z");

const business = (over: Partial<CuratedBusiness> & Pick<CuratedBusiness, "id" | "displayName">): CuratedBusiness => ({
  slug: over.id,
  sectorName: "Industrial & MEP",
  areaName: "Jebel Ali FZ",
  reviewCount: 126,
  responseTimeMedianMs: 2 * 3_600_000,
  sellsKind: "goods",
  productCount: 1204,
  serviceCount: 0,
  verificationTier: 2,
  licenceExpiry: new Date("2027-04-14T00:00:00Z"),
  block: null,
  ...over,
});

const slots = (...held: (CuratedBusiness | null)[]): SlotRow[] =>
  [1, 2, 3, 4].map((position) => ({ position, business: held[position - 1] ?? null, addedAt: null }));

const RAILS: HomeRail[] = [
  { key: "verified", source: "curated", board: null, href: null, count: 3, limit: 4 },
  { key: "categories", source: "listing_count", board: "6c", href: "/admin/categories", count: 1, limit: 12 },
  { key: "footer", source: "strings", board: "12g-s", href: "/admin/strings", count: 17, limit: null },
];

const data = (over: Partial<CurationData>): CurationData => ({
  slots: slots(),
  chips: [],
  rails: RAILS,
  candidates: [],
  suggestions: [],
  searched: [],
  find: "",
  businesses: 122,
  canWrite: true,
  ...over,
});

describe("presentCuration", () => {
  it("counts live cards as the eligible slots, not the held ones", () => {
    const view = presentCuration(
      data({ slots: slots(business({ id: "a", displayName: "A" }), null, business({ id: "c", displayName: "C", verificationTier: 1, block: "licence_unchecked" }), null) }),
      NOW,
    );
    expect(view.live).toBe(1);
    expect(view.meta).toBe("1 of 4 cards live · 0 chips");
    expect(view.order).toEqual(["a", null, "c", null]);
    expect(view.firstFree).toBe(2);
    expect(view.slots[2]!.emptyOnHome).toMatch(/Slot 3 shows nothing/);
    expect(view.slots[2]!.business!.action).toEqual({ label: "Open verification", href: "/admin/businesses/c" });
  });

  it("says what a curator judges on, and a service firm's depth in services", () => {
    const view = presentCuration(
      data({
        slots: slots(
          business({ id: "a", displayName: "Al Waha Industrial Supplies" }),
          business({ id: "n", displayName: "Nexa Freight & Logistics", sectorName: "Logistics & freight", areaName: "DMCC", reviewCount: 1, responseTimeMedianMs: null, sellsKind: "services", productCount: 0, serviceCount: 18 }),
        ),
      }),
      NOW,
    );
    expect(view.slots[0]!.business!.signals).toBe("Industrial & MEP · Jebel Ali FZ · 126 reviews · replies in ~2 h · 1,204 products");
    expect(view.slots[1]!.business!.signals).toBe("Logistics & freight · DMCC · 1 review · reply time not measured yet · 18 services");
    expect(view.slots[1]!.business!.initials).toBe("NF");
    expect(view.slots[0]!.business!.tierLabel).toBe("Tier 2 · Licence verified");
  });

  it("calls out a vacated slot before a licence about to lapse, and says so when neither", () => {
    const dana = business({ id: "d", displayName: "Dana Printing & Signage", licenceExpiry: new Date("2026-09-22T00:00:00Z") });
    expect(presentCuration(data({ slots: slots(dana) }), NOW).notice).toMatchObject({ tone: "warn", lead: `Dana Printing & Signage's licence expires ${formatDate(dana.licenceExpiry)}.` });

    const lapsed = { ...dana, verificationTier: 1, licenceExpiry: new Date("2026-09-12T00:00:00Z"), block: "licence_lapsed" as const };
    const vacated = presentCuration(data({ slots: slots(business({ id: "a", displayName: "A", licenceExpiry: new Date("2026-09-20T00:00:00Z") }), lapsed) }), NOW).notice;
    expect(vacated.lead).toBe("Slot 2 is empty on the home page: Dana Printing & Signage.");

    expect(presentCuration(data({ slots: slots(business({ id: "a", displayName: "A" })) }), NOW).notice).toMatchObject({ tone: "neutral" });
  });

  it("prints each rail's count against its cap, and names only computed rails' boards", () => {
    const view = presentCuration(data({}), NOW);
    expect(view.rails.map((rail) => [rail.name, rail.items, rail.board])).toEqual([
      ["Verified this week", "3 of 4 cards", null],
      ["Browse by category", "1 of 12 sectors", "6c"],
      ["Footer links", "17 keys", "12g-s"],
    ]);
    expect(view.rails[0]!.curated).toBe(true);
  });

  it("states the chip count against the cap it enforces", () => {
    const chips = Array.from({ length: 6 }, (_, i) => ({ id: String(i), label: `Chip ${i}`, query: `q=chip+${i}`, position: i + 1 }));
    const view = presentCuration(data({ chips }), NOW);
    expect(view.chipCount).toBe("6 of 6");
    expect(view.chipFull).toBe(true);
    expect(view.chips[0]).toMatchObject({ href: "/search?q=chip+0", removeLabel: "Remove Chip 0" });
  });
});
