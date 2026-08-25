/**
 * Seed. Real-shaped UAE trade data, entirely fictional.
 *
 * Deterministic: a fixed PRNG and fixed timestamps, so two runs produce the same
 * rows and a reviewer diffing two screenshots sees real changes only.
 *
 *   pnpm db:seed
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"], quiet: true });

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/db/generated/client.js";
import {
  AREAS,
  AUTHORITY_BY_EMIRATE,
  CATEGORIES,
  NAME_PREFIX,
  NAME_SUFFIX,
  PLANS,
  SUBCATEGORIES,
  VALVE_TEMPLATE_FIELDS,
} from "./seed-data.mjs";
import { DN_SYNONYMS, sizeAliases } from "../lib/trade/nominal-size.js";
import { matchLine } from "../lib/quote/match.js";
import { medianResponseMs, windowStart } from "../lib/metrics/response-time.js";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL! }),
});

// ── Determinism ─────────────────────────────────────────────────────────────
// Math.random would make every run a different dataset, and every screenshot
// diff noise. mulberry32, seeded once.
let state = 0x9e3779b9;
function rnd(): number {
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const pickN = <T,>(xs: readonly T[], n: number): T[] => {
  const pool = [...xs];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length > 0; i += 1) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]!);
  return out;
};
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));

/**
 * The seed's clock: noon today, Asia/Dubai.
 *
 * This was a fixed instant, which made two runs byte-identical but let the
 * fixtures rot — ten days after it was written, every "live" enquiry in the
 * leads inbox rendered as Closed and the seller screens had nothing to act on.
 * A fixture that expires is worse than one that moves.
 *
 * So: the PRNG stays fixed, which is what actually keeps content stable — the
 * same businesses, products, prices and names every time. Only the timeline
 * slides, anchored to the day the seed ran. Two runs on the same day are
 * identical. Set SEED_NOW to an ISO instant to reproduce an exact dataset.
 */
const NOW = seedNow();

function seedNow(): Date {
  const override = process.env.SEED_NOW;
  if (override) {
    const at = new Date(override);
    if (Number.isNaN(at.getTime())) throw new Error(`SEED_NOW is not an ISO instant: ${override}`);
    return at;
  }
  // en-CA formats as YYYY-MM-DD, which is the one thing it is good for.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${today}T12:00:00+04:00`);
}
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

/**
 * The claim token on the seeded provisional buyer.
 *
 * Fixed so `/enquiry/:id?t=…` is reachable in a test without a session. In
 * production these are `randomUUID()` and are bearer secrets; this one is good
 * for one seeded buyer's enquiries in a database that is truncated on every
 * run.
 */
const PROVISIONAL_CLAIM_TOKEN = "seed-0000-4000-8000-provisional01";
const PROVISIONAL_ENQUIRY_ID = "seedenquiryprovisional0001";
/** Accepted, unreviewed — the subject of the review flow. */
const PROVISIONAL_ACCEPTED_ENQUIRY_ID = "seedenquiryaccepted000001";

/** Deterministic v4-shaped uuids, so seeded users keep their ids between runs. */
function uuid(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Metric and imperial are the same size to the trade and different strings to a
 * database. A seller who types 4" and a buyer who types DN100 mean one thing,
 * and the match surface has to carry both directions or the products tab is
 * worth nothing.
 *
 * The table itself lives in lib/trade/nominal-size.ts, because the quote-line
 * matcher needs exactly the same one and two copies of it would drift.
 */
/** The reverse of DN_SYNONYMS: an imperial size back to its metric name. */
const INCH_TO_DN: Record<string, string> = Object.fromEntries(
  Object.entries(DN_SYNONYMS).flatMap(([dn, names]) => names.map((n) => [n, dn])),
);

/**
 * The denormalised match surface. Both DN100 and 4" land here whichever way the
 * seller typed it, which is what lets each query find the other's products.
 */
function buildSearchText(parts: {
  name: string;
  sku?: string | null;
  categoryName: string;
  specValues: Record<string, unknown>;
  size?: string;
}): string {
  const tokens = new Set<string>();
  const add = (v: unknown) => {
    if (v === null || v === undefined) return;
    const s = String(v).trim();
    if (s) tokens.add(s.toLowerCase());
  };
  add(parts.name);
  add(parts.sku);
  add(parts.categoryName);
  for (const alias of sizeAliases(parts.size)) add(alias);
  for (const value of Object.values(parts.specValues)) {
    if (Array.isArray(value)) value.forEach(add);
    else add(value);
    // A spec value may itself be a size — nominal_diameter usually is.
    for (const alias of sizeAliases(String(value))) add(alias);
  }
  return [...tokens].join(" ");
}

async function main() {
  console.log("→ clearing");
  // Order matters only where a FK is Restrict rather than Cascade.
  await prisma.$executeRawUnsafe(`
    truncate table
      "audit_event","contact_reveal","zero_result_query","saved_search","redirect",
      "notification_delivery","notification_template","notification_preference","review_request",
      "invoice_line","invoice","placement_slot","subscription",
      "supplier_report","review","message","quote_line","quote",
      "listing_change_request","claim_submission","site_visit_request","team_invite",
      "missed_enquiry","enquiry_recipient","enquiry_line","enquiry",
      "document","media","product","seller_template","location",
      "business_category","business","spec_field","spec_template",
      "category","area","plan","user","buyer_company"
    restart identity cascade;
  `);

  console.log("→ plans");
  for (const plan of PLANS) await prisma.plan.create({ data: { ...plan } });

  console.log("→ areas");
  const areaByslug = new Map<string, string>();
  for (const a of AREAS) {
    /*
     * Free zones are published too.
     *
     * This read `a.isFreeZone ? null : days(-120)`, which left every free zone
     * out of every area list in the product. Handoff 3's README makes the free
     * zone a cross-cutting toggle precisely because "a JAFZA company is in
     * Dubai *and* in a free zone" — and an unpublished JAFZA means the toggle
     * filters an empty list, no buyer can browse it, and the one seeded branch
     * sitting in it could not be edited without losing its area.
     *
     * One is held back on purpose so the unpublished state still has an
     * example, because the picker has to keep offering an area a location
     * already uses whether or not it is published.
     */
    const row = await prisma.area.create({
      data: { ...a, publishedAt: a.slug === "saif-zone" ? null : days(-120) },
    });
    areaByslug.set(a.slug, row.id);
  }

  console.log("→ categories");
  const catBySlug = new Map<string, string>();
  for (const [i, c] of CATEGORIES.entries()) {
    const row = await prisma.category.create({
      data: { ...c, synonyms: [...c.synonyms], sortOrder: i, publishThreshold: 60, verifiedShareMin: 0.3 },
    });
    catBySlug.set(c.slug, row.id);
  }
  for (const [i, s] of SUBCATEGORIES.entries()) {
    const row = await prisma.category.create({
      data: {
        parentId: catBySlug.get(s.parent)!,
        slug: s.slug,
        code: s.code,
        name: s.name,
        nameAr: s.nameAr,
        synonyms: [...s.synonyms],
        sortOrder: i,
      },
    });
    catBySlug.set(s.slug, row.id);
  }

  console.log("→ spec template");
  const template = await prisma.specTemplate.create({
    data: {
      categoryId: catBySlug.get("valves-and-fittings")!,
      name: "Industrial valve",
      version: 1,
      status: "live",
      fields: {
        create: VALVE_TEMPLATE_FIELDS.map((f, i) => ({
          key: f.key,
          label: f.label,
          labelAr: f.labelAr,
          type: f.type,
          unit: f.unit ?? null,
          options: [...f.options],
          required: f.required,
          isFilterable: f.isFilterable,
          sortOrder: i,
        })),
      },
    },
    include: { fields: true },
  });
  await prisma.category.update({
    where: { id: catBySlug.get("valves-and-fittings")! },
    data: { defaultTemplateId: template.id },
  });
  const fieldId = (key: string) => template.fields.find((f) => f.key === key)!.id;

  console.log("→ staff and buyers");
  const opsLead = await prisma.user.create({
    data: { id: uuid(1), email: "ops@businesslistings.me", fullName: "Ops Lead", roles: ["staff_ops_lead"] },
  });
  const moderator = await prisma.user.create({
    data: { id: uuid(2), email: "moderator@businesslistings.me", fullName: "Moderator", roles: ["staff_moderator"] },
  });
  await prisma.user.create({
    data: { id: uuid(3), email: "field@businesslistings.me", fullName: "Field Officer", roles: ["staff_field"] },
  });
  await prisma.user.create({
    data: { id: uuid(4), email: "finance@businesslistings.me", fullName: "Finance", roles: ["staff_finance"] },
  });

  const buyerCompany = await prisma.buyerCompany.create({
    data: {
      name: "Harbour Contracting LLC",
      trn: "100487213600003",
      emirate: "dubai",
      approvalThresholdAed: 25_000,
    },
  });
  const buyer = await prisma.user.create({
    data: {
      id: uuid(10),
      phone: "+971506412288",
      email: "procurement@harbourcontracting.example",
      // A person, not a job title. The seller sees a first name and nothing
      // else until acceptance, so the first name has to read like one.
      fullName: "Rashid Al Hameli",
      roles: ["buyer"],
      buyerCompanyId: buyerCompany.id,
    },
  });
  const buyerTwo = await prisma.user.create({
    data: { id: uuid(11), phone: "+971552048817", fullName: "Fatima Al Zaabi", roles: ["buyer"] },
  });

  console.log("→ businesses");
  const emirates = ["dubai", "sharjah", "abu_dhabi", "ajman"] as const;
  const areasByEmirate = new Map<string, typeof AREAS[number][]>();
  for (const a of AREAS) {
    const list = areasByEmirate.get(a.emirate) ?? [];
    list.push(a);
    areasByEmirate.set(a.emirate, list);
  }

  const LOCATION_TYPES = ["head_office", "warehouse", "trade_counter", "depot", "sales_office", "workshop"] as const;
  const TEAM_SIZES = ["b1_10", "b11_50", "b51_200", "b201_500"] as const;
  const THEMES = ["default", "industrial", "trade", "mono", "clinic", "salon"] as const;
  const catSlugs = CATEGORIES.map((c) => c.slug);

  const businesses: { id: string; slug: string; tier: number; claim: string; categorySlug: string }[] = [];

  for (let i = 0; i < 40; i += 1) {
    const emirate = emirates[i % emirates.length]!;
    const areaPool = areasByEmirate.get(emirate)!;
    const area = areaPool[i % areaPool.length]!;
    const categorySlug = catSlugs[i % catSlugs.length]!;

    const tradeName = `${NAME_PREFIX[i]!} ${pick(NAME_SUFFIX)}`;
    const slug = slugify(tradeName);

    // Claim state is assigned by index, not rolled, so the mix is guaranteed:
    // 14 claimed, 2 disputed, 24 unclaimed. The real directory runs closer to
    // three in four unclaimed, but a seed needs enough claimed listings to
    // exercise catalogues, quotes and reviews.
    const claimStatus = i === 13 || i === 29 ? "disputed" : i % 3 === 0 ? "claimed" : "unclaimed";
    const claimed = claimStatus === "claimed";

    // Unclaimed listings are tier 0 by definition — nothing has been checked.
    // Claimed ones walk the ladder so every badge state appears at least twice.
    const TIER_LADDER = [3, 1, 4, 2, 2, 3, 1, 2, 4, 1, 2, 3, 2, 1] as const;
    const tier = claimed ? TIER_LADDER[Math.floor(i / 3) % TIER_LADDER.length]! : 0;
    const visitedAt = tier >= 3 ? days(-int(20, 200)) : null;

    const licenceExpiry = days(int(-40, 500));
    // Expiry already past means the scheduled job has dropped the tier to 2.
    const effectiveTier = licenceExpiry < NOW && tier > 2 ? 2 : tier;

    const planId = claimed ? pick(["free", "free", "basic", "basic", "pro"]) : null;
    const authority = pick(AUTHORITY_BY_EMIRATE[emirate]);
    const isFreeZoneAuthority = ["JAFZA", "DMCC", "SAIF", "HFZA", "KIZAD", "AFZ"].includes(authority);

    const business = await prisma.business.create({
      data: {
        tradeName,
        displayName: tradeName.replace(/ (LLC|FZE)$/, ""),
        slug,
        licenceNumber: `${authority}-${int(100000, 999999)}`,
        licenceAuthority: authority,
        licenceExpiry,
        trn: claimed ? `100${int(100000000, 999999999)}${int(100, 999)}`.slice(0, 15) : null,
        establishedYear: claimed ? int(1994, 2022) : null,
        teamSize: claimed ? pick(TEAM_SIZES) : null,
        languages: claimed ? pickN(["English", "Arabic", "Hindi", "Urdu", "Malayalam", "Tagalog"], int(2, 4)) : [],
        description: claimed
          ? `Stockist and supplier serving contractors across the ${emirate.replace(/_/g, " ")} market. Counter sales and scheduled site delivery.`
          : null,
        verificationTier: effectiveTier,
        verifiedAt: effectiveTier > 0 ? days(-int(30, 300)) : null,
        visitedAt,
        visitedByStaffId: visitedAt ? uuid(3) : null,
        claimStatus,
        planId,
        primaryCategoryId: catBySlug.get(categorySlug)!,
        source: claimed ? pick(["licence_import", "self_added"]) : "licence_import",
        publishedAt: days(-int(10, 400)),
        themePreset: claimed && planId === "pro" ? pick(THEMES) : null,
        /*
         * `responseTimeMedianMs` used to be invented here, which criterion 5
         * forbids — it is derived from real reply timestamps now, by the same
         * functions the scheduled job uses. The draw it used to make stays,
         * discarded: the PRNG is a sequence, and removing a draw renames every
         * business generated after it, which renamed the slugs a dozen test
         * files pin. A deliberate discarded draw is a smaller lie than a
         * fabricated reply time, and cheaper than churning every fixture.
         */
        ...(claimed ? (int(20, 2600), {}) : {}),
        /*
         * Not set here. It is derived in recomputeDerived by the same function
         * the scheduled job uses — see lib/metrics/profile-strength.ts. This
         * column was `int(38, 98)` until handoff 3 step 1, which is the same
         * shape of invention criterion 5 forbids for response time, sitting
         * one column along and shown on the seller's own home screen.
         *
         * The draw is kept and discarded: removing it would shift every
         * subsequent PRNG value and rename half the seed.
         */
        ...(claimed ? (int(38, 98), {}) : {}),
        specCompleteness: claimed ? Number((0.4 + rnd() * 0.6).toFixed(2)) : null,
        ratingOverall: null,
        reviewCount: 0,
        derivedAt: NOW,
      },
    });

    businesses.push({ id: business.id, slug, tier: effectiveTier, claim: claimStatus, categorySlug });

    // A second category for about a third of them.
    if (rnd() < 0.35) {
      const other = pick(catSlugs.filter((s) => s !== categorySlug));
      await prisma.businessCategory.create({
        data: { businessId: business.id, categoryId: catBySlug.get(other)! },
      });
    }

    // Locations. One head office always; a second site for larger sellers. Two
    // in every ten are deliberately unpinned — lat/lng null — so the map
    // exclusion rule and the seller-facing gap both have real data.
    const locationCount = claimed ? int(1, 3) : 1;
    for (let l = 0; l < locationCount; l += 1) {
      const la = l === 0 ? area : pick(areaPool);
      const unpinned = rnd() < 0.2;
      await prisma.location.create({
        data: {
          businessId: business.id,
          type: l === 0 ? "head_office" : pick(LOCATION_TYPES.slice(1)),
          emirate,
          areaId: areaByslug.get(la.slug)!,
          addressLine: `Warehouse ${int(2, 48)}, Street ${int(4, 32)}, ${la.name}`,
          lat: unpinned ? null : Number((la.lat + (rnd() - 0.5) * 0.012).toFixed(6)),
          lng: unpinned ? null : Number((la.lng + (rnd() - 0.5) * 0.012).toFixed(6)),
          phone: `0${pick(["4", "6", "2", "6"])}${int(2000000, 8999999)}`,
          whatsapp: claimed ? `+9715${int(0, 8)}${int(1000000, 9999999)}` : null,
          phoneVerified: claimed && rnd() < 0.8,
          hours: {
            sun: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "20:00" }],
            mon: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "20:00" }],
            tue: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "20:00" }],
            wed: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "20:00" }],
            thu: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "18:00" }],
            fri: [{ open: "08:00", close: "12:00" }],
            sat: [],
          },
          ramadanHours: claimed && rnd() < 0.5 ? { all: [{ open: "09:00", close: "15:00" }] } : undefined,
          serviceRadiusKm: rnd() < 0.5 ? int(20, 120) : null,
          published: true,
          // A free-zone licence sitting in a mainland area is a real data
          // pattern worth having in the set.
          ...(isFreeZoneAuthority && l === 0 ? {} : {}),
        },
      });
    }
  }

  console.log(`→ ${businesses.length} businesses`);
  await seedSellerAccounts(prisma, businesses);
  await seedNotificationTemplates(prisma);
  await seedProducts(prisma, businesses, catBySlug, fieldId, template.id);
  await seedEnquiries(prisma, businesses, buyer.id, buyerTwo.id, buyerCompany.id);
  await seedReplyHistory(prisma, businesses, buyerTwo.id);
  await seedAtMonthlyCap(prisma, businesses, buyerTwo.id);
  await seedCommercials(prisma, businesses);
  await seedTrust(prisma, businesses, opsLead.id, moderator.id, buyer.id);
  await seedSignals(prisma, businesses, buyer.id, catBySlug);
  await seedQueues(prisma, businesses, catBySlug, opsLead.id, moderator.id);
  await recomputeDerived(prisma);
}

// ─────────────────────────────────────────────────────────────────────────────

type Biz = { id: string; slug: string; tier: number; claim: string; categorySlug: string };
type Db = typeof prisma;

interface ProductSeed {
  name: string;
  /// A trade sizes its goods in its own units. A cable is mm², a breaker is
  /// amps, a helmet is a size, a pallet is millimetres. Getting this wrong is
  /// what makes seed data read as fake to anyone who works in the trade.
  sizes: readonly string[];
}

const CATALOGUE: Record<string, readonly ProductSeed[]> = {
  "valves-and-fittings": [
    { name: "Resilient seated gate valve", sizes: ["DN50", "DN80", "DN100", "DN150", "DN200", "DN300"] },
    { name: "Wafer butterfly valve", sizes: ["DN50", "DN80", "DN100", "DN150", "DN200", "DN300"] },
    { name: "Ductile iron check valve", sizes: ["DN50", "DN80", "DN100", "DN150", "DN200"] },
    { name: "Cast iron Y-strainer", sizes: ["DN25", "DN50", "DN80", "DN100", "DN150"] },
    { name: "Brass ball valve", sizes: ["DN15", "DN20", "DN25", "DN50"] },
    { name: "Gear operated butterfly valve", sizes: ["DN150", "DN200", "DN300"] },
  ],
  "pipes-and-tubing": [
    { name: "GI pipe, medium duty, 6 m", sizes: ["DN15", "DN25", "DN50", "DN80", "DN100", "DN150"] },
    { name: "HDPE pipe PE100 PN16", sizes: ["DN50", "DN100", "DN200", "DN300"] },
    { name: "Seamless carbon steel pipe, Sch 40", sizes: ["DN25", "DN50", "DN100", "DN150"] },
    { name: "uPVC pressure pipe", sizes: ["DN50", "DN100", "DN150"] },
  ],
  "hvac-and-ventilation": [
    { name: "Pre-insulated duct panel", sizes: ["20 mm", "25 mm", "30 mm"] },
    { name: "Axial inline fan", sizes: ["250 mm dia", "315 mm dia", "400 mm dia"] },
    { name: "Fan coil unit, ducted", sizes: ["600 CFM", "800 CFM", "1200 CFM"] },
    { name: "Aluminium linear bar grille", sizes: ["300 x 150 mm", "450 x 250 mm", "600 x 400 mm"] },
  ],
  "electrical-and-cable": [
    { name: "XLPE armoured cable, 4 core", sizes: ["16 mm²", "35 mm²", "95 mm²", "185 mm²"] },
    { name: "PVC conduit, heavy gauge, 3 m", sizes: ["20 mm", "25 mm", "32 mm", "50 mm"] },
    { name: "MCCB, 3 pole, 36 kA", sizes: ["100 A", "160 A", "250 A", "400 A"] },
    { name: "Copper busbar, hard drawn", sizes: ["25 x 3 mm", "40 x 5 mm", "60 x 10 mm"] },
  ],
  "safety-and-ppe": [
    { name: "Full body harness, twin lanyard", sizes: ["Size M", "Size L", "Size XL"] },
    { name: "Vented safety helmet", sizes: ["Universal"] },
    { name: "Cut resistant glove, level D", sizes: ["Size 8", "Size 9", "Size 10"] },
    { name: "DCP fire extinguisher", sizes: ["4 kg", "6 kg", "9 kg", "12 kg"] },
  ],
  "packaging-and-materials": [
    { name: "Stretch film, machine grade", sizes: ["500 mm x 17 micron", "500 mm x 23 micron"] },
    { name: "Corrugated carton, double wall", sizes: ["400 x 300 x 300 mm", "600 x 400 x 400 mm"] },
    { name: "Steel strapping coil", sizes: ["13 x 0.5 mm", "19 x 0.5 mm", "32 x 0.8 mm"] },
    { name: "Euro pallet, heat treated", sizes: ["1200 x 800 mm", "1200 x 1000 mm"] },
  ],
};

async function seedProducts(
  db: Db,
  businesses: Biz[],
  catBySlug: Map<string, string>,
  fieldId: (key: string) => string,
  templateId: string,
) {
  console.log("→ products");
  const AVAILABILITY = ["in_stock", "made_to_order", "indent", "out_of_stock"] as const;
  let total = 0;

  for (const [bi, b] of businesses.entries()) {
    if (b.claim === "unclaimed") continue; // an unclaimed listing has no catalogue
    const isValves = b.categorySlug === "valves-and-fittings";
    const catalogue = CATALOGUE[b.categorySlug] ?? CATALOGUE["valves-and-fittings"]!;
    const count = int(3, 8);

    for (let p = 0; p < count; p += 1) {
      const item = catalogue[p % catalogue.length]!;
      const base = item.name;
      // Every availability state appears, and the first four products of the
      // first catalogue walk all four in order so the gallery always has one.
      const availability = bi === 0 && p < 4 ? AVAILABILITY[p]! : pick(AVAILABILITY);

      const size = pick(item.sizes);
      // Valve spec values key off the same size, so the spec table and the name
      // never disagree.
      const dn = size;
      const specValues: Record<string, string | number | string[]> = isValves
        ? {
            [fieldId("nominal_diameter")]: dn,
            [fieldId("pressure_rating")]: pick(["PN16", "PN16", "PN25", "Class 150"]),
            [fieldId("body_material")]: pick(["Ductile iron", "Cast iron", "Stainless steel 316", "Brass"]),
            [fieldId("end_connection")]: pick(["Flanged", "Wafer", "Threaded"]),
            [fieldId("operation")]: pick(["Handwheel", "Lever", "Gear operated"]),
            [fieldId("certification")]: pickN(["WRAS", "FM approved", "UL listed", "EN 1074", "ISO 9001"], int(1, 3)),
            // temperature_max deliberately left unset on most, so SpecTable has
            // real "Not provided" rows to render in faint grey.
            ...(rnd() < 0.4 ? { [fieldId("temperature_max")]: int(80, 220) } : {}),
          }
        : {};

      const name = `${base} ${size}`;
      // Three letters of the trade name, letters only — "al-marwan" gives ALM,
      // not "AL-", which is what a slice of the slug produced.
      const mark = b.slug.replace(/[^a-z]/g, "").slice(0, 3).toUpperCase();
      const sku = `${mark}-${1000 + p * 7 + bi}`;

      await db.product.create({
        data: {
          businessId: b.id,
          name,
          slug: `${slugify(base)}-${slugify(size)}-${p}`,
          sku,
          categoryId: catBySlug.get(b.categorySlug)!,
          availability,
          stockQty: availability === "in_stock" ? int(4, 900) : null,
          leadTimeDays:
            availability === "made_to_order" ? int(7, 28) : availability === "indent" ? int(35, 90) : null,
          minOrderQty: rnd() < 0.4 ? pick([5, 10, 25, 50]) : null,
          specValues,
          searchText: buildSearchText({ name, sku, categoryName: b.categorySlug.replace(/-/g, " "), specValues, size }),
          description: `Supplied ex-stock or to order. Datasheet available on request.`,
          status: availability === "out_of_stock" ? "out_of_stock" : "live",
        },
      });
      total += 1;
    }

    /*
     * One imperial-first product per valve catalogue. A real share of UAE
     * sellers type 4" because that is what their supplier's datasheet says, and
     * acceptance criterion 3 is only meaningfully demonstrated against a
     * product actually stored that way — not against a DN100 product that
     * merely carries 4" as a synonym.
     */
    if (isValves) {
      const imperialSize = pick(['2"', '4"', '6"']);
      const specValues: Record<string, string | number | string[]> = {
        [fieldId("nominal_diameter")]: imperialSize,
        [fieldId("pressure_rating")]: "PN16",
        [fieldId("body_material")]: "Cast iron",
        [fieldId("end_connection")]: "Flanged",
      };
      const name = `Cast iron gate valve ${imperialSize}`;
      const mark = b.slug.replace(/[^a-z]/g, "").slice(0, 3).toUpperCase();
      const sku = `${mark}-9${bi}`;
      await db.product.create({
        data: {
          businessId: b.id,
          name,
          slug: `cast-iron-gate-valve-imperial-${bi}`,
          sku,
          categoryId: catBySlug.get(b.categorySlug)!,
          availability: "in_stock",
          stockQty: int(10, 200),
          specValues,
          searchText: buildSearchText({
            name,
            sku,
            categoryName: b.categorySlug.replace(/-/g, " "),
            specValues,
            size: imperialSize,
          }),
          description: "Imperial sizing as printed on the manufacturer datasheet.",
          status: "live",
        },
      });
      total += 1;
    }

    // A seller clone of the platform template, for the businesses in valves.
    if (isValves && rnd() < 0.5) {
      await db.sellerTemplate.create({
        data: {
          businessId: b.id,
          platformTemplateId: templateId,
          name: "Our valve spec",
          fieldMappings: { size: fieldId("nominal_diameter"), rating: fieldId("pressure_rating") },
        },
      });
    }
  }
  console.log(`   ${total} products`);
}

async function seedEnquiries(db: Db, businesses: Biz[], buyerId: string, buyerTwoId: string, buyerCompanyId: string) {
  console.log("→ enquiries and quotes");
  const claimed = businesses.filter((b) => b.claim === "claimed");
  const valveSellers = claimed.filter((b) => b.categorySlug === "valves-and-fittings").slice(0, 4);
  const recipients = valveSellers.length >= 3 ? valveSellers.slice(0, 3) : claimed.slice(0, 3);

  // Enquiry one: quoted, with a revision. This is the pair the quote comparison
  // screens in handoff 2 will read.
  const e1 = await db.enquiry.create({
    data: {
      ref: "ENQ-8841",
      buyerId,
      buyerCompanyId,
      requirement:
        "Resilient seated gate valves for a chilled water riser. Flanged PN16, ductile iron body, WRAS preferred. Delivery to Al Quoz, staged over three weeks.",
      deliverToArea: "Al Quoz Industrial 1",
      neededBy: days(21),
      termsWanted: "net_30",
      closesAt: days(4),
      createdAt: hours(-52),
      lines: {
        create: [
          { description: "Resilient seated gate valve, flanged", qty: 24, unit: "pcs", size: "DN100", sortOrder: 0 },
          { description: "Resilient seated gate valve, flanged", qty: 8, unit: "pcs", size: "DN150", sortOrder: 1 },
          { description: "Wafer butterfly valve, gear operated", qty: 6, unit: "pcs", size: "DN200", sortOrder: 2 },
        ],
      },
    },
  });

  for (const [i, b] of recipients.entries()) {
    await db.enquiryRecipient.create({
      data: {
        enquiryId: e1.id,
        businessId: b.id,
        state: i === 0 ? "quoted" : i === 1 ? "quoted" : "opened",
        openedAt: hours(-50 + i * 3),
        firstReplyAt: i < 2 ? hours(-48 + i * 5) : null,
        createdAt: hours(-52),
      },
    });
  }

  const first = recipients[0]!;
  const second = recipients[1]!;

  // Revision 1, superseded.
  await db.quote.create({
    data: {
      ref: "QT-8841-R1",
      enquiryId: e1.id,
      businessId: first.id,
      revision: 1,
      validityDays: 14,
      note: "Ex-stock for DN100. DN150 on a two week lead.",
      status: "sent",
      sentAt: hours(-44),
      readAt: hours(-41),
      createdAt: hours(-45),
      lines: {
        create: [
          { description: "Resilient seated gate valve DN100, flanged PN16", qty: 24, unitPrice: "410.00", leadTimeDays: 0, sortOrder: 0 },
          { description: "Resilient seated gate valve DN150, flanged PN16", qty: 8, unitPrice: "735.00", leadTimeDays: 14, sortOrder: 1 },
          { description: "Wafer butterfly valve DN200, gear operated", qty: 6, unitPrice: "980.00", leadTimeDays: 21, sortOrder: 2 },
        ],
      },
    },
  });

  // Revision 2, current. Same enquiry, same business, revision incremented.
  await db.quote.create({
    data: {
      ref: "QT-8841-R2",
      enquiryId: e1.id,
      businessId: first.id,
      revision: 2,
      validityDays: 10,
      note: "Revised after your call. DN150 pulled forward to seven days, DN200 unchanged.",
      status: "sent",
      sentAt: hours(-19),
      readAt: hours(-16),
      createdAt: hours(-20),
      lines: {
        create: [
          { description: "Resilient seated gate valve DN100, flanged PN16", qty: 24, unitPrice: "398.00", leadTimeDays: 0, sortOrder: 0 },
          { description: "Resilient seated gate valve DN150, flanged PN16", qty: 8, unitPrice: "712.00", leadTimeDays: 7, sortOrder: 1 },
          { description: "Wafer butterfly valve DN200, gear operated", qty: 6, unitPrice: "980.00", leadTimeDays: 21, sortOrder: 2 },
        ],
      },
    },
  });

  // A competing quote from the second recipient, so comparison has two sides.
  await db.quote.create({
    data: {
      ref: "QT-8841-B2R1",
      enquiryId: e1.id,
      businessId: second.id,
      revision: 1,
      validityDays: 21,
      note: "All three sizes ex-stock. Delivery within 48 hours of order.",
      status: "read",
      sentAt: hours(-30),
      readAt: hours(-28),
      createdAt: hours(-31),
      lines: {
        create: [
          { description: "Gate valve DN100 PN16, ductile iron", qty: 24, unitPrice: "435.00", leadTimeDays: 2, sortOrder: 0 },
          { description: "Gate valve DN150 PN16, ductile iron", qty: 8, unitPrice: "690.00", leadTimeDays: 2, sortOrder: 1 },
          { description: "Butterfly valve DN200, gear operated", qty: 6, unitPrice: "1015.00", leadTimeDays: 2, sortOrder: 2 },
        ],
      },
    },
  });

  await db.message.createMany({
    data: [
      { enquiryId: e1.id, businessId: first.id, senderId: buyerId, body: "Can you bring the DN150 lead time inside two weeks?", createdAt: hours(-24) },
      { enquiryId: e1.id, businessId: first.id, senderId: buyerId, body: "Also confirm WRAS certification on the DN100.", createdAt: hours(-23) },
    ],
  });

  // Enquiry two: closed and accepted, so the review gate has something to hang
  // on and the accepted-quote record has a subject.
  const e2 = await db.enquiry.create({
    data: {
      ref: "ENQ-8802",
      buyerId: buyerTwoId,
      requirement: "GI pipe, medium duty, for a fire ring main. Site collection from Sharjah.",
      deliverToArea: "Industrial Area 4",
      neededBy: days(-6),
      termsWanted: "advance",
      closesAt: days(-14),
      createdAt: days(-24),
      contactReleasedToBusinessId: recipients[2]!.id,
      lines: {
        create: [{ description: "GI pipe, medium duty, 6 m length", qty: 120, unit: "lengths", size: "DN80", sortOrder: 0 }],
      },
    },
  });

  await db.enquiryRecipient.createMany({
    data: [
      { enquiryId: e2.id, businessId: recipients[2]!.id, state: "quoted", openedAt: days(-23), firstReplyAt: days(-23), createdAt: days(-24) },
      { enquiryId: e2.id, businessId: recipients[0]!.id, state: "declined", openedAt: days(-23), createdAt: days(-24) },
    ],
  });

  await db.quote.create({
    data: {
      ref: "QT-8802-R1",
      enquiryId: e2.id,
      businessId: recipients[2]!.id,
      revision: 1,
      validityDays: 14,
      status: "accepted",
      sentAt: days(-23),
      readAt: days(-22),
      acceptedAt: days(-21),
      createdAt: days(-23),
      lines: { create: [{ description: "GI pipe DN80 medium duty, 6 m", qty: 120, unitPrice: "168.50", leadTimeDays: 3, sortOrder: 0 }] },
    },
  });

  /*
   * Link the quote lines above to the products they describe, where the seller
   * actually has one.
   *
   * `QuoteLine.productId` is what the pipeline counts to say "1 priced by
   * hand". Seeded with every line unlinked, every historical quote read as
   * entirely hand-priced and the number told a reviewer nothing. Rather than
   * hand-assign ids, the seed runs the same matcher the composer runs — so the
   * fixture cannot claim a match the product code would not make, and a line
   * with no match stays honestly unlinked.
   */
  await linkQuoteLinesToCatalogue(db, [first.id, second.id, recipients[2]!.id]);

  /*
   * Enquiry four: sent by a buyer with no account.
   *
   * The provisional identity the README asks for — "capture mobile, create a
   * lightweight identity, let them claim it later" — with a fixed claim token
   * so the tracking, compare and accepted pages are reachable in a test
   * without signing anybody in. The token is a bearer secret in production and
   * a fixture here; it is only ever good for this one buyer's enquiries.
   */
  const anon = await db.user.create({
    data: {
      id: uuid(900),
      phone: "+971544120087",
      fullName: "Khalid Al Nuaimi",
      roles: [],
      isProvisional: true,
      claimToken: PROVISIONAL_CLAIM_TOKEN,
    },
  });

  const e4 = await db.enquiry.create({
    data: {
      // A fixed id, so a browser test can reach this enquiry without an API
      // route that exists only for tests. Every other enquiry keeps its cuid.
      id: PROVISIONAL_ENQUIRY_ID,
      ref: "ENQ-8871",
      buyerId: anon.id,
      requirement:
        "Butterfly valves and a strainer for a pump room at a district cooling plant. Flanged PN16. Site is Mussafah, one delivery.",
      deliverToArea: "Mussafah Industrial",
      neededBy: days(24),
      termsWanted: "net_30",
      closesAt: days(5),
      createdAt: hours(-30),
      lines: {
        create: [
          { description: "Wafer butterfly valve, gear operated", qty: 12, unit: "pcs", size: "DN200", targetUnitPriceAed: "880.00", sortOrder: 0 },
          { description: "Cast iron Y-strainer, flanged", qty: 4, unit: "pcs", size: "DN100", targetUnitPriceAed: "320.00", sortOrder: 1 },
        ],
      },
    },
  });

  // Five recipients, two of whom quote. The shape the step 3 checkpoint walks.
  const anonRecipients = claimed.filter((b) => b.categorySlug === "valves-and-fittings").slice(0, 5);
  for (const [i, b] of anonRecipients.entries()) {
    await db.enquiryRecipient.create({
      data: {
        enquiryId: e4.id,
        businessId: b.id,
        state: i < 2 ? "quoted" : i === 2 ? "opened" : "delivered",
        openedAt: i < 3 ? hours(-28 + i) : null,
        firstReplyAt: i < 2 ? hours(-26 + i) : null,
        createdAt: hours(-30),
      },
    });
  }

  for (const [i, b] of anonRecipients.slice(0, 2).entries()) {
    const mark = b.slug.replace(/[^a-z]/g, "").slice(0, 3).toUpperCase();
    await db.quote.create({
      data: {
        ref: `QT-8871-${mark}R1`,
        enquiryId: e4.id,
        businessId: b.id,
        revision: 1,
        validityDays: 14,
        status: "sent",
        note: i === 0 ? "Both ex-stock. Delivery within 48 hours." : "Strainer to order, three weeks.",
        sentAt: hours(-26 + i),
        expiresAt: days(14 - i),
        createdAt: hours(-26 + i),
        lines: {
          create: [
            { description: "Wafer butterfly valve DN200, gear operated", qty: 12, unitPrice: i === 0 ? "935.00" : "902.00", leadTimeDays: i === 0 ? 2 : 21, sortOrder: 0 },
            { description: "Cast iron Y-strainer DN100, flanged", qty: 4, unitPrice: i === 0 ? "340.00" : "358.00", leadTimeDays: i === 0 ? 2 : 21, sortOrder: 1 },
          ],
        },
      },
    });
  }

  /*
   * Enquiry three: a live lead nobody has answered yet, and the subject of the
   * handoff 2 step 1 checkpoint — a quote with a matched line and an unmatched
   * line flagged for manual pricing.
   *
   * Two of the three lines are derived from what the first recipient actually
   * stocks, read back out of the database rather than hardcoded. A fixture that
   * hardcodes a product name proves the matcher can find a string somebody
   * already wrote twice. Reading the catalogue proves it against whatever the
   * seed happened to generate, and it stays true when the catalogue changes.
   *
   * The third line is the one nothing can match, and it is not invented for the
   * occasion: `api 6d trunnion ball valve dn600` is already seeded as a
   * zero-result search query. The search that found nothing becomes the enquiry
   * line that has to be priced by hand, which is exactly how it happens.
   */
  const stocked = await db.product.findMany({
    where: { businessId: first.id },
    select: { name: true, specValues: true },
    orderBy: { name: "asc" },
  });

  /** `Resilient seated gate valve DN100` -> `DN100`. */
  const boreOf = (name: string): string | null => /\b(DN\d{2,4})\b/.exec(name)?.[1] ?? null;

  /*
   * A buyer's target price, per unit, from the bore.
   *
   * Fitted through the two prices already quoted in this seed — DN100 at 398
   * and DN150 at 712 — then taken down six per cent, because a target the
   * buyer expects to be met is not a target. The curve is quadratic because
   * valve price follows the body casting, and a casting follows area.
   */
  const targetForBore = (bore: string): string => {
    const dn = Number(bore.replace(/\D/g, ""));
    const quoted = 0.0153333 * dn * dn + 2.44667 * dn;
    return `${Math.round((quoted * 0.94) / 5) * 5}.00`;
  };

  /** A buyer writes a line in sentence case, not in a catalogue's title case. */
  const asBuyerWroteIt = (productName: string, strip: RegExp): string => {
    const text = productName.replace(strip, "").trim().toLowerCase();
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  const metricPick = stocked.find((p) => boreOf(p.name) !== null);
  const imperialPick = stocked.find((p) => /\d+"/.test(p.name));

  const derivedLines: {
    description: string;
    qty: number;
    unit: string;
    size: string;
    targetUnitPriceAed: string;
    sortOrder: number;
  }[] = [];

  if (metricPick) {
    const bore = boreOf(metricPick.name)!;
    derivedLines.push({
      // The buyer's own words for it, not the seller's product name. Nobody
      // types a supplier's SKU description into an enquiry.
      description: asBuyerWroteIt(metricPick.name, new RegExp(`\\s*${bore}$`)),
      qty: 40,
      unit: "pcs",
      size: bore,
      targetUnitPriceAed: targetForBore(bore),
      sortOrder: derivedLines.length,
    });
  }

  if (imperialPick) {
    // The same seller catalogued this one in inches. The buyer writes the
    // metric name for the same bore, so the match has to cross the unit.
    const inch = /(\d+)"/.exec(imperialPick.name)?.[1];
    const metricName = inch ? INCH_TO_DN[`${inch}"`] : undefined;
    derivedLines.push({
      description: asBuyerWroteIt(imperialPick.name, /\s*\d+"\s*$/),
      qty: 12,
      unit: "pcs",
      size: metricName ?? '4"',
      targetUnitPriceAed: targetForBore(metricName ?? "DN100"),
      sortOrder: derivedLines.length,
    });
  }

  derivedLines.push({
    description: "API 6D trunnion mounted ball valve, full bore, fire safe, flanged RF",
    qty: 4,
    unit: "pcs",
    size: "DN600",
    /*
     * Off the curve on purpose. A trunnion mounted API 6D ball valve is a
     * different class of thing from a cast iron gate valve of the same bore —
     * forged body, fire-safe seats, a test certificate per unit — and the
     * curve above would price it like a casting. This is what a buyer
     * budgeting for one actually writes down.
     */
    targetUnitPriceAed: "18500.00",
    sortOrder: derivedLines.length,
  });

  const e3 = await db.enquiry.create({
    data: {
      ref: "ENQ-8863",
      buyerId,
      buyerCompanyId,
      requirement:
        "Isolation valves for a pump room upgrade at a district cooling plant. Two sizes off the shelf, plus one large trunnion ball valve for the header. Site is Mussafah, delivery in two drops.",
      deliverToArea: "Mussafah Industrial",
      neededBy: days(31),
      termsWanted: "net_30",
      closesAt: days(6),
      createdAt: hours(-5),
      lines: { create: derivedLines },
    },
  });

  // Delivered and unopened to the seller we act as, so the leads inbox opens on
  // a lead that has genuinely not been answered and the response clock is live.
  await db.enquiryRecipient.create({
    data: { enquiryId: e3.id, businessId: first.id, state: "delivered", createdAt: hours(-5) },
  });
  for (const b of recipients.slice(1)) {
    await db.enquiryRecipient.create({
      data: { enquiryId: e3.id, businessId: b.id, state: "opened", openedAt: hours(-3), createdAt: hours(-5) },
    });
  }

  /*
   * Enquiry five: the same account-less buyer, already accepted and not yet
   * reviewed. ENQ-8871 has to stay unaccepted so the compare screen has accept
   * buttons to show, and the review flow has to start from an accepted quote —
   * so they are two enquiries rather than one that cannot be both.
   */
  const e5 = await db.enquiry.create({
    data: {
      id: PROVISIONAL_ACCEPTED_ENQUIRY_ID,
      ref: "ENQ-8879",
      buyerId: anon.id,
      requirement: "Gate valves and a strainer for a pump room, delivered to Mussafah.",
      deliverToArea: "Mussafah Industrial",
      closesAt: days(-2),
      createdAt: days(-20),
      contactReleasedToBusinessId: anonRecipients[0]!.id,
      contactReleasedAt: days(-12),
      lines: {
        create: [
          { description: "Resilient seated gate valve, flanged", qty: 8, unit: "pcs", size: "DN100", sortOrder: 0 },
        ],
      },
      recipients: {
        create: [{ businessId: anonRecipients[0]!.id, state: "quoted", openedAt: days(-19), firstReplyAt: days(-19) }],
      },
    },
  });

  await db.quote.create({
    data: {
      ref: "QT-8879-R1",
      enquiryId: e5.id,
      businessId: anonRecipients[0]!.id,
      revision: 1,
      validityDays: 14,
      status: "accepted",
      note: "Ex-stock, delivery within 48 hours.",
      sentAt: days(-19),
      readAt: days(-18),
      acceptedAt: days(-12),
      expiresAt: days(-5),
      createdAt: days(-19),
      lines: {
        create: [
          { description: "Resilient seated gate valve DN100, flanged PN16", qty: 8, unitPrice: "402.00", leadTimeDays: 2, sortOrder: 0 },
        ],
      },
    },
  });

  return { e1, e2, e3, accepted: recipients[2]!, buyerTwoId };
}

/**
 * Run the quote-line matcher over already-seeded quotes and attach product ids.
 *
 * Mirrors lib/db/queries/seller.ts: the same nominal-size read out of the spec
 * JSON, the same matcher, the same floor.
 */
async function linkQuoteLinesToCatalogue(db: Db, businessIds: string[]) {
  for (const businessId of businessIds) {
    const products = await db.product.findMany({
      where: { businessId },
      select: { id: true, name: true, sku: true, searchText: true, specValues: true, availability: true, stockQty: true, leadTimeDays: true, minOrderQty: true },
    });
    const catalogue = products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      searchText: p.searchText ?? "",
      size: nominalSizeOf(p.specValues),
      availability: p.availability,
      stockQty: p.stockQty,
      leadTimeDays: p.leadTimeDays,
      minOrderQty: p.minOrderQty,
    }));
    if (catalogue.length === 0) continue;

    const lines = await db.quoteLine.findMany({
      where: { quote: { businessId }, productId: null },
      select: { id: true, description: true },
    });

    for (const line of lines) {
      // The size is written into the description on a quote line, so the
      // matcher reads it from there rather than from a separate column.
      const size = /\bDN\d{2,4}\b/.exec(line.description)?.[0] ?? null;
      const { best } = matchLine({ description: line.description, size }, catalogue);
      if (best) await db.quoteLine.update({ where: { id: line.id }, data: { productId: best.product.id } });
    }
  }
}

/** The nominal bore out of a product's spec JSON, keyed by SpecField id. */
function nominalSizeOf(specValues: unknown): string | null {
  if (!specValues || typeof specValues !== "object") return null;
  for (const value of Object.values(specValues as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    if (/^(dn\s?\d+|\d+(?:[.-]\d+(?:\/\d+)?)?\s*(?:"|\u2033|in|inch|inches))$/i.test(value.trim())) {
      return value.trim();
    }
  }
  return null;
}

/**
 * Past enquiries, so response time has something real to measure.
 *
 * Every claimed business needs at least MIN_SAMPLE answered enquiries inside
 * the ninety-day window or its median is honestly null — and a directory whose
 * every supplier reads "not enough enquiries to measure" teaches a reviewer
 * nothing about the state it is meant to show.
 *
 * Latencies are drawn per business from a fixed profile, so the bands are all
 * represented: some suppliers answer inside the hour, some take a day, and the
 * storefront shows green, amber and red rather than one colour.
 */
async function seedReplyHistory(db: Db, businesses: Biz[], buyerId: string) {
  console.log("→ reply history");
  const claimed = businesses.filter((b) => b.claim === "claimed");
  if (claimed.length === 0) return;

  // Who could have sent each reply. Seeded by seedSellerAccounts, which runs
  // first — a reply from nobody is what this whole block exists to stop.
  const team = new Map<string, string[]>();
  for (const member of await db.user.findMany({
    where: { businessId: { in: claimed.map((b) => b.id) } },
    select: { id: true, businessId: true },
  })) {
    if (!member.businessId) continue;
    const list = team.get(member.businessId) ?? [];
    list.push(member.id);
    team.set(member.businessId, list);
  }

  // Minutes to first reply. Index into this by position, so the fixed PRNG
  // gives the same supplier the same character every run.
  const PROFILES: readonly number[][] = [
    [18, 25, 40, 32, 22], // fast: well under two hours
    [45, 90, 70, 110, 65], // fast to moderate
    [150, 210, 190, 260, 175], // moderate: two to six hours
    [400, 520, 460, 610, 480], // slow: beyond six
    [55, 75, 240, 95, 80], // mostly fast, one bad day
  ];

  let created = 0;
  for (const [i, business] of claimed.entries()) {
    /*
     * One claimed, published supplier is left with no history, so the
     * unmeasured state has a public example. It is the state a new listing is
     * in on its first day, and a directory where every supplier already has a
     * number never shows a reviewer what that looks like.
     */
    if (i === 1) continue;

    const profile = PROFILES[i % PROFILES.length]!;
    for (const [j, minutes] of profile.entries()) {
      // Spread across the window so all of them are inside ninety days.
      const deliveredAt = days(-(6 + j * 11 + (i % 5)));
      const enquiry = await db.enquiry.create({
        data: {
          ref: `ENQ-H${String(i).padStart(2, "0")}${j}`,
          buyerId,
          requirement: "Historical enquiry, kept so response time has something to measure.",
          closesAt: new Date(deliveredAt.getTime() + 7 * 86_400_000),
          createdAt: deliveredAt,
          lines: { create: [{ description: "Valves, assorted", qty: 10, sortOrder: 0 }] },
        },
        select: { id: true },
      });
      const repliedAt = new Date(deliveredAt.getTime() + minutes * 60_000);

      await db.enquiryRecipient.create({
        data: {
          enquiryId: enquiry.id,
          businessId: business.id,
          state: "quoted",
          createdAt: deliveredAt,
          openedAt: new Date(deliveredAt.getTime() + minutes * 30_000),
          firstReplyAt: repliedAt,
        },
      });

      /*
       * The reply that stamped it.
       *
       * In production `firstReplyAt` is set *by* a message or a quote — see
       * lib/messaging/service.ts. Writing the timestamp with neither behind it
       * left 72 recipients claiming a reply that no person had sent, so board
       * 7d's per-person figures had nothing to attribute and every seat read
       * "not enough replies yet" under a business median of 32 minutes.
       *
       * Alternated between the seats so the owner is measurably slower on some
       * accounts, which is the uncomfortable number the board asks for and not
       * one worth faking in only one direction.
       */
      const seats = team.get(business.id) ?? [];
      const sender = seats.length > 0 ? seats[(j + (i % 2)) % seats.length]! : null;
      if (sender) {
        await db.message.create({
          data: {
            enquiryId: enquiry.id,
            businessId: business.id,
            senderId: sender,
            body: "Thanks for the enquiry — sending our quote across now.",
            createdAt: repliedAt,
          },
        });
      }

      created += 1;
    }
  }
  console.log(`   ${created} answered enquiries across ${claimed.length} businesses`);
}

/** The slug board 11a is demonstrated on. Free plan, and deliberately at its cap. */
const FREE_AT_CAP_SLUG = "al-manara-equipment-trading-llc";

/**
 * A free-plan supplier who has used their three enquiries and is still being
 * matched. Acceptance criterion 5 is about what that seller is shown.
 *
 * The rows are consistent with the rule rather than a picture of it. The three
 * received enquiries are created first and counted; only if the count really
 * has reached the plan's `enquiriesPerMonth` are the missed ones written. A
 * fixture that claims a cap was hit while the recipient count says otherwise is
 * how a screen ends up arguing from a number nothing produced — which is the
 * mistake handoff 2 caught in `responseTimeMedianMs`.
 *
 * Dated inside the current month on purpose: the panel resets on the 1st, so a
 * fixture pinned to a fixed day would empty itself as the month turned.
 */
async function seedAtMonthlyCap(db: Db, businesses: Biz[], buyerId: string) {
  console.log("→ a free seller at their monthly cap");
  const business = businesses.find((b) => b.slug === FREE_AT_CAP_SLUG);
  if (!business) throw new Error(`the seed has no business ${FREE_AT_CAP_SLUG}`);

  const plan = await db.plan.findUnique({
    where: { id: "free" },
    select: { enquiriesPerMonth: true },
  });
  const cap = plan?.enquiriesPerMonth;
  if (cap == null) throw new Error("the free plan has no monthly enquiry cap to reach");

  await db.business.update({ where: { id: business.id }, data: { planId: "free" } });

  // Early in the month, so they are inside the window wherever today falls.
  const monthStart = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1));
  const inMonth = (dayOfMonth: number, hour: number) => {
    const at = new Date(monthStart);
    at.setUTCDate(Math.min(dayOfMonth, NOW.getUTCDate()));
    at.setUTCHours(hour, 0, 0, 0);
    return at > NOW ? NOW : at;
  };

  /*
   * Clear the month first. seedReplyHistory spreads answered enquiries across
   * ninety days and some of them land in the current one, which left this
   * supplier holding eight received enquiries against a cap of three — the
   * board would have argued that a limit was reached while the counter beside
   * it said the limit had been passed five times over. Backdated, not deleted:
   * the response-time median is measured over ninety days and still wants them.
   */
  const movedOut = await db.enquiryRecipient.updateMany({
    where: { businessId: business.id, createdAt: { gte: monthStart } },
    data: { createdAt: new Date(monthStart.getTime() - 9 * 86_400_000) },
  });

  const RECEIVED = [
    "Gate valves and companion flanges for a pump room at a district cooling plant.",
    "Butterfly valves, lugged, for a chilled water riser in a Business Bay tower.",
    "Strainers and check valves for a villa community irrigation upgrade.",
  ].slice(0, cap);

  for (const [i, requirement] of RECEIVED.entries()) {
    const at = inMonth(2 + i * 2, 9 + i);
    const enquiry = await db.enquiry.create({
      data: {
        ref: `ENQ-CAP${i}`,
        buyerId,
        requirement,
        closesAt: new Date(at.getTime() + 7 * 86_400_000),
        createdAt: at,
        lines: { create: [{ description: "Valves, assorted", qty: 12 + i * 6, unit: "pcs", sortOrder: 0 }] },
      },
      select: { id: true },
    });
    await db.enquiryRecipient.create({
      data: { enquiryId: enquiry.id, businessId: business.id, state: "quoted", createdAt: at },
    });
  }

  const received = await db.enquiryRecipient.count({
    where: { businessId: business.id, createdAt: { gte: monthStart } },
  });
  if (received !== cap) {
    throw new Error(
      `${FREE_AT_CAP_SLUG} has ${received} enquiries this month and the free cap is ${cap}. ` +
        "The board argues from exactly that count, so a fixture that does not sit on it is " +
        "showing a limit the numbers beside it contradict.",
    );
  }

  // What arrived afterwards. Real requirements and real line items, because the
  // board's argument is "here is the work you did not get to see", and a row
  // reading "Historical enquiry" makes that argument badly.
  const MISSED: { requirement: string; area: string; lines: [string, number, string][] }[] = [
    {
      requirement: "Resilient seated gate valves DN150 for a pump room upgrade in Mussafah.",
      area: "Mussafah",
      lines: [["Resilient seated gate valve, flanged, DN150", 24, "pcs"], ["Companion flange, PN16", 48, "pcs"]],
    },
    {
      requirement: "Ductile iron butterfly valves and gearboxes for a chilled water plant retrofit.",
      area: "Al Quoz",
      lines: [["Butterfly valve, lugged, DN200", 16, "pcs"], ["Gearbox operator", 16, "pcs"]],
    },
    {
      requirement: "Stainless steel ball valves, 316, for a food processing line in KIZAD.",
      area: "KIZAD",
      lines: [["Ball valve, SS316, 2 inch, three piece", 40, "pcs"]],
    },
    {
      requirement: "Y-strainers and pressure gauges for a hotel plant room in Deira.",
      area: "Deira",
      lines: [["Y-strainer, cast iron, DN100", 12, "pcs"], ["Pressure gauge, 0-16 bar", 24, "pcs"]],
    },
  ];

  for (const [i, missed] of MISSED.entries()) {
    const at = inMonth(9 + i * 3, 10 + i);
    const enquiry = await db.enquiry.create({
      data: {
        ref: `ENQ-MISS${i}`,
        buyerId,
        requirement: missed.requirement,
        deliverToArea: missed.area,
        neededBy: new Date(at.getTime() + (10 + i * 4) * 86_400_000),
        // Two still open, two closed, so both states appear on the board.
        closesAt: new Date(at.getTime() + (i < 2 ? 21 : 3) * 86_400_000),
        createdAt: at,
        lines: {
          create: missed.lines.map(([description, qty, unit], j) => ({
            description,
            qty,
            unit,
            sortOrder: j,
          })),
        },
      },
      select: { id: true },
    });

    /*
     * The enquiry still went out — to other suppliers. Without a recipient the
     * board would be showing enquiries that reached nobody, which is a
     * different and much worse story than the one it is making.
     */
    const others = businesses.filter((b) => b.claim === "claimed" && b.id !== business.id).slice(0, 3);
    await db.enquiryRecipient.createMany({
      data: others.map((o) => ({ enquiryId: enquiry.id, businessId: o.id, createdAt: at })),
    });

    await db.missedEnquiry.create({
      data: {
        enquiryId: enquiry.id,
        businessId: business.id,
        reason: "at_monthly_cap",
        createdAt: at,
      },
    });
  }

  console.log(
    `   ${FREE_AT_CAP_SLUG}: ${received} received (cap ${cap}), ${MISSED.length} missed, ` +
      `${movedOut.count} earlier rows moved out of the month`,
  );
}

/**
 * The same pure function the job uses, over the seeded rows.
 *
 * Deliberately not a second implementation. A seed that computes a figure its
 * own way is a seed that disagrees with production the first time either one
 * changes, and the disagreement shows up as a screen nobody can reproduce.
 */
async function deriveProfileStrength(db: Db) {
  const { profileStrength } = await import("../lib/metrics/profile-strength.js");

  const businesses = await db.business.findMany({
    select: {
      id: true,
      description: true,
      establishedYear: true,
      teamSize: true,
      languages: true,
      categories: { select: { categoryId: true } },
      locations: { select: { hours: true } },
      _count: { select: { team: true, products: true } },
    },
  });

  const [products, media] = await Promise.all([
    db.product.findMany({ select: { businessId: true, specValues: true } }),
    db.media.findMany({
      where: { reviewId: null },
      select: { kind: true, businessId: true, product: { select: { businessId: true } } },
    }),
  ]);

  const photos = new Map<string, number>();
  const logos = new Set<string>();
  const covers = new Set<string>();
  for (const m of media) {
    const owner = m.businessId ?? m.product?.businessId;
    if (!owner) continue;
    photos.set(owner, (photos.get(owner) ?? 0) + 1);
    if (m.kind === "logo") logos.add(owner);
    if (m.kind === "cover") covers.add(owner);
  }

  const withSpecs = new Map<string, number>();
  for (const p of products) {
    const values = p.specValues as Record<string, unknown> | null;
    if (!values || Object.keys(values).length === 0) continue;
    withSpecs.set(p.businessId, (withSpecs.get(p.businessId) ?? 0) + 1);
  }

  for (const b of businesses) {
    const score = profileStrength({
      hasDescription: (b.description ?? "").trim().length > 0,
      hasLogo: logos.has(b.id),
      hasCover: covers.has(b.id),
      additionalCategories: b.categories.length,
      hasEstablishedYear: b.establishedYear !== null,
      hasTeamSize: b.teamSize !== null,
      languages: b.languages.length,
      locations: b.locations.length,
      locationsWithHours: b.locations.filter(
        (l) => typeof l.hours === "object" && l.hours !== null && Object.keys(l.hours).length > 0,
      ).length,
      products: b._count.products,
      productsWithFilterableSpecs: withSpecs.get(b.id) ?? 0,
      photos: photos.get(b.id) ?? 0,
      teamSeats: b._count.team,
    });
    await db.business.update({ where: { id: b.id }, data: { profileStrength: score } });
  }
}

/** The job's own functions, so the seed and production cannot disagree. */
async function deriveResponseTimes(db: Db) {
  const since = windowStart(NOW);
  const rows = await db.enquiryRecipient.findMany({
    where: { createdAt: { gte: since }, business: { claimStatus: "claimed", suspendedAt: null } },
    select: { businessId: true, createdAt: true, firstReplyAt: true },
  });

  const byBusiness = new Map<string, { deliveredAt: Date; firstReplyAt: Date | null }[]>();
  for (const row of rows) {
    const list = byBusiness.get(row.businessId) ?? [];
    list.push({ deliveredAt: row.createdAt, firstReplyAt: row.firstReplyAt });
    byBusiness.set(row.businessId, list);
  }

  let measured = 0;
  for (const [businessId, observations] of byBusiness) {
    const median = medianResponseMs(observations);
    await db.business.update({
      where: { id: businessId },
      data: { responseTimeMedianMs: median, derivedAt: NOW },
    });
    if (median !== null) measured += 1;
  }
  console.log(`   ${measured} of ${byBusiness.size} businesses have a measurable reply time`);
}

async function seedCommercials(db: Db, businesses: Biz[]) {
  console.log("→ subscriptions, placements, invoices");
  const paying = businesses.filter((b) => b.claim === "claimed").slice(0, 12);

  for (const [i, b] of paying.entries()) {
    const planId = i < 3 ? "pro" : i < 8 ? "basic" : "free";
    if (planId === "free") continue;

    await db.subscription.create({
      data: {
        businessId: b.id,
        planId,
        status: i === 7 ? "past_due" : "active",
        startedAt: days(-int(60, 700)),
        renewsAt: days(int(2, 30)),
        entitlementSnapshot: { planId, capturedAt: NOW.toISOString() },
      },
    });

    const amount = planId === "pro" ? 899 : 349;
    await db.invoice.create({
      data: {
        ref: `INV-${2600 + i}`,
        businessId: b.id,
        vatRate: "0.0500",
        status: i === 7 ? "overdue" : "paid",
        issuedAt: days(-int(3, 40)),
        dueAt: days(i === 7 ? -6 : 12),
        paidAt: i === 7 ? null : days(-int(1, 30)),
        lines: {
          create: [
            { kind: "subscription", description: `${planId === "pro" ? "Pro" : "Basic"} plan, monthly`, qty: 1, amountAed: String(amount) },
          ],
        },
      },
    });
  }

  // Sponsored placement. One per results page, always labelled, and it never
  // outranks a verified supplier on a filter the buyer explicitly set.
  const sponsor = paying[0]!;
  await db.placementSlot.create({
    data: {
      businessId: sponsor.id,
      categoryId: (await db.business.findUniqueOrThrow({ where: { id: sponsor.id }, select: { primaryCategoryId: true } })).primaryCategoryId,
      emirate: "dubai",
      monthlyPriceAed: 1200,
      startsOn: days(-20),
      endsOn: days(40),
    },
  });

  // A subscription credit, as an invoice line. Never a refund of buyer money —
  // there is no buyer money on the platform.
  const credited = paying[1]!;
  await db.invoice.create({
    data: {
      ref: "INV-2699",
      businessId: credited.id,
      vatRate: "0.0500",
      status: "issued",
      issuedAt: days(-2),
      dueAt: days(28),
      lines: {
        create: [
          { kind: "subscription", description: "Pro plan, monthly", qty: 1, amountAed: "899.00" },
          { kind: "subscription_credit", description: "Credit, four days of downtime in July", qty: 1, amountAed: "-119.87" },
        ],
      },
    },
  });
}

async function seedTrust(db: Db, businesses: Biz[], opsLeadId: string, moderatorId: string, buyerId: string) {
  console.log("→ reviews, reports, audit");
  const claimed = businesses.filter((b) => b.claim === "claimed");

  // A review needs a confirmed enquiry. Only the accepted enquiry qualifies, so
  // there is exactly one honest review in the set — which is what a young
  // directory actually looks like, and the empty state has to hold up.
  const acceptedEnquiry = await db.enquiry.findUniqueOrThrow({ where: { ref: "ENQ-8802" } });
  const acceptedQuote = await db.quote.findUniqueOrThrow({ where: { ref: "QT-8802-R1" } });

  await db.review.create({
    data: {
      businessId: acceptedQuote.businessId,
      buyerId: acceptedEnquiry.buyerId,
      enquiryId: acceptedEnquiry.id,
      overall: 4,
      quotedAccurate: 5,
      onTime: 4,
      asDescribed: 4,
      responsiveness: 3,
      body: "Quoted within the day and the price held. Delivery slipped by one day against the three quoted, which we were told about in advance.",
      showCompanyName: true,
      editableUntil: days(-7),
      sellerReply: "Thank you. The delay was our transport contractor and we have changed it since.",
      sellerRepliedAt: days(-18),
      createdAt: days(-21),
    },
  });

  // A removed review, with its reason — the constraint refuses one without.
  const removalTarget = claimed[3]!;
  const spareEnquiry = await db.enquiry.create({
    data: {
      ref: "ENQ-8790",
      buyerId,
      requirement: "Cable tray and accessories for a fit-out.",
      closesAt: days(-30),
      createdAt: days(-45),
    },
  });
  await db.enquiryRecipient.create({
    data: { enquiryId: spareEnquiry.id, businessId: removalTarget.id, state: "quoted", firstReplyAt: days(-44), createdAt: days(-45) },
  });
  await db.review.create({
    data: {
      businessId: removalTarget.id,
      buyerId,
      enquiryId: spareEnquiry.id,
      overall: 1,
      quotedAccurate: 1,
      onTime: 1,
      asDescribed: 1,
      responsiveness: 1,
      body: "Removed by moderation.",
      editableUntil: days(-31),
      removedAt: days(-28),
      removalReason: "Review integrity: posted from an account with no enquiry history and matching text on three other listings.",
      createdAt: days(-44),
    },
  });

  await db.supplierReport.createMany({
    data: [
      {
        subjectBusinessId: claimed[5]!.id,
        reporterId: buyerId,
        kind: "wrong_details",
        subjectField: "phone",
        detail: "Landline is disconnected. Reached them on the mobile instead.",
        createdAt: days(-5),
      },
      {
        subjectBusinessId: claimed[6]!.id,
        reporterId: null,
        kind: "off_platform_payment",
        detail: "Asked for a bank transfer to an account in a different name, off the thread.",
        outcome: "upheld",
        outcomeReason: "IBAN pattern confirmed in the message body. Listing suspended pending a call with the owner.",
        resolvedAt: days(-3),
        createdAt: days(-4),
      },
      {
        subjectBusinessId: claimed[7]!.id,
        reporterId: buyerId,
        kind: "closed",
        subjectField: "location",
        detail: "Unit is empty. Neighbour says they moved out in June.",
        outcome: "seller_corrected",
        outcomeReason: "Seller updated the address to Ras Al Khor and confirmed with a tenancy contract.",
        resolvedAt: days(-9),
        createdAt: days(-12),
      },
    ],
  });

  // Every staff state change above has an audit row with a written reason.
  await db.auditEvent.createMany({
    data: [
      {
        actorId: opsLeadId,
        action: "tier_change",
        subject: `Business:${claimed[0]!.id}`,
        reason: "Site visit completed on 2 Aug. Stock and trade counter confirmed, promoted to tier 3.",
        before: { verificationTier: 2 },
        after: { verificationTier: 3 },
        createdAt: days(-12),
      },
      {
        /*
         * Ops lead, not the moderator this used to name. §07 holds
         * `review.remove` at ops lead alone — a moderator may reject a
         * submission and resolve a report but may not remove a buyer's
         * published words. The fixture predates the matrix correction and
         * quietly showed a moderator doing something the matrix forbids.
         */
        actorId: opsLeadId,
        action: "review_removed",
        subject: `Business:${removalTarget.id}`,
        reason: "Review integrity: posted from an account with no enquiry history and matching text on three other listings.",
        before: { removedAt: null },
        after: { removedAt: days(-28).toISOString() },
        createdAt: days(-28),
      },
      {
        actorId: moderatorId,
        action: "report_resolved",
        subject: `Business:${claimed[6]!.id}`,
        reason: "IBAN pattern confirmed in the message body. Upheld and escalated to ops.",
        after: { outcome: "upheld" },
        createdAt: days(-3),
      },
      {
        actorId: opsLeadId,
        action: "suspend",
        subject: `Business:${claimed[6]!.id}`,
        reason: "Off-platform payment upheld. Suspended pending a call with the licence holder.",
        before: { suspendedAt: null },
        after: { suspendedAt: days(-3).toISOString() },
        createdAt: days(-3),
      },
      {
        actorId: opsLeadId,
        action: "view_as",
        subject: `Business:${claimed[2]!.id}`,
        reason: "Support ticket 8841: seller reports their catalogue is not showing on the category page.",
        createdAt: days(-1),
      },
    ],
  });

  await db.business.update({
    where: { id: claimed[6]!.id },
    data: { suspendedAt: days(-3) },
  });
}

async function seedSignals(db: Db, businesses: Biz[], buyerId: string, catBySlug: Map<string, string>) {
  console.log("→ reveals, zero-result queries, saved searches");
  const claimed = businesses.filter((b) => b.claim === "claimed");

  const reveals: { actorId: string | null; businessId: string; channel: "phone" | "whatsapp" | "email" | "website"; surface: string; createdAt: Date }[] = [];
  for (let i = 0; i < 60; i += 1) {
    const b = pick(claimed);
    reveals.push({
      // Most reveals happen before signup. That is the point of counting them.
      actorId: rnd() < 0.25 ? buyerId : null,
      businessId: b.id,
      channel: pick(["phone", "phone", "phone", "whatsapp", "whatsapp", "website"]),
      surface: pick(["storefront", "storefront", "search_results", "category"]),
      createdAt: hours(-int(1, 700)),
    });
  }
  await db.contactReveal.createMany({ data: reveals });

  // These feed the admin gap report and the recruitment call list in handoff 4.
  // Nothing reads them yet; writing them now means the report has history the
  // day it ships.
  await db.zeroResultQuery.createMany({
    data: [
      { query: "api 6d trunnion ball valve dn600", categoryId: catBySlug.get("valves-and-fittings")!, emirate: "abu_dhabi", filters: { verificationTier: 3, availability: "in_stock" }, tab: "products", createdAt: hours(-4) },
      { query: "صمامات بوابة 12 انش", categoryId: catBySlug.get("valves-and-fittings")!, emirate: "dubai", filters: {}, tab: "products", createdAt: hours(-9) },
      { query: "cryogenic valve supplier", categoryId: null, emirate: "dubai", filters: { freeZone: true }, tab: "businesses", createdAt: hours(-26) },
      { query: "hdpe electrofusion fittings dn630", categoryId: catBySlug.get("pipes-and-tubing")!, emirate: "sharjah", filters: { verificationTier: 2 }, tab: "products", createdAt: hours(-31) },
      { query: "arc flash suit class 4", categoryId: catBySlug.get("safety-and-ppe")!, emirate: null, filters: {}, tab: "products", createdAt: hours(-52) },
    ],
  });

  await db.savedSearch.create({
    data: {
      userId: buyerId,
      name: "Gate valves DN100 in Dubai, verified",
      query: "gate valve DN100",
      filters: { emirate: "dubai", verificationTier: 2, availability: "in_stock" },
      alerts: true,
    },
  });
}

/**
 * Derived values are computed, never entered. In production these are jobs; here
 * they run once so the seeded directory is internally consistent — a rating that
 * matches its reviews, a response time that matches its reply timestamps.
 */
async function recomputeDerived(db: Db) {
  console.log("→ derived values");

  await db.$executeRawUnsafe(`
    update "business" b set
      "review_count" = coalesce(r.n, 0),
      "rating_overall" = r.avg
    from (
      select "business_id", count(*)::int as n, round(avg("overall")::numeric, 2)::float8 as avg
      from "review" where "removed_at" is null group by "business_id"
    ) r
    where r."business_id" = b."id";
  `);

  /*
   * Response time is derived here, by the same functions the scheduled job
   * uses — not invented at creation and not computed by a second hand-written
   * median that would drift from the first. Criterion 5 asks for measured,
   * never claimed, and a seed that claims one is a seed that has already
   * broken it.
   */
  await deriveResponseTimes(db);
  await deriveProfileStrength(db);

  await db.$executeRawUnsafe(`
    update "business" b set
      "quoted_value_aed" = q.total
    from (
      select qt."business_id", sum(ql."qty" * ql."unit_price")::numeric(14,2) as total
      from "quote" qt
      join "quote_line" ql on ql."quote_id" = qt."id"
      where qt."status" = 'accepted'
      group by qt."business_id"
    ) q
    where q."business_id" = b."id";
  `);

  await db.$executeRawUnsafe(`update "business" set "derived_at" = now();`);
}

main()
  .then(async () => {
    const counts = {
      businesses: await prisma.business.count(),
      claimed: await prisma.business.count({ where: { claimStatus: "claimed" } }),
      unclaimed: await prisma.business.count({ where: { claimStatus: "unclaimed" } }),
      locations: await prisma.location.count(),
      unpinned: await prisma.location.count({ where: { lat: null } }),
      products: await prisma.product.count(),
      enquiries: await prisma.enquiry.count(),
      quotes: await prisma.quote.count(),
      quoteLines: await prisma.quoteLine.count(),
      reviews: await prisma.review.count(),
      reports: await prisma.supplierReport.count(),
      changeRequests: await prisma.listingChangeRequest.count(),
      pendingChanges: await prisma.listingChangeRequest.count({ where: { status: "pending" } }),
      claims: await prisma.claimSubmission.count(),
      undecidedClaims: await prisma.claimSubmission.count({ where: { decidedAt: null } }),
      visitRequests: await prisma.siteVisitRequest.count(),
      auditEvents: await prisma.auditEvent.count(),
      contactReveals: await prisma.contactReveal.count(),
      zeroResults: await prisma.zeroResultQuery.count(),
    };
    console.log("\nseeded:");
    for (const [k, v] of Object.entries(counts)) console.log(`  ${String(v).padStart(4)}  ${k}`);
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });


// ─────────────────────────────────────────────────────────────────────────────
// Seller accounts
//
// Handoff 2 is explicit that onboarding and the claim flow are out of scope and
// the seller accounts should be seeded. Without them the leads inbox has nobody
// to belong to.
// ─────────────────────────────────────────────────────────────────────────────

async function seedSellerAccounts(db: Db, businesses: Biz[]) {
  console.log("→ seller accounts and alert preferences");
  const claimed = businesses.filter((b) => b.claim === "claimed");
  let seat = 100;

  for (const [i, b] of claimed.entries()) {
    const slugMark = b.slug.replace(/[^a-z]/g, "").slice(0, 12);

    await db.user.create({
      data: {
        id: uuid(seat++),
        phone: `+9715${(50 + (i % 9)) % 100}${String(1000000 + i * 7919).slice(0, 7)}`,
        email: `owner@${slugMark}.example`,
        fullName: "Owner",
        roles: ["seller_owner"],
        businessId: b.id,
      },
    });

    // A sales seat on the larger accounts, so the permission matrix has
    // something real to act on: sales can answer an enquiry and cannot touch
    // billing or the listing.
    if (i % 3 === 0) {
      await db.user.create({
        data: {
          id: uuid(seat++),
          phone: `+9715${(52 + (i % 7)) % 100}${String(2000000 + i * 6131).slice(0, 7)}`,
          fullName: "Sales",
          roles: ["seller_sales"],
          businessId: b.id,
        },
      });
    }

    await db.notificationPreference.create({
      data: {
        businessId: b.id,
        // Board 7e's matrix. WhatsApp carries the events that need a fast
        // reply; email carries the ones that need a record.
        routing: {
          enquiry_received: ["whatsapp", "in_app"],
          enquiry_unanswered: ["whatsapp", "in_app"],
          enquiry_escalated: ["whatsapp", "email", "in_app"],
          quote_accepted: ["whatsapp", "email", "in_app"],
          quote_expiring: ["in_app"],
          review_posted: ["email", "in_app"],
          document_expiring: ["email", "in_app"],
          weekly_digest: ["email"],
        },
        // A seller who never turns them off still gets no WhatsApp at 02:00.
        quietHoursEnabled: true,
        highValueOverrideAed: 50_000,
        nudgeEnabled: true,
        nudgeAfterHours: 24,
      },
    });
  }
  console.log(`   ${claimed.length} owners, ${Math.ceil(claimed.length / 3)} sales seats`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification templates
//
// Database records rather than code: handoff 4 gives admin an editor, and a
// WhatsApp template cannot change version without Meta approving it first.
//
// Not one of these may name a buyer's phone, email or company. Rule 1 applies
// to notifications, and this is the easiest place in the product to leak it.
// ─────────────────────────────────────────────────────────────────────────────

interface TemplateSeed {
  event: string;
  channel: string;
  subject?: string;
  body: string;
  actionLabel?: string;
  actionPath?: string;
  metaTemplateName?: string;
  status?: string;
}

const TEMPLATES: TemplateSeed[] = [
  {
    event: "enquiry_received",
    channel: "whatsapp",
    // Two taps from notification to a quote in progress. That deep link is the
    // mechanic behind the reply-speed number, so it carries the enquiry ref
    // and lands on the composer, not on a list.
    body: "New enquiry {ref} for {summary}. Needed by {neededBy} in {area}. {lineCount} lines. Quote before {closesAt}.",
    actionLabel: "Open and quote",
    actionPath: "/dashboard/leads/{enquiryId}/thread",
    metaTemplateName: "bl_enquiry_received_v1",
    status: "pending_meta",
  },
  {
    event: "enquiry_received",
    channel: "in_app",
    body: "New enquiry {ref} — {lineCount} lines for {area}, needed by {neededBy}.",
    actionLabel: "Open and quote",
    actionPath: "/dashboard/leads/{enquiryId}/thread",
    status: "live",
  },
  {
    event: "enquiry_unanswered",
    channel: "whatsapp",
    body: "Enquiry {ref} is still unanswered after {hours} hours. It closes {closesAt}.",
    actionLabel: "Quote now",
    actionPath: "/dashboard/leads/{enquiryId}/thread",
    metaTemplateName: "bl_enquiry_unanswered_v1",
    status: "pending_meta",
  },
  {
    event: "enquiry_escalated",
    channel: "email",
    subject: "Enquiry {ref} has gone unanswered",
    body: "Enquiry {ref} reached your team {hours} hours ago and has no reply. It closes {closesAt}. Median reply time is part of how suppliers rank in search.",
    actionLabel: "Open the enquiry",
    actionPath: "/dashboard/leads/{enquiryId}/thread",
    status: "live",
  },
  {
    // SMS is the fallback when WhatsApp does not deliver. Deliberately terse:
    // it is one segment, and a two-segment SMS to eight sellers a day is a
    // cost line nobody budgeted for.
    event: "enquiry_received",
    channel: "sms",
    body: "New enquiry {ref}, {lineCount} lines for {area}. Closes {closesAt}. Quote: {shortLink}",
    actionPath: "/dashboard/leads/{enquiryId}/thread",
    status: "live",
  },
  {
    event: "quote_accepted",
    channel: "sms",
    body: "Quote {quoteRef} accepted, {amount}. Contact details are on the enquiry: {shortLink}",
    actionPath: "/dashboard/leads/{enquiryId}/thread",
    status: "live",
  },
  {
    event: "quote_received",
    channel: "in_app",
    body: "{businessName} sent a quote on {ref}, revision {revision}.",
    actionLabel: "Compare quotes",
    actionPath: "/enquiry/{enquiryId}/compare",
    status: "live",
  },
  {
    event: "quote_revised",
    channel: "in_app",
    body: "{businessName} revised their quote on {ref} to revision {revision}.",
    actionLabel: "See what changed",
    actionPath: "/enquiry/{enquiryId}/thread/{businessSlug}",
    status: "live",
  },
  {
    event: "quote_accepted",
    channel: "whatsapp",
    // What happened, what it is worth, one action.
    body: "Your quote {quoteRef} was accepted, {amount}. The buyer's contact details are now on the enquiry.",
    actionLabel: "Open the accepted quote",
    actionPath: "/dashboard/leads/{enquiryId}/thread",
    metaTemplateName: "bl_quote_accepted_v1",
    status: "pending_meta",
  },
  {
    event: "quote_accepted",
    channel: "email",
    subject: "Quote {quoteRef} accepted — {amount}",
    body: "Your quote {quoteRef} for enquiry {ref} was accepted at {amount}. Contact details are on the enquiry page. Payment and delivery are between you and the buyer.",
    actionLabel: "Open the accepted quote",
    actionPath: "/dashboard/leads/{enquiryId}/thread",
    status: "live",
  },
  {
    event: "quote_expiring",
    channel: "in_app",
    body: "Quote {quoteRef} expires {expiresAt}. Extend the validity or let it lapse.",
    actionLabel: "Open the quote",
    actionPath: "/dashboard/quotes",
    status: "live",
  },
  {
    event: "review_posted",
    channel: "email",
    subject: "A review was posted on your listing",
    body: "A buyer left a {rating} out of 5 review after enquiry {ref}. You may reply once, and the reply cannot be edited afterwards.",
    actionLabel: "Read and reply",
    actionPath: "/dashboard/reviews",
    status: "live",
  },
  {
    event: "review_requested",
    channel: "in_app",
    body: "{businessName} asked for a review of enquiry {ref}.",
    actionLabel: "Write a review",
    actionPath: "/review/new?enq={enquiryId}",
    status: "live",
  },
  {
    event: "document_expiring",
    channel: "email",
    subject: "Your trade licence expires {expiresAt}",
    body: "The trade licence on your listing expires {expiresAt}. Verification drops to tier 2 the day it lapses, with no grace period.",
    actionLabel: "Upload the renewal",
    actionPath: "/dashboard/verification",
    status: "live",
  },
  {
    event: "weekly_digest",
    channel: "email",
    subject: "Your week: {enquiryCount} enquiries, {quoteCount} quotes",
    body: "{enquiryCount} enquiries reached you this week and you quoted {quoteCount}. Median reply time {medianReply}.",
    actionLabel: "Open the dashboard",
    actionPath: "/dashboard",
    status: "live",
  },
];

async function seedNotificationTemplates(db: Db) {
  console.log("→ notification templates");
  for (const template of TEMPLATES) {
    await db.notificationTemplate.create({
      data: {
        event: template.event as never,
        channel: template.channel as never,
        locale: "en",
        version: 1,
        status: (template.status ?? "live") as never,
        subject: template.subject ?? null,
        body: template.body,
        actionLabel: template.actionLabel ?? null,
        actionPath: template.actionPath ?? null,
        metaTemplateName: template.metaTemplateName ?? null,
      },
    });
  }
  console.log(`   ${TEMPLATES.length} templates`);
}


// ─────────────────────────────────────────────────────────────────────────────
// The admin queues
//
// Three tables handoff 3 fills at runtime and the seed did not, so a fresh
// database gave /admin/queue nothing to open on. Handoff 4 builds the screens
// that drain them, and a queue screen with no rows cannot be judged: the empty
// state and the populated one are different screens and both have to exist
// before either can be reviewed.
//
// Every status the enums allow appears at least once, and every decided row
// carries the audit event CLAUDE.md non-negotiable 3 requires — written by a
// role that actually holds the capability. `queue.decide` is moderator or ops
// lead, `claim.resolve` is ops lead alone, `visit.record` is ops lead or field
// officer. A fixture decided by the wrong role is a row the permission matrix
// forbids, sitting in the database as if it were normal.
//
// No PRNG in here. The generator is a sequence and every draw renames every
// business after it, so this data is either literal or read back from rows
// already written.
// ─────────────────────────────────────────────────────────────────────────────

async function seedQueues(
  db: Db,
  businesses: Biz[],
  catBySlug: Map<string, string>,
  opsLeadId: string,
  moderatorId: string,
) {
  console.log("→ admin queues: listing changes, claims, visit requests");

  const claimed = businesses.filter((b) => b.claim === "claimed");
  const disputed = businesses.filter((b) => b.claim === "disputed");
  const unclaimed = businesses.filter((b) => b.claim === "unclaimed");

  // Loud rather than short. Seeding four rows where fourteen were meant is the
  // kind of thing a queue screen hides well.
  if (claimed.length < 14 || disputed.length < 2 || unclaimed.length < 3) {
    throw new Error(
      `seedQueues expects 14 claimed, 2 disputed and 3 unclaimed businesses; got ${claimed.length}, ${disputed.length} and ${unclaimed.length}.`,
    );
  }

  const ownerOf = async (businessId: string) => {
    const owner = await db.user.findFirstOrThrow({
      where: { businessId, roles: { has: "seller_owner" } },
      select: { id: true },
    });
    return owner.id;
  };

  const facts = async (businessId: string) =>
    db.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { tradeName: true, licenceNumber: true, primaryCategoryId: true },
    });

  // ── Listing change requests ───────────────────────────────────────────────
  // All three moderated fields and all four statuses. `beforeValue` is read
  // from the row rather than invented, the same way lib/listing/service.ts
  // does it, so the queue shows a real diff.

  const renamePending = claimed[8]!;
  const licencePending = claimed[9]!;
  const categoryPending = claimed[10]!;
  const renameApproved = claimed[11]!;
  const licenceRejected = claimed[12]!;
  const categoryWithdrawn = claimed[13]!;

  const [f8, f9, f10, f11, f12, f13] = await Promise.all([
    facts(renamePending.id),
    facts(licencePending.id),
    facts(categoryPending.id),
    facts(renameApproved.id),
    facts(licenceRejected.id),
    facts(categoryWithdrawn.id),
  ]);

  const [o8, o9, o10, o11, o12, o13] = await Promise.all([
    ownerOf(renamePending.id),
    ownerOf(licencePending.id),
    ownerOf(categoryPending.id),
    ownerOf(renameApproved.id),
    ownerOf(licenceRejected.id),
    ownerOf(categoryWithdrawn.id),
  ]);

  // Same authority, new serial. A renewal changes the number, not who issued
  // it, and a queue that cannot see that is a queue that approves the wrong
  // thing.
  const renewed = (licenceNumber: string, serial: string) =>
    licenceNumber.replace(/-\d+$/, `-${serial}`);

  await db.listingChangeRequest.createMany({
    data: [
      {
        businessId: renamePending.id,
        actorId: o8,
        field: "trade_name",
        beforeValue: f8.tradeName,
        afterValue: "Al Sahra Industrial Supplies LLC",
        status: "pending",
        createdAt: days(-2),
      },
      {
        businessId: licencePending.id,
        actorId: o9,
        field: "licence",
        beforeValue: f9.licenceNumber,
        afterValue: renewed(f9.licenceNumber, "704118"),
        status: "pending",
        createdAt: days(-1),
      },
      {
        businessId: categoryPending.id,
        actorId: o10,
        field: "primary_category",
        beforeValue: f10.primaryCategoryId,
        afterValue: catBySlug.get("hvac-and-ventilation")!,
        status: "pending",
        createdAt: hours(-5),
      },
      {
        businessId: renameApproved.id,
        actorId: o11,
        field: "trade_name",
        beforeValue: f11.tradeName,
        afterValue: "Gulf Line Trading LLC",
        status: "approved",
        decisionReason:
          "Trade name on the DED licence reads Gulf Line Trading LLC. Amendment certificate attached to the submission matches.",
        decidedById: moderatorId,
        decidedAt: days(-6),
        createdAt: days(-8),
      },
      {
        businessId: licenceRejected.id,
        actorId: o12,
        field: "licence",
        beforeValue: f12.licenceNumber,
        afterValue: renewed(f12.licenceNumber, "552901"),
        status: "rejected",
        decisionReason:
          "The number submitted belongs to a different licence holder on the authority's register. Send the renewed licence itself and it goes through the same day.",
        decidedById: moderatorId,
        decidedAt: days(-4),
        createdAt: days(-5),
      },
      {
        // Withdrawn carries no reason and no decider: nobody looked at it.
        // The check constraint enforces that, and the seed is where it gets
        // proved against a real row rather than a unit test.
        businessId: categoryWithdrawn.id,
        actorId: o13,
        field: "primary_category",
        beforeValue: f13.primaryCategoryId,
        afterValue: catBySlug.get("safety-and-ppe")!,
        status: "withdrawn",
        createdAt: days(-11),
      },
    ],
  });

  // ── Claim submissions ─────────────────────────────────────────────────────
  // Both routes, and the route constraint means each has to carry its own
  // evidence: a licence claim needs the document, a phone claim needs the
  // number off the public licence record.

  const phoneClaimTarget = unclaimed[0]!;
  const licenceClaimTarget = unclaimed[1]!;
  const contestedTarget = disputed[0]!;
  const refusedTarget = disputed[1]!;
  const approvedTarget = claimed[1]!;

  /*
   * Claimants get 910+. Staff hold 1–4, buyers 10–11, seller seats run from
   * 100 upward as `seat++`, and the provisional buyer took 900 — which this
   * block collided with on the first run, because `uuid(n)` is deterministic
   * and a duplicate id is the only thing that catches it.
   */
  const claimantPhone = await db.user.create({
    data: {
      id: uuid(910),
      phone: "+971503318842",
      fullName: "Imran Sheikh",
      roles: ["buyer"],
    },
  });
  const claimantLicence = await db.user.create({
    data: {
      id: uuid(911),
      phone: "+971557740219",
      email: "accounts@midpointsupplies.example",
      fullName: "Nadia Kassem",
      roles: ["buyer"],
    },
  });
  const claimantContesting = await db.user.create({
    data: {
      id: uuid(912),
      phone: "+971506627035",
      fullName: "Bilal Haque",
      roles: ["buyer"],
    },
  });
  const claimantRefused = await db.user.create({
    data: {
      id: uuid(913),
      phone: "+971524409183",
      fullName: "Sanjay Menon",
      roles: ["buyer"],
    },
  });

  const licenceDoc = await db.document.create({
    data: {
      kind: "trade_licence",
      businessId: licenceClaimTarget.id,
      storagePath: `documents/${licenceClaimTarget.id}/trade-licence-2026.pdf`,
      filename: "trade-licence-2026.pdf",
      bytes: 412_774,
      mimeType: "application/pdf",
      createdAt: days(-3),
    },
  });

  const contestedDoc = await db.document.create({
    data: {
      kind: "trade_licence",
      businessId: contestedTarget.id,
      storagePath: `documents/${contestedTarget.id}/licence-scan.pdf`,
      filename: "licence-scan.pdf",
      bytes: 388_102,
      mimeType: "application/pdf",
      createdAt: days(-7),
    },
  });

  const approvedOwner = await ownerOf(approvedTarget.id);

  await db.claimSubmission.createMany({
    data: [
      {
        // Undecided sits at `unclaimed`: the submission has not moved the
        // listing yet. Nothing about the row says pending except the absence
        // of a decision, which is what the queue filters on.
        businessId: phoneClaimTarget.id,
        claimantId: claimantPhone.id,
        route: "phone_callback",
        phone: "+97143472290",
        createdAt: days(-1),
      },
      {
        businessId: licenceClaimTarget.id,
        claimantId: claimantLicence.id,
        route: "licence_upload",
        documentId: licenceDoc.id,
        createdAt: days(-3),
      },
      {
        // The state handoff 3 takes and handoff 4 resolves: somebody already
        // holds this listing and a second person says it is theirs. Taken
        // anyway, flagged, and staff see both sides.
        businessId: contestedTarget.id,
        claimantId: claimantContesting.id,
        route: "licence_upload",
        documentId: contestedDoc.id,
        contested: true,
        createdAt: days(-7),
      },
      {
        businessId: approvedTarget.id,
        claimantId: approvedOwner,
        route: "phone_callback",
        phone: "+97142678831",
        status: "claimed",
        decidedAt: days(-40),
        decisionReason:
          "Called the number on the DED record and reached the manager named on the licence. Ownership confirmed on the call.",
        createdAt: days(-42),
      },
      {
        businessId: refusedTarget.id,
        claimantId: claimantRefused.id,
        route: "phone_callback",
        phone: "+97165331074",
        contested: true,
        status: "disputed",
        decidedAt: days(-15),
        decisionReason:
          "Claimant could not name the licence holder and the number reached a different company. Listing stays with the existing holder; claimant told what evidence would change that.",
        createdAt: days(-18),
      },
    ],
  });

  // ── Site visit requests ───────────────────────────────────────────────────
  // Board 8e task 4. The seller asks; the tier only moves once somebody has
  // actually been, which is why the request and `Business.visitedAt` are
  // different columns.

  const visitAsked = claimed[2]!;
  const visitScheduled = claimed[4]!;
  const visitDone = claimed[5]!;
  const visitCancelled = claimed[7]!;

  const [v2, v4, v5, v7] = await Promise.all([
    ownerOf(visitAsked.id),
    ownerOf(visitScheduled.id),
    ownerOf(visitDone.id),
    ownerOf(visitCancelled.id),
  ]);

  await db.siteVisitRequest.createMany({
    data: [
      {
        businessId: visitAsked.id,
        requestedById: v2,
        preferredNote: "Any morning except Friday. Warehouse is open from 08:00.",
        createdAt: days(-2),
      },
      {
        businessId: visitScheduled.id,
        requestedById: v4,
        preferredNote: "Ramadan hours this month, so before 14:00 if possible.",
        scheduledFor: days(6),
        createdAt: days(-9),
      },
      {
        businessId: visitDone.id,
        requestedById: v5,
        preferredNote: "Trade counter and the yard behind it.",
        scheduledFor: days(-21),
        completedAt: days(-21),
        createdAt: days(-30),
      },
      {
        businessId: visitCancelled.id,
        requestedById: v7,
        preferredNote: "Second week of the month.",
        scheduledFor: days(-12),
        cancelledAt: days(-13),
        createdAt: days(-25),
      },
    ],
  });

  // ── The audit rows those decisions owe ────────────────────────────────────
  // Non-negotiable 3. Each action is written by a role that holds the
  // capability: queue.decide is moderator or ops lead, claim.resolve is ops
  // lead alone, visit.record is ops lead or field officer.

  await db.auditEvent.createMany({
    data: [
      {
        actorId: moderatorId,
        action: "queue_decided",
        subject: `ListingChangeRequest:${renameApproved.id}`,
        reason:
          "Trade name on the DED licence reads Gulf Line Trading LLC. Amendment certificate attached to the submission matches.",
        before: { tradeName: f11.tradeName },
        after: { tradeName: "Gulf Line Trading LLC" },
        createdAt: days(-6),
      },
      {
        actorId: moderatorId,
        action: "queue_decided",
        subject: `ListingChangeRequest:${licenceRejected.id}`,
        reason:
          "The number submitted belongs to a different licence holder on the authority's register. Rejected with the evidence that would change it.",
        before: { licenceNumber: f12.licenceNumber },
        after: { licenceNumber: f12.licenceNumber },
        createdAt: days(-4),
      },
      {
        actorId: opsLeadId,
        action: "claim_resolved",
        subject: `Business:${approvedTarget.id}`,
        reason:
          "Called the number on the DED record and reached the manager named on the licence. Ownership confirmed on the call.",
        before: { claimStatus: "unclaimed" },
        after: { claimStatus: "claimed" },
        createdAt: days(-40),
      },
      {
        actorId: opsLeadId,
        action: "claim_resolved",
        subject: `Business:${refusedTarget.id}`,
        reason:
          "Claimant could not name the licence holder and the number reached a different company. Listing stays with the existing holder.",
        before: { claimStatus: "disputed" },
        after: { claimStatus: "disputed" },
        createdAt: days(-15),
      },
      {
        // The field officer's own row. lib/auth/subject.ts reads exactly this
        // to decide whether they may then move the tier — a verifier can set a
        // tier only for a visit they recorded, so a visit with no recorder is
        // a tier nobody can move.
        actorId: uuid(3),
        action: "visit_recorded",
        subject: `Business:${visitDone.id}`,
        reason:
          "Attended the trade counter and the yard. Stock on the shelves matches the catalogue; counter staff present and selling.",
        after: { completedAt: days(-21).toISOString() },
        createdAt: days(-21),
      },
    ],
  });

  await db.business.update({
    where: { id: visitDone.id },
    data: { visitedAt: days(-21), visitedByStaffId: uuid(3) },
  });
}
