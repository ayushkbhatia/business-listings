import { HomeCuration } from "@/app/(admin)/admin/content/home/HomeCuration";
import { presentCuration, type CurationData } from "@/app/(admin)/admin/content/home/present";
import type { HomeRail } from "@/lib/content/home-rails";
import type { ChipRow, CuratedBusiness, SlotRow } from "@/lib/content/homepage";
import { CARRIED_OVER_CHIPS } from "@/lib/content/homepage-rules";
import { Section, States } from "../_kit";

/**
 * Board `6h` — homepage curation in the states its spec names: as drawn with a
 * featured licence eight days from expiry and a blocked candidate in the search,
 * a slot whose licence has lapsed, fewer than four, and the cold start with no
 * slot and no chip.
 *
 * Every specimen runs through `presentCuration`, the function the page uses,
 * and renders without landmarks — several on one page would each claim the
 * same regions.
 */

const NOW = new Date("2026-09-14T08:00:00Z");

const business = (over: Partial<CuratedBusiness> & Pick<CuratedBusiness, "id" | "displayName">): CuratedBusiness => ({
  slug: over.id,
  sectorName: "Industrial & MEP",
  areaName: "Jebel Ali FZ",
  reviewCount: 0,
  responseTimeMedianMs: null,
  sellsKind: "goods",
  productCount: 0,
  serviceCount: 0,
  verificationTier: 2,
  licenceExpiry: new Date("2027-04-14T00:00:00Z"),
  block: null,
  ...over,
});

const HOUR = 3_600_000;

const AL_WAHA = business({ id: "al-waha", displayName: "Al Waha Industrial Supplies", reviewCount: 126, responseTimeMedianMs: 2 * HOUR, productCount: 1204 });
const GULF_COOL = business({ id: "gulf-cool", displayName: "Gulf Cool Technical Services", sectorName: "HVAC & refrigeration", areaName: "Al Quoz 3", reviewCount: 88, responseTimeMedianMs: HOUR, productCount: 312, licenceExpiry: new Date("2026-11-30T00:00:00Z") });
const NEXA = business({ id: "nexa", displayName: "Nexa Freight & Logistics", sectorName: "Logistics & freight", areaName: "DMCC", reviewCount: 203, responseTimeMedianMs: 40 * 60_000, sellsKind: "services", serviceCount: 18, licenceExpiry: new Date("2027-06-08T00:00:00Z") });
const DANA = business({ id: "dana", displayName: "Dana Printing & Signage", sectorName: "Printing & signage", areaName: "Mussafah M-14", reviewCount: 61, responseTimeMedianMs: 3 * HOUR, productCount: 96, licenceExpiry: new Date("2026-09-22T00:00:00Z") });
const MARINA = business({ id: "marina", displayName: "Marina Pumps & Controls", sectorName: "Pumps & motors", areaName: "Dubai Marina", verificationTier: 1, block: "licence_unchecked" });

const slots = (...held: (CuratedBusiness | null)[]): SlotRow[] =>
  [1, 2, 3, 4].map((position) => ({ position, business: held[position - 1] ?? null, addedAt: held[position - 1] ? NOW : null }));

const CHIPS: ChipRow[] = CARRIED_OVER_CHIPS.map((chip, index) => ({ id: `chip-${index + 1}`, position: index + 1, ...chip }));

const rails = (verified: number, chips: number, sectors = 12): HomeRail[] => [
  { key: "headline", source: "strings", board: "12g-s", href: "/admin/strings", count: 2, limit: null },
  { key: "popular", source: "curated", board: null, href: null, count: chips, limit: 6 },
  { key: "rfqs", source: "live", board: "1h", href: null, count: 4, limit: 4 },
  { key: "verified", source: "curated", board: null, href: null, count: verified, limit: 4 },
  { key: "categories", source: "listing_count", board: "6c", href: "/admin/categories", count: sectors, limit: 12 },
  { key: "emirates", source: "listing_count", board: "12h", href: null, count: 7, limit: null },
  { key: "catalogue", source: "last_published", board: "1e", href: null, count: 5, limit: 5 },
  { key: "plans", source: "plan_table", board: "2e", href: "/admin/plans", count: 3, limit: null },
  { key: "footer", source: "strings", board: "12g-s", href: "/admin/strings", count: 17, limit: null },
];

const data = (over: Partial<CurationData>): CurationData => ({
  slots: slots(AL_WAHA, GULF_COOL, NEXA, DANA),
  chips: CHIPS,
  rails: rails(4, 6),
  candidates: [],
  suggestions: [],
  searched: [],
  find: "",
  businesses: 41_200,
  canWrite: true,
  ...over,
});

function Specimen({ value }: { value: CurationData }) {
  return <HomeCuration view={presentCuration(value, NOW)} landmark={false} />;
}

export function HomeCurationGallery() {
  return (
    <Section
      id="home-curation"
      title="Homepage curation"
      note="Board 6h. Four slots a person chooses, eligibility read live from the tier, an empty slot that is never backfilled, typed chips, and a map of the nine rails."
    >
      <States label="As drawn · a licence eight days out, a blocked candidate in the search" stack>
        <Specimen
          value={data({
            find: "Marina",
            candidates: [MARINA],
            searched: [
              { query: "gate valve DN100", searches: 34, answered: true, chipped: false },
              { query: "Pallet racking", searches: 7, answered: true, chipped: true },
              { query: "titanium heat exchanger", searches: 6, answered: false, chipped: false },
            ],
          })}
        />
      </States>
      <States label="A featured licence lapsed · slot 4 held, empty on the home page" stack>
        <Specimen
          value={data({
            slots: slots(AL_WAHA, GULF_COOL, NEXA, { ...DANA, verificationTier: 1, licenceExpiry: new Date("2026-09-12T00:00:00Z"), block: "licence_lapsed" }),
            rails: rails(3, 6),
          })}
        />
      </States>
      <States label="Fewer than four · slot 3 empty, suggestions offered" stack>
        <Specimen value={data({ slots: slots(AL_WAHA, GULF_COOL, null, null), rails: rails(2, 4), chips: CHIPS.slice(0, 4), suggestions: [NEXA] })} />
      </States>
      <States label="Cold start · no slot, no chip" stack>
        <Specimen value={data({ slots: slots(), chips: [], rails: rails(0, 0, 3), businesses: 40 })} />
      </States>
    </Section>
  );
}
