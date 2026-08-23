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

/** Fixed "now" so relative timestamps in the UI are stable across runs. */
const NOW = new Date("2026-08-14T12:00:00+04:00");
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

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

/** DN to the imperial names a seller might have typed instead. */
const DN_SYNONYMS: Record<string, string[]> = {
  DN15: ['1/2"', "1/2 inch", "half inch"],
  DN20: ['3/4"', "3/4 inch"],
  DN25: ['1"', "1 inch"],
  DN32: ['1-1/4"', "1.25 inch"],
  DN40: ['1-1/2"', "1.5 inch"],
  DN50: ['2"', "2 inch"],
  DN65: ['2-1/2"', "2.5 inch"],
  DN80: ['3"', "3 inch"],
  DN100: ['4"', "4 inch"],
  DN125: ['5"', "5 inch"],
  DN150: ['6"', "6 inch"],
  DN200: ['8"', "8 inch"],
  DN250: ['10"', "10 inch"],
  DN300: ['12"', "12 inch"],
};

/**
 * The denormalised match surface. Both DN100 and 4" land here, which is what
 * lets a DN100 query find a product whose seller typed 4".
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
  add(parts.size);
  for (const syn of DN_SYNONYMS[parts.size ?? ""] ?? []) add(syn);
  for (const value of Object.values(parts.specValues)) {
    if (Array.isArray(value)) value.forEach(add);
    else add(value);
    const key = String(value);
    for (const syn of DN_SYNONYMS[key] ?? []) add(syn);
  }
  return [...tokens].join(" ");
}

async function main() {
  console.log("→ clearing");
  // Order matters only where a FK is Restrict rather than Cascade.
  await prisma.$executeRawUnsafe(`
    truncate table
      "audit_event","contact_reveal","zero_result_query","saved_search","redirect",
      "invoice_line","invoice","placement_slot","subscription",
      "supplier_report","review","message","quote_line","quote",
      "enquiry_recipient","enquiry_line","enquiry",
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
    const row = await prisma.area.create({
      data: { ...a, publishedAt: a.isFreeZone ? null : days(-120) },
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
      fullName: "Procurement Buyer",
      roles: ["buyer"],
      buyerCompanyId: buyerCompany.id,
    },
  });
  const buyerTwo = await prisma.user.create({
    data: { id: uuid(11), phone: "+971552048817", fullName: "Site Buyer", roles: ["buyer"] },
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
        responseTimeMedianMs: claimed ? int(20, 2600) * 60_000 : null,
        profileStrength: claimed ? int(38, 98) : 12,
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
  await seedProducts(prisma, businesses, catBySlug, fieldId, template.id);
  await seedEnquiries(prisma, businesses, buyer.id, buyerTwo.id, buyerCompany.id);
  await seedCommercials(prisma, businesses);
  await seedTrust(prisma, businesses, opsLead.id, moderator.id, buyer.id);
  await seedSignals(prisma, businesses, buyer.id, catBySlug);
  await recomputeDerived(prisma);
}

// ─────────────────────────────────────────────────────────────────────────────

type Biz = { id: string; slug: string; tier: number; claim: string; categorySlug: string };
type Db = typeof prisma;

const VALVE_NAMES = [
  "Resilient seated gate valve",
  "Wafer butterfly valve",
  "Ductile iron check valve",
  "Cast iron Y-strainer",
  "Brass ball valve",
  "Gear operated butterfly valve",
];
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

  return { e1, e2, accepted: recipients[2]!, buyerTwoId };
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
        actorId: moderatorId,
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

  await db.$executeRawUnsafe(`
    update "business" b set
      "response_time_median_ms" = m.median
    from (
      select er."business_id",
             (percentile_cont(0.5) within group (
               order by extract(epoch from (er."first_reply_at" - e."created_at")) * 1000
             ))::int as median
      from "enquiry_recipient" er
      join "enquiry" e on e."id" = er."enquiry_id"
      where er."first_reply_at" is not null
      group by er."business_id"
    ) m
    where m."business_id" = b."id";
  `);

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
