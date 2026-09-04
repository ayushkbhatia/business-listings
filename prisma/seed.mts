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
import { assertLocalTarget, NonLocalTargetError } from "../lib/db/target.js";
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
import { DN_SYNONYMS } from "../lib/trade/nominal-size.js";
// The key and the estimates from the module that owns both — a typo here would
// be a row nothing reads.
import { FALLBACK_RAMADAN, RAMADAN_SETTING_KEY } from "../lib/trade/hours.js";
// Board 8a's site-visit fee, on the same terms. `lib/setup/tasks.ts` is pure —
// no `server-only`, no database client — which is what lets a seed run by plain
// tsx read the figure the card draws instead of keeping a second copy of it.
import { FALLBACK_SITE_VISIT_FEE_AED, SITE_VISIT_FEE_SETTING_KEY } from "../lib/setup/tasks.js";
import {
  CATALOGUE_IMPORT_PRICING_KEY,
  FALLBACK_CATALOGUE_PRICING,
} from "../lib/catalogue-import/terms.js";
import { buildProductSearchText, valueAliases } from "../lib/search/index-text.js";
import { matchLine } from "../lib/quote/match.js";
import { medianResponseMs, windowStart } from "../lib/metrics/response-time.js";
import { monthStart } from "../lib/enquiry/fanout.js";
import { EXTRA_CATEGORIES } from "./seed-taxonomy.mjs";
import { EXTRA_SUBCATEGORIES } from "./seed-taxonomy.mjs";
import { DEEP_SUBCATEGORIES } from "./seed-taxonomy-depth.mjs";
import { seedGuides } from "./seed-guides.mjs";
import { seedSubcategories } from "./seed-subcategories.mjs";
import { seedAreaPages } from "./seed-area-pages.mjs";
import { seedCurated } from "./seed-curated.mjs";
import { seedCampaignLegal } from "./seed-campaign-legal.mjs";

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
/**
 * The seed's products, indexed by the same function the app uses.
 *
 * A thin wrapper, not a copy. This builder used to live here in full, which
 * made the seed the only writer of `search_text` in the entire codebase — the
 * importer and the dashboard's edit action both left it null. `nominal-size.ts`
 * already carries a note about that table having been written twice; this is
 * the last of it.
 *
 * `size` is passed as a value rather than a field because the seed knows the
 * size it generated but not which template field id holds it in every category.
 */
function buildSearchText(parts: {
  name: string;
  sku?: string | null;
  categoryName: string;
  specValues: Record<string, unknown>;
  size?: string;
}): string {
  const base = buildProductSearchText({
    name: parts.name,
    sku: parts.sku,
    categoryName: parts.categoryName,
    specValues: parts.specValues,
  });
  const sizeTokens = valueAliases(parts.size).join(" ");
  return sizeTokens ? `${base} ${sizeTokens}` : base;
}

async function main() {
  /*
     Before anything else, and before the truncate below in particular.

     This file's first statement destroys 46 tables. It finds the database from
     `DIRECT_URL`/`DATABASE_URL` and has never asked which host that named — and
     the repo root's `.env.local` points at the hosted Supabase while a
     worktree's points at a throwaway, so the same `pnpm db:seed` is harmless in
     one directory and unrecoverable one level up. See lib/db/target.ts.
  */
  const target = assertLocalTarget("truncate every table and reseed");
  console.log(`→ target ${target.description}`);

  console.log("→ clearing");
  /*
     Order matters only where a FK is Restrict rather than Cascade.

     The list names 48 of the schema's 79 models and that is enough: `truncate
     … cascade` also empties every table holding a foreign key to a named one,
     transitively, whatever the ON DELETE action. `staged_listing` goes with
     `licence_import_run` → `user`, `merge_candidate` with `business`, and so on
     for twenty-odd more. They are absent from this list because they are
     unreachable by hand, not because they survive.

     Three tables have no relations at all and so are reached by nothing:

       - `auth_attempt` is named below. It is the throttle counter, and left
         alone it is one of the tables a reseed does not clear — 933 rows on the
         machine this comment was written on, which is what sent somebody
         looking for a seed bug that was not there. Production needs the
         `/api/jobs/prune-attempts` cron, not this line; this line is so that a
         developer's OTP throttle does not outlive their database.
       - `rate_limit_hit` is named below for the same reason. Board 2a's claim
         search is metered through it, it has no foreign key to anything, and a
         reseed left thirteen rows of a previous afternoon's searches behind —
         which on a tighter policy is a developer wondering why the first search
         after a fresh database refuses them.
       - `ranking_weights` is deliberately NOT named. Its singleton `current`
         row is inserted by migration 20260827220000 and never by the seed, so
         truncating it would leave `liveWeights()` returning null for good.
  */
  await prisma.$executeRawUnsafe(`
    truncate table
      "audit_event","auth_attempt","rate_limit_hit","contact_reveal","zero_result_query","search_query_log","saved_search","redirect","guide","area_page","curated_list","campaign","legal_page",
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

  /*
   * The Ramadan calendar, as a platform setting.
   *
   * Written by migration 20260904180000 and again here, and the second one is
   * not redundant — for a stronger reason than the one first recorded here.
   *
   * `platform_setting` is not named in the truncate list above, which looks
   * like the `ranking_weights` arrangement and is not. `ranking_weights` has no
   * foreign keys, so leaving it out of the list is enough to save it.
   * `platform_setting` has one, to `user`, and `user` IS in the list — so
   * `truncate ... cascade` reaches it anyway. Postgres extends CASCADE to every
   * table referencing a truncated one, transitively, whatever that key's
   * `ON DELETE` rule says; thirty tables beyond the forty-eight named go with
   * it. Measured on a fresh database: after `migrate deploy` the row is there,
   * and after the truncate statement above and nothing else, it is gone.
   *
   * So this upsert is what puts it back on the ordinary `migrate deploy` path,
   * not only on the `db push` one a sibling checkout takes. Removing it because
   * the table is absent from the list would delete the Ramadan calendar on
   * every reseed — and the calendar falls back to the compiled estimates
   * rather than erroring, which is exactly why nobody would notice.
   *
   * An upsert rather than a create, so reseeding a database that already has it
   * leaves a corrected calendar alone rather than overwriting somebody's fix
   * with the estimates.
   */
  await prisma.platformSetting.upsert({
    where: { key: RAMADAN_SETTING_KEY },
    update: {},
    create: { key: RAMADAN_SETTING_KEY, value: FALLBACK_RAMADAN },
  });

  /*
   * The site-visit fee, as a platform setting.
   *
   * Board 8a draws AED 750 on the site-visit card and its own open question 2
   * says the figure is unconfirmed against the pricing page. A setting is the
   * right answer to an unconfirmed number: correcting it costs a row rather
   * than a build, a deploy and a cold cache. That is CLAUDE.md's rule that
   * content belongs in the database and its rule that every number is a query,
   * landing on the same figure.
   *
   * The value is `FALLBACK_SITE_VISIT_FEE_AED` rather than 750 typed out again.
   * Two copies of a price drift the first time either moves, and the copy that
   * loses is the one nobody is looking at — the card would go on saying 750
   * while the row said something else, and it is the row the hub charges from.
   *
   * `updatedById` is left unset, which the schema allows on purpose: the column
   * is nullable so that a migration or a seed can write a settings row before
   * any user exists to attribute it to. A **staff** write to this table is a
   * different act — a state change, owing an audit row with a written reason
   * under CLAUDE.md non-negotiable 3 — and that writer is board 12h's, not the
   * seed's. Nothing here is a precedent for an unattributed write from a screen.
   *
   * Unlike the Ramadan row above, no migration writes this one, so it exists
   * where the seed has run and nowhere else. Production reads the compiled
   * figure until 12h's settings screen writes the confirmed one, which is the
   * fallback doing its job rather than a gap.
   *
   * An upsert for the reason given above the Ramadan row — `truncate ...
   * cascade` over `user` reaches `platform_setting` through this same nullable
   * key, so a reseed drops the row and this is what puts it back — and because
   * an upsert that updates nothing leaves a confirmed fee alone rather than
   * overwriting somebody's correction with the drawn estimate.
   */
  await prisma.platformSetting.upsert({
    where: { key: SITE_VISIT_FEE_SETTING_KEY },
    update: {},
    create: { key: SITE_VISIT_FEE_SETTING_KEY, value: FALLBACK_SITE_VISIT_FEE_AED },
  });

  /*
     What a concierge catalogue load costs on each plan, board 8a's right rail.

     Imported from `lib/catalogue-import/terms.ts` rather than retyped, for the
     same reason as the fee above: two copies of a price drift, and the copy
     that loses is the one nobody is looking at. `terms.ts` is the pure half of
     `pricing.ts` and exists so this line can import it — anything behind
     `server-only` throws under plain `tsx` and would take the seed down before
     the first row was written.
  */
  await prisma.platformSetting.upsert({
    where: { key: CATALOGUE_IMPORT_PRICING_KEY },
    update: {},
    create: { key: CATALOGUE_IMPORT_PRICING_KEY, value: FALLBACK_CATALOGUE_PRICING },
  });

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

  /**
   * Landing-page copy for the first two trades.
   *
   * Written to clear the 250-word floor the matrix measures against, and
   * written as a buyer's guide rather than as filler: the floor is a floor, not
   * a target, and a paragraph repeating the category name eight times clears it
   * and helps nobody.
   */
  const CATEGORY_INTROS: Record<string, string> = {
    "valves-and-fittings":
      "Valves and fittings are bought on specification rather than on brand, and the " +
      "specification is usually set by a consultant before a contractor ever asks for a " +
      "price. What a buyer needs from a supplier in this trade is stock, paperwork and a " +
      "straight answer about lead time. Stock, because a valve missing from a riser holds up " +
      "a floor. Paperwork, because a consultant will reject a submittal without the mill " +
      "certificate or the test certificate that the specification calls for. And a straight " +
      "answer about lead time, because an indent item quoted as though it were on the shelf " +
      "is a delay nobody has planned for.\n\n" +
      "Most suppliers in the UAE hold gate, globe, ball, butterfly and check valves in the " +
      "common sizes and pressure classes, and go to indent for the larger bores, the exotic " +
      "materials and anything actuated. Ask which of those applies before you compare prices: " +
      "a quote for stock and a quote for a twelve-week indent are not the same quote, and the " +
      "cheaper one is often the second. Ask what the pressure class is against the " +
      "specification rather than against the last job. Ask whether the body material matches " +
      "the medium, because a brass body in a chilled-water line is a warranty claim waiting " +
      "to happen.\n\n" +
      "Suppliers on this page are listed with what we have checked about them: the trade " +
      "licence, and for some, a visit to the address on it. Verification says nothing about " +
      "the quality of the goods, and it is not meant to. It says the business exists, at the " +
      "address it claims, under the licence it gave us. Everything else — price, terms, " +
      "delivery — is between you and them, and always was.",
    "pipes-and-tubing":
      "Pipe is bought by schedule, material and coating, and the three together decide almost " +
      "everything about the price. A buyer comparing quotes in this trade is usually " +
      "comparing quotes for different things without realising it: galvanised against black, " +
      "seamless against welded, one schedule against the next one up. Ask for the standard " +
      "the pipe is made to before you ask what it costs, because a quote that does not name " +
      "one is a quote for whatever the supplier has in the yard.\n\n" +
      "Lead time in this trade is about the yard rather than the factory. Common sizes in GI " +
      "and black are held in Dubai and Sharjah and go out the same day; large diameters, " +
      "heavy wall and lined pipe come on indent, and the honest suppliers say so at the " +
      "quotation stage rather than at the delivery date. Cutting, threading and grooving are " +
      "usually available at the yard, and it is worth asking, because a contractor who cuts " +
      "on site pays for the offcuts twice.\n\n" +
      "Delivery matters more here than in most trades. Six-metre lengths need a vehicle that " +
      "can carry them and a site that can receive them, and a supplier who has done the " +
      "route before will ask about access before they quote. Suppliers on this page are " +
      "listed with what we have checked: the trade licence, and for some, a visit to the " +
      "address on it. What you agree on price and terms is between the two of you.",
  };

  console.log("→ categories");
  const catBySlug = new Map<string, string>();
  /**
   * Slug to top-level ancestor id.
   *
   * `Business.sectorId` is denormalised and every writer of `primaryCategoryId`
   * writes it too. The seed is one of those writers, and a seed that skipped it
   * would leave the whole directory outside every storefront template.
   */
  const sectorBySlug = new Map<string, string>();
  for (const [i, c] of CATEGORIES.entries()) {
    const row = await prisma.category.create({
      /*
       * Two categories get their landing-page copy and four do not.
       *
       * Board 6f's screen exists to show which pages have nothing to say, so a
       * seed where every page is written teaches nobody what the matrix is for.
       */
      data: {
        ...c,
        synonyms: [...c.synonyms],
        sortOrder: i,
        publishThreshold: 60,
        verifiedShareMin: 0.3,
        ...(i < 2 ? { intro: CATEGORY_INTROS[c.slug] ?? null } : {}),
      },
    });
    catBySlug.set(c.slug, row.id);
    sectorBySlug.set(c.slug, row.id);
  }

  /*
   * The six sectors board 1a adds beyond the original six.
   *
   * Seeded after, and with `sortOrder` continuing, so the six above keep their
   * order and their ids are unaffected. No business is filed against these —
   * `catSlugs` below still reads `CATEGORIES` alone — which is deliberate:
   * forty listings redistributed over twelve sectors would move suppliers out
   * of `valves-and-fittings`, where the spec template lives and where sixty
   * assertions expect to find them.
   *
   * So these render on the home page with a real zero and sort last. That is
   * the honest state of a directory that has recruited industrial supply and
   * not yet recruited logistics, and board 1a asks for exactly that rather
   * than for padding.
   */
  for (const [i, c] of EXTRA_CATEGORIES.entries()) {
    const row = await prisma.category.create({
      data: {
        ...c,
        synonyms: [...c.synonyms],
        sortOrder: CATEGORIES.length + i,
        publishThreshold: 60,
        verifiedShareMin: 0.3,
      },
    });
    catBySlug.set(c.slug, row.id);
    sectorBySlug.set(c.slug, row.id);
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
    sectorBySlug.set(s.slug, sectorBySlug.get(s.parent)!);
  }

  /*
   * The rest of the taxonomy. Board 1a's header link reads "All 12 sectors ·
   * N subcategories" and both numbers are live, so the taxonomy has to be that
   * size rather than the page claiming it is.
   *
   * `sortOrder` continues past the four above, which keeps `gate-valves` and
   * `butterfly-valves` first among their sector's children. `seedSubcategories`
   * files listings by child position, so anything else would move the two
   * subcategory pages the tests read.
   */
  const MORE_SUBCATEGORIES = [...EXTRA_SUBCATEGORIES, ...DEEP_SUBCATEGORIES];
  for (const [i, s] of MORE_SUBCATEGORIES.entries()) {
    const row = await prisma.category.create({
      data: {
        parentId: catBySlug.get(s.parent)!,
        slug: s.slug,
        code: s.code,
        name: s.name,
        nameAr: s.nameAr,
        synonyms: [...s.synonyms],
        sortOrder: SUBCATEGORIES.length + i,
      },
    });
    catBySlug.set(s.slug, row.id);
    sectorBySlug.set(s.slug, sectorBySlug.get(s.parent)!);
  }
  console.log(
    `   ${CATEGORIES.length + EXTRA_CATEGORIES.length} sectors, ` +
      `${SUBCATEGORIES.length + MORE_SUBCATEGORIES.length} subcategories`,
  );

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
        /*
         * Not set here. Derived in recomputeDerived by the same pure function
         * the hourly job calls — see lib/metrics/spec-completeness.ts. This was
         * `0.4 + rnd() * 0.6` until handoff 4 step 1, the third instance of the
         * invention criterion 5 forbids, and the worst of the three: it is not
         * only shown to a seller, `lib/search/ranking.ts` weights it at 12, so
         * search results were ordered partly by a random number.
         *
         * The draw is kept and discarded, as the other two are: removing it
         * shifts every subsequent PRNG value and renames half the seed.
         */
        ...(claimed ? (Number((0.4 + rnd() * 0.6).toFixed(2)), {}) : {}),
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
  await seedStorefrontTemplates(prisma, sectorBySlug, opsLead.id);
  await seedGuides(prisma);
  console.log("→ subcategories");
  await seedSubcategories(prisma);
  console.log("→ area landing pages");
  await seedAreaPages(prisma);
  console.log("→ curated lists");
  await seedCurated(prisma, NOW);
  console.log("→ campaign and legal");
  await seedCampaignLegal(prisma);
  await seedHomeSignals(prisma, businesses, opsLead.id);
  /*
     Board 1c's supply, built after everything above it.

     Placement is not stylistic. The PRNG is a sequence and two comments in this
     file already record what happens when a draw moves: every business
     generated afterwards is renamed, and a dozen test files pin those slugs.
     Adding suppliers at the end consumes values nothing existing depends on.
  */
  await seedPumps(prisma, catBySlug);
  await seedCertificates(prisma);
  await seedDeepCatalogue(prisma);
  await seedBranchNetwork(prisma);
  await seedProductDetail(prisma);
  await seedTestimonials(prisma);
  await seedTrackingStates(prisma);
  /*
     Last of the fixture builders, and PRNG-free.

     It creates a business and its review history from fixed arrays with no
     `rnd()` draw in it, so it can sit anywhere without renaming anything. It
     sits here anyway: the two above it do draw, and keeping them at the offsets
     `main` gave them means this branch changes no slug either of them pins.
  */
  await seedReviewDepth(prisma);
  await seedModerationQueue(prisma);
  // Last, because everything above it can create a recipient row.
  await onlyOneSellerAtCap(prisma);
  await recomputeDerived(prisma);
}

/**
 * One seller with a catalogue deep enough to need a rail.
 *
 * Board 1e's page is a filter rail, a sort and pagination, and none of the
 * three does anything on the eight-product catalogues the main seeding
 * produces: spec filters are suppressed below twelve products by design, and
 * "Show 24 more" needs more than twenty-four.
 *
 * So one flagship seller gets a real catalogue. Not all of them — a directory
 * where every supplier has sixty products is not the shape of this market, and
 * the small catalogues are what the rail-collapse rule exists for.
 *
 * Appended at the end for the same reason `seedPumps` is: the PRNG is a
 * sequence, and a draw inserted earlier renames every business generated after
 * it, which a dozen test files pin by slug.
 */
async function seedDeepCatalogue(db: Db) {
  console.log("→ a deep catalogue, for board 1e");

  const seller = await db.business.findFirst({
    where: { slug: "al-marwan-industrial-supplies-llc" },
    select: { id: true, slug: true, primaryCategoryId: true },
  });
  if (!seller) {
    console.log("   skipped — the flagship seller is not in this seed");
    return;
  }

  const template = await db.specTemplate.findFirst({
    where: { categoryId: seller.primaryCategoryId },
    orderBy: { version: "desc" },
    select: { fields: { select: { id: true, key: true, label: true, unit: true, options: true } } },
  });
  const fields = template?.fields ?? [];
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));

  const subcategories = await db.category.findMany({
    where: { parentId: seller.primaryCategoryId },
    select: { id: true, name: true },
  });
  const categories = subcategories.length > 0
    ? subcategories
    : [{ id: seller.primaryCategoryId, name: "Valves & fittings" }];

  const BODIES = ["Cast iron", "Ductile iron", "Stainless steel 316", "Brass", "Bronze"];
  const RATINGS = ["PN10", "PN16", "PN25", "PN40"];
  const SIZES = ["DN50", "DN80", "DN100", "DN150", "DN200", "DN300"];
  const KINDS = [
    "Resilient seated gate valve",
    "Wafer butterfly valve",
    "Ductile iron check valve",
    "Cast iron Y-strainer",
    "Brass ball valve",
    "Gear operated butterfly valve",
    "Flanged globe valve",
    "Swing check valve",
  ];

  let made = 0;
  for (let i = 0; i < 56; i += 1) {
    const kind = KINDS[i % KINDS.length]!;
    const size = SIZES[i % SIZES.length]!;
    const name = `${kind} ${size}`;
    const slug = slugify(`${name}-deep-${i}`);

    // Skip anything the main pass already created under the same slug.
    const clash = await db.product.findFirst({
      where: { businessId: seller.id, slug },
      select: { id: true },
    });
    if (clash) continue;

    const specValues: Record<string, string> = {};
    const put = (key: string, value: string) => {
      const field = fieldByKey.get(key);
      if (field) specValues[field.id] = value;
    };
    put("nominal_diameter", size);
    put("body_material", BODIES[i % BODIES.length]!);
    put("pressure_rating", RATINGS[i % RATINGS.length]!);
    put("end_connection", i % 2 === 0 ? "Flanged" : "Threaded");

    /*
       Every band appears, and one in eight is out of stock so criterion 7's
       "Notify me" has somewhere to render.
    */
    const availability =
      i % 8 === 7 ? "out_of_stock" : i % 5 === 4 ? "indent" : i % 3 === 2 ? "made_to_order" : "in_stock";

    /*
       Two thirds of the stock counts are recent and the rest are stale, so
       criterion 8 is visible on the page rather than only in a unit test: the
       stale ones render a band with no number.
    */
    const stale = i % 3 === 0;
    const hasCount = availability === "in_stock";

    const category = categories[i % categories.length]!;

    await db.product.create({
      data: {
        businessId: seller.id,
        categoryId: category.id,
        name,
        slug,
        sku: `AM-${1000 + i}`,
        availability: availability as never,
        stockQty: hasCount ? 20 + i * 3 : null,
        stockUpdatedAt: hasCount ? days(stale ? -120 : -4) : null,
        leadTimeDays: availability === "indent" ? 45 : availability === "made_to_order" ? 14 : null,
        minOrderQty: i % 4 === 0 ? 10 : null,
        specValues,
        searchText: buildSearchText({
          name,
          sku: `AM-${1000 + i}`,
          categoryName: category.name,
          specValues,
          size,
        }),
        description: "Supplied ex-stock or to order. Datasheet available on request.",
        status: "live",
      },
    });
    made += 1;
  }

  console.log(`   ${made} products on ${seller.slug}`);
}

/**
 * Public certificates, for board 1d's certificates block.
 *
 * On the verified suppliers only, because the block means something on a
 * storefront that has earned the rest of the page. Each carries a display name
 * and an expiry and no file: `storagePath` points at an object that does not
 * exist, and nothing public links to it — a certificate lists what it is and
 * until when, and the scan stays private.
 *
 * `isPublic` is set explicitly for the same reason the column defaults to
 * false: a document is on a shop window because somebody said so.
 */
async function seedCertificates(db: Db) {
  console.log("→ public certificates");

  const CERTS = [
    { name: "ISO 9001:2015 — Quality management", months: 18 },
    { name: "ISO 14001:2015 — Environmental management", months: 26 },
    { name: "Civil Defence approval", months: 9 },
  ] as const;

  const suppliers = await db.business.findMany({
    where: { claimStatus: "claimed", verificationTier: { gte: 2 } },
    select: { id: true, slug: true },
    take: 12,
  });

  let made = 0;
  for (const [i, supplier] of suppliers.entries()) {
    // Not every verified supplier holds one, which is the honest distribution.
    if (i % 3 === 2) continue;
    const cert = CERTS[i % CERTS.length]!;

    await db.document.create({
      data: {
        businessId: supplier.id,
        kind: "certificate",
        storagePath: `certificates/${supplier.slug}/${i}.pdf`,
        filename: `scan_${1000 + i}.pdf`,
        displayName: cert.name,
        validUntil: days(cert.months * 30),
        isPublic: true,
      },
    });
    made += 1;
  }
  console.log(`   ${made} public certificates across ${suppliers.length} verified suppliers`);
}

/**
 * Pumps & motors — the sector board 1c's own example query needs.
 *
 * `/search?q=chilled+water+pumps` is the board's canonical URL and its first
 * acceptance criterion: those three words must reach a supplier whose products
 * carry `Application: chilled water`, not merely one who wrote the phrase about
 * themselves. Until this existed the query demonstrated the zero-result state,
 * which is a real state and not the one the board is about.
 *
 * Twelve suppliers, not sixty. The publish floor is sixty and this is under it
 * on purpose: the sector's landing page stays unpublished, `showOnHome` stays
 * false, and the honest cold-start behaviour the rest of the seed models is not
 * quietly undone for one demo. Search does not require a published landing
 * page; it requires supply.
 *
 * Two of the twelve are left unpinned, so criterion 4 has something to report
 * on this page as well — a supplier in the list and not on the map.
 */
async function seedPumps(db: Db, catBySlug: Map<string, string>) {
  console.log("→ pumps & motors, for board 1c");

  const categoryId = catBySlug.get("pumps-and-motors");
  if (!categoryId) throw new Error("pumps-and-motors category missing");

  /*
     The template, and the field the whole board turns on.

     `Application` is what makes `chilled water pumps` a specification search
     rather than a name search: the buyer names the duty, and the index carries
     it under its own label because `buildProductSearchText` writes both.
  */
  const template = await db.specTemplate.create({
    data: {
      categoryId,
      name: "Pump",
      version: 1,
      status: "live",
      fields: {
        create: [
          { key: "application", label: "Application", labelAr: "التطبيق", type: "select", required: true, isFilterable: true, sortOrder: 0,
            options: ["Chilled water", "Potable water", "Fire fighting", "Drainage", "Process"] },
          { key: "nominal_diameter", label: "Nominal diameter", labelAr: "القطر الاسمي", type: "select", unit: "DN", required: true, isFilterable: true, sortOrder: 1,
            options: ["DN50", "DN65", "DN80", "DN100", "DN150", "DN200"] },
          { key: "pump_type", label: "Pump type", labelAr: "نوع المضخة", type: "select", required: false, isFilterable: true, sortOrder: 2,
            options: ["End suction", "Split case", "Vertical multistage", "Submersible", "Inline circulator"] },
          { key: "head_max", label: "Maximum head", labelAr: "أقصى ضاغط", type: "number", unit: "m", required: false, isFilterable: false, sortOrder: 3, options: [] },
        ],
      },
    },
    include: { fields: true },
  });

  const fieldId = (key: string) => template.fields.find((f) => f.key === key)!.id;
  const fields = template.fields.map((f) => ({ id: f.id, label: f.label, unit: f.unit }));

  const dubaiAreas = await db.area.findMany({
    where: { emirate: "dubai" },
    select: { id: true, lat: true, lng: true },
  });
  if (dubaiAreas.length === 0) throw new Error("no Dubai areas to place pump suppliers in");

  /*
     Names that share no token with `NAME_PREFIX`.

     The first draft reused eight of them — "Al Marwan Pump Systems", "Northbay
     Pump Services", "Al Waha", "Al Qimma", "Al Bariq", "Silver Dune" — and the
     onboarding claim test searches "Al Marwan" expecting one result. It got two
     and failed on a strict-mode violation, which is the right failure: a buyer
     searching their own trade name and finding two candidates is the exact
     ambiguity board 2a's dispute route exists for, and the seed should not
     manufacture it.

     Three of these are the board's own render — Technopump, Gulf Cool, Marina —
     and the rest are built to collide with nothing.
  */
  const PUMP_NAMES = [
    "Technopump Trading", "Gulf Cool Technical Services", "Hydroline Pump Systems",
    "Marina Pumps & Controls", "Cascade Hydro Equipment", "Aquaforce Pump Trading",
    "Deira Flow Systems", "Zenith Pumping Solutions", "Riverbend Pump Services",
    "Clearwater Systems Trading", "Circulon Trading", "Torque Hydraulics",
  ] as const;

  const PUMP_PRODUCTS = [
    { name: "End suction centrifugal pump", type: "End suction", application: "Chilled water" },
    { name: "Split case chilled water pump", type: "Split case", application: "Chilled water" },
    { name: "Inline circulator pump", type: "Inline circulator", application: "Chilled water" },
    { name: "Vertical multistage booster pump", type: "Vertical multistage", application: "Potable water" },
    { name: "Fire fighting jockey pump", type: "End suction", application: "Fire fighting" },
    { name: "Submersible drainage pump", type: "Submersible", application: "Drainage" },
  ] as const;

  for (const [i, name] of PUMP_NAMES.entries()) {
    const slug = slugify(`${name} ${i}`);
    // Two of twelve unpinned, so the map's excluded count has something true to
    // say on this page too.
    const unpinned = i >= PUMP_NAMES.length - 2;
    const area = dubaiAreas[i % dubaiAreas.length]!;
    const tier = i < 3 ? 3 : i < 8 ? 2 : 0;

    const business = await db.business.create({
      data: {
        tradeName: `${name} LLC`,
        displayName: name,
        slug,
        licenceNumber: `DED-${700000 + i}`,
        licenceAuthority: "DED",
        licenceExpiry: days(int(120, 900)),
        establishedYear: tier > 0 ? int(1998, 2020) : null,
        description:
          tier > 0
            ? "Pump supplier serving MEP contractors across Dubai. Chilled water, potable water and fire sets, with commissioning and spares."
            : null,
        verificationTier: tier,
        verifiedAt: tier > 0 ? days(-int(20, 200)) : null,
        visitedAt: tier >= 3 ? days(-int(20, 90)) : null,
        visitedByStaffId: tier >= 3 ? uuid(3) : null,
        claimStatus: tier > 0 ? "claimed" : "unclaimed",
        primaryCategoryId: categoryId,
        source: "licence_import",
        publishedAt: days(-int(20, 300)),
        ratingOverall: null,
        reviewCount: 0,
        derivedAt: NOW,
        locations: {
          create: {
            type: "head_office",
            emirate: "dubai",
            areaId: area.id,
            addressLine: `Unit ${int(1, 90)}`,
            published: true,
            // Jittered off the area centroid, or absent entirely. Never the
            // centroid itself — that is the approximation criterion 4 forbids.
            lat: unpinned || area.lat === null ? null : Number((area.lat + (rnd() - 0.5) * 0.01).toFixed(6)),
            lng: unpinned || area.lng === null ? null : Number((area.lng + (rnd() - 0.5) * 0.01).toFixed(6)),
          },
        },
      },
      select: { id: true },
    });

    for (const [p, seed] of PUMP_PRODUCTS.entries()) {
      const size = pick(["DN50", "DN80", "DN100", "DN150", "DN200"]);
      const specValues: Record<string, string> = {
        [fieldId("application")]: seed.application,
        [fieldId("nominal_diameter")]: size,
        [fieldId("pump_type")]: seed.type,
      };
      const productName = `${seed.name} ${size}`;
      await db.product.create({
        data: {
          businessId: business.id,
          name: productName,
          slug: slugify(`${productName}-${p}`),
          sku: `PM-${i}${p}-${size.replace("DN", "")}`,
          categoryId,
          availability: p % 3 === 2 ? "made_to_order" : "in_stock",
          stockQty: p % 3 === 2 ? null : int(2, 40),
          specValues,
          searchText: buildProductSearchText({
            name: productName,
            sku: `PM-${i}${p}-${size.replace("DN", "")}`,
            categoryName: "Pumps & motors",
            specValues,
            fields,
          }),
          description: "Supplied with test certificate. Commissioning and spares available.",
          status: "live",
        },
      });
    }
  }
}

/**
 * The two things board 1a reads that nothing else in the seed produces.
 *
 * **Recent verifications.** Section 5 shows businesses whose tier *rose* in the
 * last seven days, and it reads that from the audit log rather than from
 * `verifiedAt` — a date tells you when a check happened, not that a tier went
 * up. `seedTrust` writes one `tier_change` row, twelve days old, so the section
 * had one candidate and its rule is to drop rather than pad.
 *
 * The tier itself is not moved. The audit row records the tier the business
 * already has as its `after` and one step lower as its `before`, which says
 * "this listing reached tier 3 four days ago" — true, and it leaves every
 * tier-dependent fixture in the suite exactly where it was.
 *
 * **Search history.** The "Popular:" chips are the five most-searched terms of
 * the last thirty days that returned something, and `search_query_log` is
 * written by real searches. A fresh database has none, so the chips would show
 * their hardcoded fallback and nobody would find out whether the query works.
 * These are the terms this seed's catalogue actually answers.
 */
async function seedHomeSignals(db: Db, businesses: Biz[], opsLeadId: string) {
  console.log("→ home signals");

  /*
   * Verified in the last week. Four, because the section asks for four and
   * widening to fourteen and thirty days is a fallback rather than the state
   * worth demonstrating.
   *
   * Claimed and already verified: an unclaimed listing has nobody to have
   * verified, and tier 0 never rose to anything.
   */
  const recentlyVerified = businesses
    .filter((b) => b.claim === "claimed" && b.tier >= 2)
    .slice(0, 4);

  for (const [i, business] of recentlyVerified.entries()) {
    const when = days(-(i + 1));
    await db.auditEvent.create({
      data: {
        actorId: opsLeadId,
        action: "tier_change",
        subject: `Business:${business.id}`,
        reason:
          business.tier >= 3
            ? "Site visit completed. Trade counter, stock and licence board all confirmed on site."
            : "Trade licence checked against the issuing authority and the contact number answered.",
        before: { verificationTier: business.tier - 1 },
        after: { verificationTier: business.tier },
        createdAt: when,
      },
    });
    // The badge's date has to agree with the audit row. A badge reading
    // August beside a section headed "Verified this week" is the kind of
    // small contradiction that costs the whole trust ladder its credit.
    await db.business.update({
      where: { id: business.id },
      data: business.tier >= 3 ? { verifiedAt: when, visitedAt: when } : { verifiedAt: when },
    });
  }
  console.log(`   ${recentlyVerified.length} tier increases inside 7 days`);

  /*
   * Thirty days of search history, weighted so the top five are stable.
   *
   * `resultCount` is what the home page filters on — a chip that leads to an
   * empty results page is worse than no chip — so the terms below are ones
   * this catalogue answers, and the tail carries a couple of misses to prove
   * the filter does something.
   */
  const SEARCHES: readonly { query: string; hits: number; results: number }[] = [
    { query: "gate valve DN100", hits: 34, results: 12 },
    { query: "butterfly valve", hits: 28, results: 9 },
    { query: "GI pipe", hits: 23, results: 7 },
    { query: "cable tray", hits: 19, results: 6 },
    { query: "safety helmet", hits: 16, results: 5 },
    { query: "ducting", hits: 12, results: 4 },
    { query: "stretch film", hits: 9, results: 3 },
    { query: "pallet racking", hits: 7, results: 2 },
    { query: "chilled water pump", hits: 5, results: 1 },
    // Real misses. These are the gap report's rows, and the reason the home
    // page's read is `resultCount > 0` rather than a bare count.
    { query: "titanium heat exchanger", hits: 6, results: 0 },
    { query: "helium leak testing", hits: 4, results: 0 },
  ];

  const rows = SEARCHES.flatMap(({ query, hits, results }) =>
    Array.from({ length: hits }, (_, i) => ({
      query,
      normalised: query.toLowerCase().replace(/\s+/g, " ").trim(),
      resultCount: results,
      // Spread across the window rather than stacked on one day, so a
      // thirty-day read and a seven-day read give different answers.
      createdAt: days(-((i % 29) + 1)),
      tab: "businesses",
    })),
  );
  await db.searchQueryLog.createMany({ data: rows });
  console.log(`   ${rows.length} logged searches across 30 days`);

  await seedOpenRequests(db);
}

/**
 * Open requirements across the trades, for the home page's hero panel.
 *
 * `seedEnquiries` builds a careful set for the quote pipeline — one accepted,
 * one at cap, one from an account-less buyer — and every one of them targets
 * valves, because valves is where the spec template and the catalogue depth
 * are. That is right for those fixtures and wrong for this panel: the eight
 * most recent open requests were all the same trade, at the same minute, with
 * no quotes, so a panel whose whole job is to look like a live marketplace
 * rendered four identical rows.
 *
 * These are real `Enquiry` rows and the panel reads them the way it reads any
 * other — nothing here is a fixture the page knows about. What they add is the
 * spread a directory has once more than one trade is using it: different
 * sectors, staggered across two days, some with quotes against them and some
 * without.
 *
 * Two are written to be suppressed. The panel's rule is that a requirement
 * carrying a phone number, an email or a company name never reaches a stranger,
 * and a rule with no row exercising it is a rule nobody can see working.
 */
async function seedOpenRequests(db: Db) {
  /*
   * These have to be the newest open enquiries in the table, and `hours()` is
   * measured from the seed's own clock — noon today — which is exactly when
   * `seedEnquiries` stamps its valves batch. Anything at `hours(-1)` is
   * therefore an hour *older* than those, and the panel went on rendering four
   * valve requests with the cross-trade ones sitting just below the cut.
   *
   * Anchored past that batch instead, and clamped to a minute ago so a seed run
   * before noon cannot date a request into the future. The spread is minutes
   * rather than hours so the panel reads the way board 1a draws it: "11 min
   * ago" over "2 h ago" over "3 h ago".
   */
  const anchor = Math.min(Date.now() - 60_000, NOW.getTime() + 6 * 3_600_000);
  const recently = (minutesAgo: number) => new Date(anchor - minutesAgo * 60_000);

  const buyer = await db.user.findFirstOrThrow({
    where: { roles: { has: "buyer" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const WANTED: readonly {
    sector: string;
    requirement: string;
    area: string | null;
    /** Minutes ago. Staggered so the panel's relative times differ. */
    age: number;
    quotes: number;
  }[] = [
    {
      sector: "hvac-and-ventilation",
      requirement: "Monthly AMC for 14 split units and two ducted splits across three retail units.",
      area: "Al Quoz Industrial 3",
      age: 11,
      quotes: 4,
    },
    {
      sector: "safety-and-ppe",
      requirement: "Coveralls, helmets and safety boots for 60 site staff. Sizes to be confirmed.",
      area: "Mussafah M-17",
      age: 64,
      quotes: 7,
    },
    {
      sector: "packaging-and-materials",
      requirement: "500 printed gift boxes, rigid, with a foam insert. Artwork ready.",
      area: "Industrial Area 4",
      age: 138,
      quotes: 2,
    },
    {
      sector: "electrical-and-cable",
      requirement: "4-core 95mm² XLPE armoured cable, 400 m, plus glands and lugs.",
      area: "Jebel Ali Free Zone",
      age: 197,
      quotes: 3,
    },
    {
      sector: "pipes-and-tubing",
      requirement: "GI pipes, 2 inch, medium grade, 300 m with fittings for a fire line.",
      area: "New Industrial Area",
      age: 320,
      quotes: 1,
    },
    {
      sector: "hvac-and-ventilation",
      requirement: "Cold room panels, 100mm PUF, for a 40 m² chiller room in a central kitchen.",
      area: "Deira",
      age: 474,
      quotes: 5,
    },
    /*
     * Two the detector must catch, so the home page's suppression rule has
     * something exercising it in a browser rather than only in a unit test.
     *
     * Both name a company and neither carries a phone number or an email, and
     * that is deliberate rather than squeamish. An enquiry goes to its
     * recipients' leads inbox, which renders the requirement as the buyer
     * wrote it — board 3j shows a first name and nothing else, and
     * `dashboard.spec.ts` asserts no contact detail ever appears on it. A seed
     * fixture carrying a mobile number therefore does not test the home page,
     * it plants a buyer's phone number in a seller-facing screen and in every
     * developer's database.
     *
     * The phone, email, IBAN, URL and TRN branches are covered where they
     * belong: eleven cases in lib/enquiry/redaction.test.ts, and one
     * integration fixture that creates a leaky enquiry, asserts the panel drops
     * it, and deletes it again.
     */
    {
      sector: "valves-and-fittings",
      requirement: "Butterfly valves DN200 for Al Bariq Contracting LLC, flanged PN16.",
      area: "Al Quoz Industrial 1",
      age: 27,
      quotes: 0,
    },
    {
      sector: "safety-and-ppe",
      requirement: "Fire extinguisher refills for Gulf Crest Trading LLC, 40 units, annual contract.",
      area: "Deira",
      age: 92,
      quotes: 0,
    },
  ];

  let made = 0;
  for (const [index, want] of WANTED.entries()) {
    /*
     * Every claimed supplier in the trade, up to the fan-out's ceiling of
     * eight. A quote count is a count of *suppliers who answered*, so the
     * recipients are what bounds it — `Quote` is unique on
     * (enquiry, business, revision), and eight quotes from one seller would be
     * eight revisions of one price rather than eight competing ones.
     */
    const sellers = await db.business.findMany({
      where: {
        claimStatus: "claimed",
        suspendedAt: null,
        publishedAt: { not: null },
        primaryCategory: { OR: [{ slug: want.sector }, { parent: { slug: want.sector } }] },
        /*
         * Never the seller `seedAtMonthlyCap` puts exactly on their free-plan
         * limit. Board 11a argues from a counter reading three of three, and
         * `onlyOneSellerAtCap` deliberately leaves this one alone when it
         * trims everybody else — so a recipient row added here lands on top of
         * the fixture and the board starts claiming a three-enquiry limit was
         * reached at four.
         */
        slug: { not: FREE_AT_CAP_SLUG },
      },
      orderBy: [{ verificationTier: "desc" }, { slug: "asc" }],
      take: 8,
      select: { id: true },
    });
    // No claimed supplier in that trade yet is a real state in a young
    // directory, and it means there is nobody the fan-out could have reached.
    if (sellers.length === 0) continue;

    const createdAt = recently(want.age);
    const enquiry = await db.enquiry.create({
      data: {
        ref: `ENQ-91${String(index).padStart(2, "0")}`,
        buyerId: buyer.id,
        requirement: want.requirement,
        deliverToArea: want.area,
        // Open, which is the whole point. Two weeks out from when it was sent.
        closesAt: new Date(createdAt.getTime() + 14 * 24 * 3_600_000),
        createdAt,
      },
    });

    const quoted = Math.min(want.quotes, sellers.length);
    for (const [i, seller] of sellers.entries()) {
      const answered = i < quoted;
      await db.enquiryRecipient.create({
        data: {
          enquiryId: enquiry.id,
          businessId: seller.id,
          state: answered ? "quoted" : "delivered",
          ...(answered ? { firstReplyAt: new Date(createdAt.getTime() + 2 * 60_000) } : {}),
          createdAt,
        },
      });
      if (!answered) continue;

      /*
       * A quote with no lines. The panel renders the count and never the
       * quote, and a priced line is private to one buyer and one seller — so
       * the seed has no business inventing one here.
       */
      await db.quote.create({
        data: {
          ref: `QT-91${String(index).padStart(2, "0")}-${i + 1}`,
          enquiryId: enquiry.id,
          businessId: seller.id,
          status: "sent",
          sentAt: new Date(createdAt.getTime() + 2 * 60_000),
          expiresAt: new Date(createdAt.getTime() + 14 * 24 * 3_600_000),
          createdAt: new Date(createdAt.getTime() + 2 * 60_000),
        },
      });
    }
    made += 1;
  }
  console.log(`   ${made} open requests across the trades`);
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
      /*
       * Every third product is missing its body material — a required,
       * filterable field.
       *
       * Not decoration. `specCompleteness` is measured now rather than invented,
       * and a seed where every product is complete gives a flat 1.00 to all
       * sixteen sellers: a ranking signal that ranks nothing, and no products
       * for board 4e's "this version makes N products incomplete" to count.
       * A real catalogue is patchy — somebody bulk-imported it and never went
       * back — and that is the shape worth seeding.
       *
       * Chosen by index rather than by a draw. The PRNG is a sequence and an
       * inserted `rnd()` renames every business generated after it.
       */
      const missingMaterial = p % 3 === 0;
      /*
       * Both drawn, in the order they were drawn before, and the material used
       * only when it is kept. Putting the `pick()` inside the conditional would
       * skip a draw for a third of the products; hoisting it above the pressure
       * rating would swap the two values. The PRNG is a sequence and its order
       * is as load-bearing as its length.
       */
      const pressureRating = pick(["PN16", "PN16", "PN25", "Class 150"]);
      const bodyMaterial = pick(["Ductile iron", "Cast iron", "Stainless steel 316", "Brass"]);
      const specValues: Record<string, string | number | string[]> = isValves
        ? {
            [fieldId("nominal_diameter")]: dn,
            [fieldId("pressure_rating")]: pressureRating,
            ...(missingMaterial ? {} : { [fieldId("body_material")]: bodyMaterial }),
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
/**
 * Exactly one free seller at their monthly cap, and it is the one we chose.
 *
 * `seedAtMonthlyCap` exists to put `FREE_AT_CAP_SLUG` on the line, because
 * handoff 2 criterion 6 needs a seller who is offered nothing. A *second*
 * seller arriving at the cap by accident is not a second fixture — it is a
 * quieter version of the first, and it silently shrinks every fan-out pool that
 * seller sits in.
 *
 * That happened when handoff 5 re-filed listings under subcategories: the valve
 * pool picked up a different mix, one of them was incidentally at 3 of 3, and
 * the handoff-2 checkpoint — "send to 5 sellers" — started finding four. The
 * test had not changed and neither had the code it tests.
 *
 * So: anybody else who has drifted onto the line loses their oldest recipient
 * rows until they are one under it. Deterministic, and it takes away only the
 * surplus.
 */
async function onlyOneSellerAtCap(db: Db) {
  const since = monthStart(NOW);
  const sellers = await db.business.findMany({
    where: { claimStatus: "claimed", plan: { enquiriesPerMonth: { not: null } } },
    orderBy: { slug: "asc" },
    select: {
      id: true,
      slug: true,
      plan: { select: { enquiriesPerMonth: true } },
      recipients: {
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "asc" },
        // Composite key: there is no `id` on this row.
        select: { enquiryId: true, businessId: true },
      },
    },
  });

  let freed = 0;
  for (const seller of sellers) {
    const cap = seller.plan?.enquiriesPerMonth;
    if (cap === null || cap === undefined) continue;
    if (seller.slug === FREE_AT_CAP_SLUG) continue;
    if (seller.recipients.length < cap) continue;

    const surplus = seller.recipients.slice(0, seller.recipients.length - (cap - 1));
    await db.enquiryRecipient.deleteMany({
      where: { businessId: seller.id, enquiryId: { in: surplus.map((r) => r.enquiryId) } },
    });
    freed += surplus.length;
  }

  console.log(
    `   ${sellers.length} capped-plan sellers checked, ${freed} recipient rows removed so only ${FREE_AT_CAP_SLUG} is at cap`,
  );
}

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
  const { specCompleteness } = await import("../lib/metrics/spec-completeness.js");

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

  const [products, media, fields] = await Promise.all([
    db.product.findMany({
      select: {
        businessId: true,
        specValues: true,
        category: { select: { defaultTemplateId: true } },
      },
    }),
    db.media.findMany({
      where: { reviewId: null },
      select: { kind: true, businessId: true, product: { select: { businessId: true } } },
    }),
    db.specField.findMany({
      select: { id: true, templateId: true, key: true, required: true, isFilterable: true, requiredFrom: true },
    }),
  ]);

  const rulesByTemplate = new Map<string, { id: string; key: string; required: boolean; isFilterable: boolean; requiredFrom: Date | null }[]>();
  for (const f of fields) {
    const list = rulesByTemplate.get(f.templateId) ?? [];
    list.push({ id: f.id, key: f.key, required: f.required, isFilterable: f.isFilterable, requiredFrom: f.requiredFrom });
    rulesByTemplate.set(f.templateId, list);
  }

  const specsByBusiness = new Map<string, { templateId: string | null; values: Record<string, unknown> | null }[]>();
  for (const p of products) {
    const list = specsByBusiness.get(p.businessId) ?? [];
    list.push({
      templateId: p.category?.defaultTemplateId ?? null,
      values: p.specValues as Record<string, unknown> | null,
    });
    specsByBusiness.set(p.businessId, list);
  }

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
    const completeness = specCompleteness(
      specsByBusiness.get(b.id) ?? [],
      rulesByTemplate,
      NOW,
    );

    await db.business.update({
      where: { id: b.id },
      data: { profileStrength: score, specCompleteness: completeness },
    });
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

/**
 * Two sector templates, and they are deliberately different.
 *
 * Criterion 2 — *"reordering, enabling or disabling a section changes every live
 * storefront on that template and nothing else"* — is only assertable with two,
 * so valves and pipes get different section lists. One template and the test
 * proves nothing: everything is on the same template, so everything changes.
 *
 * Both are `live`, which the partial unique index allows exactly once per
 * sector. Every other sector has no template, which is the honest starting
 * state — a directory where four trades out of six are still on the default
 * storefront is what this actually looks like before staff get to it.
 */
async function seedStorefrontTemplates(
  db: Db,
  sectorBySlug: Map<string, string>,
  opsLeadId: string,
) {
  console.log("→ storefront templates");
  const { sectionType } = await import("../lib/storefront/section-types.js");

  const plans = [
    {
      sector: "valves-and-fittings",
      name: "Industrial",
      theme: "industrial",
      offered: ["industrial", "mono", "default"],
      // The full set: a trade where the catalogue is the sell.
      types: [
        "header", "hero", "trust_strip", "featured_products", "catalogue_grid",
        "spec_comparison", "certifications", "branches", "reviews", "enquiry_form",
      ],
    },
    {
      sector: "pipes-and-tubing",
      name: "Stockist",
      theme: "trade",
      offered: ["trade", "mono"],
      // Shorter, and no spec comparison. Pipe is sold on stock and lead time.
      types: ["header", "hero", "trust_strip", "catalogue_grid", "branches", "enquiry_form"],
    },
  ];

  for (const plan of plans) {
    const sectorId = sectorBySlug.get(plan.sector);
    if (!sectorId) continue;

    const template = await db.storefrontTemplate.create({
      data: {
        sectorId,
        name: plan.name,
        status: "live",
        version: 1,
        publishedAt: days(-int(5, 40)),
        defaultTheme: plan.theme,
        offeredThemes: plan.offered,
        density: plan.sector === "pipes-and-tubing" ? "compact" : "comfortable",
        sections: {
          create: plan.types.map((type, index) => {
            const definition = sectionType(type)!;
            return {
              type,
              sortOrder: index,
              fixed: definition.fixed,
              singleton: definition.singleton,
              sellerEditableFields: definition.sellerFields.map((field) => field.key),
            };
          }),
        },
      },
      select: {
        id: true,
        version: true,
        sections: {
          select: {
            id: true, type: true, sortOrder: true, enabled: true, fixed: true,
            singleton: true, sellerEditableFields: true, showOnMobile: true, settings: true,
          },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    const storeCount = await db.business.count({
      where: { sectorId, publishedAt: { not: null }, mergedIntoId: null, suspendedAt: null },
    });

    /*
     * The published version, with the store count on it. The count is the
     * decision — somebody confirmed "this affects N stores" — and a history
     * that lost the number cannot say what was agreed.
     */
    await db.templateVersion.create({
      data: {
        templateId: template.id,
        version: template.version,
        storeCount,
        publishedBy: opsLeadId,
        reason: `First publish of the ${plan.name} template for ${plan.sector.replace(/-/g, " ")}.`,
        snapshot: { name: plan.name, sections: template.sections } as object,
      },
    });

    /*
     * One page per template, so the public route has something real to render
     * and the content check has something to score. Written to pass three of
     * its four checks and fail the image one — a specimen where everything
     * passes teaches nobody what the panel is for.
     */
    const trade = plan.sector.replace(/-/g, " ");
    await db.templatePage.create({
      data: {
        templateId: template.id,
        slug: "about",
        title: "About us",
        metaDescription: `Stockist and supplier of ${trade} for contractors across Dubai and Sharjah.`,
        status: "live",
        publishedAt: days(-int(2, 20)),
        blocks: [
          { id: "h1", kind: "heading", values: { text: "Counter sales and site delivery" } },
          {
            id: "t1",
            kind: "text",
            values: {
              body:
                `We have supplied ${trade} to contractors across Dubai, Sharjah and the Northern ` +
                "Emirates since the trade licence in the footer was first issued. Counter sales " +
                "run from the warehouse six days a week, and scheduled site delivery covers Al " +
                "Quoz, Ras Al Khor, Jebel Ali and the Sharjah industrial areas. Most orders " +
                "placed before midday go out the same afternoon. Where an item is not on the " +
                "shelf we say so and quote a lead time rather than quoting a date we cannot " +
                "hold — the counter staff would rather lose the order than lose the contractor. " +
                "Quotes hold for the period stated on them. Nothing on this page is a price: " +
                "prices come back on a quote against the sizes and quantities you send, because " +
                "what a contractor pays depends on the quantity, the specification and the " +
                "delivery, and a number on a web page is none of those. Our team speak English, " +
                "Arabic, Hindi and Malayalam, which is what the counter actually needs.\n\n" +
                "Everything we stock is bought from the manufacturer or their appointed agent " +
                "in the Emirates, and the paperwork comes with it: mill certificates where the " +
                "specification calls for them, test certificates on request, and the " +
                "manufacturer datasheet for anything a consultant has to approve before it goes " +
                "in the ground. If a consultant rejects a submittal we will find the equivalent " +
                "that passes rather than argue about the one that did not. Accounts are opened " +
                "against a trade licence and a signed order, and payment terms are agreed " +
                "between us and you directly, as they always have been in this trade. We are " +
                "not a marketplace and nothing passes through anybody else on the way. The " +
                "counter opens early because contractors start early, and somebody answers the " +
                "phone during working hours rather than a menu. If you send a schedule we will " +
                "price it line by line and tell you which lines are on the shelf today.",
            },
          },
          {
            id: "n1",
            kind: "numbers",
            values: {
              items: [
                { label: "Trading since", value: "2009" },
                { label: "Branches", value: "2" },
                { label: "Same-day delivery", value: "Before midday" },
              ],
            },
          },
          {
            id: "c1",
            kind: "cta",
            values: {
              text: "Send the sizes and quantities and we will quote from stock.",
              label: "See the catalogue",
            },
          },
        ] as object[],
      },
    });

    console.log(`   ${plan.name}: ${template.sections.length} sections, ${storeCount} stores, 1 page`);
  }
}

async function seedCommercials(db: Db, businesses: Biz[]) {
  console.log("→ subscriptions, placements, invoices");
  const { snapshotOf } = await import("../lib/plan/entitlements.js");
  /*
     The first twelve claimed listings, and the slice is taken **before** the one
     exclusion below rather than after.

     Excluding a business from the filter would shift every index in the window,
     and the plan each listing gets is decided by its index (`i < 3 ? pro : …`).
     Doing it that way moved eleven other listings between plans as a side
     effect — which changed which sellers are on a capped plan, and left one of
     them a single enquiry below their cap where `enquiry-fanout.test.ts` fills
     and empties a month. The suite passed once and failed on the next run.

     So: same twelve as before, and one of them is skipped in the loop.
  */
  const paying = businesses.filter((b) => b.claim === "claimed").slice(0, 12);
  const planRows = new Map((await db.plan.findMany()).map((p) => [p.id, p]));

  /** Signup dates, so the MRR ledger can be backfilled with the real ones. */
  const started = new Map<string, { planId: string; at: Date; fils: number }>();

  for (const [i, b] of paying.entries()) {
    const planId = i < 3 ? "pro" : i < 8 ? "basic" : "free";
    if (planId === "free") continue;
    /*
       Never the listing board 11a is about.

       `seedAtMonthlyCap` runs just before this and puts `FREE_AT_CAP_SLUG` on
       Free, at its cap, with missed enquiries to argue about — that is the whole
       of board 11a. This loop was selling it a Pro subscription.

       It went unnoticed because the business row and the subscription row
       disagreed: the subscription said Pro and `Business.planId` still said
       Free, so every screen that reads the plan kept showing the Free overview.
       Making the two agree is what surfaced it.
    */
    if (b.slug === FREE_AT_CAP_SLUG) continue;
    const plan = planRows.get(planId)!;
    const startedAt = days(-int(60, 700));

    /*
       One account pays yearly.

       Every screen that states a money figure now has to answer for a term —
       the admin subscription list, the revenue mix, the seller's own billing
       page — and a seed where every row is monthly leaves all three untested
       against the case they were changed for. The second Pro account is the
       one, so the annual state sits beside a monthly one on the same plan.
    */
    const term = i === 1 && plan.annualMonthsCharged !== null ? "annual" : "monthly";
    /*
       Only read where the plan sells a year.

       This had a `?? 12` fallback, which is the shape of a bug rather than a
       default: twelve months for a year is not a discount, it is the monthly
       price with extra steps, and it silently made the seeded annual invoice
       AED 10,788 instead of AED 8,990. A plan with no annual price cannot have
       an annual term at all, which is what the condition above now says.
    */
    const monthsCharged = plan.annualMonthsCharged ?? 0;
    const monthlyFils = Math.round(Number(plan.monthlyPriceAed) * 100);
    // What the account is worth a month, which on an annual term is not the
    // list price. The same figure `mrrNow` sums, so `reconcile()` holds.
    const valueFils =
      term === "annual" ? Math.round((monthlyFils * monthsCharged) / 12) : monthlyFils;

    started.set(b.id, { planId, at: startedAt, fils: valueFils });

    /*
       The business is on the plan its subscription says it is.

       These two disagreed on six of eight seeded subscriptions, because the
       listing got a random plan at creation and this loop then wrote a
       different one onto the subscription without touching the business.
       `Business.planId` is what every entitlement read uses — `getOverview`,
       `effectiveFor`, the caps behind every locked panel — so a seller could be
       Pro on their billing screen and Free everywhere the plan actually does
       something. Found while checking that a seeded annual account renders;
       the billing panel read "You are on Free" above a yearly invoice.
    */
    await db.business.update({ where: { id: b.id }, data: { planId } });

    // The period this subscription is in. Annual renewals are far out; monthly
    // ones are within the month, which is what the screens expect to render.
    const renewsAt = term === "annual" ? days(int(60, 300)) : days(int(2, 30));

    await db.subscription.create({
      data: {
        businessId: b.id,
        planId,
        status: i === 7 ? "past_due" : "active",
        startedAt,
        renewsAt,
        term,
        /*
         * The period currently paid for. Backdated a term from its end rather
         * than set to the signup date, because `startedAt` can be two years ago
         * and proration divides by the length of the period a change lands in.
         */
        periodStartedAt: new Date(
          renewsAt.getTime() - (term === "annual" ? 365 : 30) * 86_400_000,
        ),
        anchorDay: renewsAt.getUTCDate(),
        /*
         * A real snapshot, with the caps in it. This used to be
         * `{ planId, capturedAt }` — no numbers — which meant every seeded
         * subscription looked grandfathered and was not.
         */
        entitlementSnapshot: snapshotOf(
          {
            id: plan.id,
            name: plan.name,
            monthlyPriceAed: Number(plan.monthlyPriceAed),
            enquiriesPerMonth: plan.enquiriesPerMonth,
            productLimit: plan.productLimit,
            locationLimit: plan.locationLimit,
            photoLimit: plan.photoLimit,
            teamSeats: plan.teamSeats,
            rankingMultiplier: Number(plan.rankingMultiplier),
            customDomain: plan.customDomain,
            siteVisitIncluded: plan.siteVisitIncluded,
            sortOrder: plan.sortOrder,
          },
          NOW,
        ) as unknown as object,
      },
    });

    /*
       What the row actually costs, not a literal.

       This was `planId === "pro" ? 899 : 349` beside a description hardcoding
       "monthly" — two numbers and a word that would go on saying so after
       somebody changed the plan or the term. The same drift the pricing work
       took out of the home band.
    */
    const amount = term === "annual" ? Number(plan.monthlyPriceAed) * monthsCharged : Number(plan.monthlyPriceAed);
    const periodLabel = term === "annual" ? "one year" : "one month";
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
            { kind: "subscription", description: `${plan.name} plan, ${periodLabel}`, qty: 1, amountAed: String(amount) },
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

  /*
     A subscription credit, as an invoice line. Never a refund of buyer money —
     there is no buyer money on the platform.

     `paying[0]` rather than `[1]`, because `[1]` is now the annual account and
     this invoice describes a month. A credit example is about the credit, and
     hanging it on the one row whose term contradicts the line would make it an
     example of something else.
  */
  const credited = paying[0]!;
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

  await seedMrrLedger(db, started);
}

/**
 * Backfill the MRR ledger.
 *
 * Board 4g's waterfall is a `GROUP BY` over `MrrMovement`, and opening MRR is
 * the running sum of everything before the window. Without a row per existing
 * subscription the opening balance is zero and the first month on the screen
 * shows the entire business arriving at once — which is exactly the kind of
 * number that gets screenshotted and then explained for a week.
 *
 * The invariant the ledger has to hold is that its total equals the live
 * subscription table. `reconcile()` checks it and the revenue screen shows the
 * answer, so a seed that got this wrong would be visible rather than silent.
 */
async function seedMrrLedger(db: Db, started: Map<string, { planId: string; at: Date; fils: number }>) {
  console.log("→ MRR movement ledger");

  let churned = 0;
  let expanded = 0;

  for (const [businessId, signup] of started) {
    await db.mrrMovement.create({
      data: {
        businessId,
        kind: "new_business",
        fromPlanId: null,
        toPlanId: signup.planId,
        deltaFils: signup.fils,
        mrrAfterFils: signup.fils,
        occurredAt: signup.at,
        note: "Signed up",
      },
    });
  }

  /*
   * Two accounts that are not in the live table at all: sellers who paid and
   * left. Every real directory has them and a waterfall with an empty churn
   * column looks like a bug. They are separate businesses rather than edits to
   * the paying ones, because the ledger has to reconcile against the live
   * subscription table and a churn on an account that still pays would not.
   */
  const gone = await db.business.findMany({
    where: { planId: "free", claimStatus: "claimed", subscription: null },
    select: { id: true },
    take: 2,
  });

  for (const [index, business] of gone.entries()) {
    const startedAt = days(-int(400, 600));
    const leftAt = days(-int(20, 120));
    const fils = index === 0 ? 34_900 : 89_900;

    await db.mrrMovement.create({
      data: {
        businessId: business.id,
        kind: "new_business",
        toPlanId: index === 0 ? "basic" : "pro",
        deltaFils: fils,
        mrrAfterFils: fils,
        occurredAt: startedAt,
        note: "Signed up",
      },
    });
    await db.mrrMovement.create({
      data: {
        businessId: business.id,
        kind: "churn",
        fromPlanId: index === 0 ? "basic" : "pro",
        toPlanId: "free",
        deltaFils: -fils,
        mrrAfterFils: 0,
        occurredAt: leftAt,
        note: index === 0 ? "Cancellation reached its end date" : "Dunning drop after 14 days past due",
      },
    });
    churned += 1;
  }

  /*
   * One expansion and one contraction, on accounts that are on the plan the
   * ledger ends at. Basic to Pro means the signup row has to say Basic, so the
   * two rows sum to what the account pays now — the seed writes the pair
   * rather than patching the signup, for the same reason the live code does.
   */
  const movers = [...started.entries()].filter(([, s]) => s.planId === "pro").slice(0, 1);
  for (const [businessId, signup] of movers) {
    await db.mrrMovement.updateMany({
      where: { businessId, kind: "new_business" },
      data: { toPlanId: "basic", deltaFils: 34_900, mrrAfterFils: 34_900 },
    });
    await db.mrrMovement.create({
      data: {
        businessId,
        kind: "expansion",
        fromPlanId: "basic",
        toPlanId: "pro",
        deltaFils: signup.fils - 34_900,
        mrrAfterFils: signup.fils,
        occurredAt: days(-int(10, 50)),
        note: "Plan change to Pro",
      },
    });
    expanded += 1;
  }

  console.log(`   ${started.size} signups, ${expanded} expansion, ${churned} churned`);
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

/**
 * Board 1m's fixture set: thirty-four published reviews, one held, one removed.
 *
 * Written out rather than generated. A review body is a person describing their
 * own job, and a template with a size substituted into it would be the platform
 * writing reviews — which is the thing this whole page exists to say it does
 * not do. The lengths vary deliberately: "Most detailed" sorts on body length,
 * and a set where every body is the same length cannot show that it works.
 *
 * `accepted` is the provenance rung. It is not a column on the review — the
 * page derives it from whether the enquiry released contact to this seller, so
 * a fixture that sets it here is setting the fact, not the label.
 */
interface ReviewFixture {
  overall: number;
  /** quotedAccurate, onTime, asDescribed, responsiveness. */
  scores: readonly [number, number, number, number];
  body: string;
  requirement: string;
  qty: number;
  accepted: boolean;
  showCompany: boolean;
  reply?: string;
  photos: number;
  photoAlt?: string;
  state: "published" | "held" | "removed";
}

const REVIEW_FIXTURES: readonly ReviewFixture[] = [
  {
    overall: 5, scores: [5, 5, 5, 5], accepted: true, showCompany: true, photos: 2,
    requirement: "DN100 resilient seated gate valves, PN16, flanged",
    qty: 40,
    photoAlt: "Gate valves on the pallet as delivered to site",
    body: "Forty DN100 gate valves for a chilled water riser, quoted the same afternoon and on site in three days. The price held to the quote and the certificates came with the delivery rather than a week later, which is what usually happens. The storeman had the crates broken down and counted before the driver left.",
    reply: "Thank you. We keep DN50 to DN200 on the floor in Al Quoz, so the three days is the delivery window rather than the lead time.",
    state: "published",
  },
  {
    overall: 5, scores: [5, 4, 5, 5], accepted: true, showCompany: true, photos: 0,
    requirement: "Wafer butterfly valves DN150 with gear operators",
    qty: 18,
    body: "Priced below the two quotes I had on paper and the gear operators were the ones specified rather than the nearest thing in stock. One day late against the date given, and they called about it the morning before.",
    state: "published",
  },
  {
    overall: 4, scores: [5, 3, 4, 4], accepted: true, showCompany: false, photos: 0,
    requirement: "Brass ball valves, assorted sizes",
    qty: 120,
    body: "Quote was accurate to the fils. Delivery slipped by two days over a public holiday, which was not really theirs to control.",
    state: "published",
  },
  {
    overall: 5, scores: [5, 5, 5, 4], accepted: false, showCompany: true, photos: 0,
    requirement: "Y-strainers DN80 cast iron, mesh 40",
    qty: 24,
    body: "Answered within the hour with stock and a lead time. We ended up going elsewhere on price but the reply was the fastest of the six we asked.",
    state: "published",
  },
  {
    overall: 5, scores: [5, 5, 5, 5], accepted: true, showCompany: true, photos: 1,
    requirement: "Swing check valves DN200, ductile iron",
    qty: 8,
    photoAlt: "Check valve body with the casting marks visible",
    body: "Second time using them for a pump room refit. Castings are clean, the flange drilling matched the drawing, and they took back two we over-ordered without an argument.",
    reply: "Appreciated. Returns on standard stock lines are fine within thirty days as long as the crate is unopened.",
    state: "published",
  },
  {
    overall: 3, scores: [4, 2, 3, 3], accepted: true, showCompany: true, photos: 0,
    requirement: "Flanged globe valves DN65",
    qty: 12,
    body: "The valves were right. The delivery was not — quoted three days, arrived on the ninth, and I had to chase twice to find out where it was. Fine on the goods, poor on telling me anything.",
    reply: "That was our transport contractor and we have changed it since. The chasing was the part we got wrong, not just the days.",
    state: "published",
  },
  {
    overall: 5, scores: [5, 5, 5, 5], accepted: false, showCompany: true, photos: 0,
    requirement: "PN25 butterfly valves for a fire ring main",
    qty: 30,
    body: "Sent a proper technical answer rather than a price list. Knew the Civil Defence requirement without being told it.",
    state: "published",
  },
  {
    overall: 4, scores: [4, 4, 5, 4], accepted: true, showCompany: true, photos: 0,
    requirement: "Stainless 316 ball valves DN25 threaded",
    qty: 60,
    body: "Exactly what was described, and the material certificates were the mill's rather than a photocopy of somebody's letterhead.",
    state: "published",
  },
  {
    overall: 5, scores: [5, 5, 5, 5], accepted: true, showCompany: true, photos: 3,
    requirement: "Complete valve package for a district cooling substation",
    qty: 1,
    photoAlt: "Valve package staged in the plant room before installation",
    body: "The biggest job we have given them: a full substation package across four sizes, staged over three deliveries so we were not storing it on a live site. Every drop arrived on the day agreed and the third one was pulled forward when we asked. Where they earned it was the two items they could not hold — they said so at quotation stage with an indent lead time rather than discovering it three weeks later, which is the failure that costs a programme.",
    reply: "Thank you. Staged delivery is worth asking for on anything over about twenty items, and we would rather flag an indent line at quotation than at delivery.",
    state: "published",
  },
  {
    overall: 2, scores: [2, 2, 3, 2], accepted: false, showCompany: false, photos: 0,
    requirement: "DN300 butterfly valves, urgent",
    qty: 4,
    body: "Replied quickly to say they had them and then took four days to confirm they did not. I would rather have been told no on day one.",
    reply: "Fair. The stock figure was a branch transfer that had not landed, and we now check the physical count before confirming anything above DN250.",
    state: "published",
  },
  {
    overall: 5, scores: [5, 5, 4, 5], accepted: true, showCompany: true, photos: 0,
    requirement: "Gate valves and strainers for a villa compound",
    qty: 22,
    body: "Small job by their standards and they still sent somebody to the site to measure before quoting. That is not nothing.",
    state: "published",
  },
  {
    overall: 4, scores: [4, 5, 4, 3], accepted: true, showCompany: true, photos: 0,
    requirement: "Bronze non-return valves DN40",
    qty: 35,
    body: "Delivered early. Slow to answer the first email, quick once the thing was moving.",
    state: "published",
  },
  {
    overall: 5, scores: [5, 5, 5, 5], accepted: false, showCompany: true, photos: 0,
    requirement: "Replacement seats for an existing valve set",
    qty: 16,
    body: "Identified the valve from a photograph and told me the seat kit part number in twenty minutes. Did not try to sell me new valves.",
    state: "published",
  },
  {
    overall: 3, scores: [3, 3, 4, 3], accepted: true, showCompany: true, photos: 1,
    requirement: "DN150 gate valves for a pump replacement",
    qty: 6,
    photoAlt: "Valve tag showing the pressure rating",
    body: "Adequate. The valves are fine and the paperwork was fine. Nothing went wrong and nothing was better than expected either, and at this price I would have liked one of those two.",
    state: "published",
  },
  {
    overall: 5, scores: [5, 5, 5, 5], accepted: true, showCompany: true, photos: 0,
    requirement: "Fire fighting valve set, UL listed",
    qty: 14,
    body: "UL listed as specified and they had the listing documents ready before I asked for them. Consultant approved it first time.",
    reply: "We hold the listings for everything on the fire lines. Ask at enquiry stage and they go out with the quote.",
    state: "published",
  },
  {
    overall: 4, scores: [4, 4, 4, 5], accepted: false, showCompany: true, photos: 0,
    requirement: "Assorted flanges and gaskets",
    qty: 200,
    body: "Answered on a Friday afternoon, which nobody else did. Priced a little above the market but I would ask them again.",
    state: "published",
  },
  {
    overall: 5, scores: [5, 5, 5, 5], accepted: true, showCompany: true, photos: 0,
    requirement: "DN80 butterfly valves with limit switches",
    qty: 10,
    body: "Switches wired and tested before they left the warehouse. Saved us a day on site.",
    state: "published",
  },
  {
    overall: 1, scores: [1, 1, 2, 1], accepted: false, showCompany: false, photos: 0,
    requirement: "Emergency replacement valve, same day",
    qty: 1,
    body: "Asked for one valve on an emergency and got a reply the next afternoon. By then the plant had been down for a shift and I had found it elsewhere. Their normal service may well be good; this was not.",
    reply: "We were closed when this came in and there is no overnight desk. That is our limit rather than an excuse, and the enquiry should have been answered at eight the next morning rather than at two.",
    state: "published",
  },
  {
    overall: 4, scores: [5, 4, 4, 4], accepted: true, showCompany: true, photos: 0,
    requirement: "Chilled water balancing valves DN50",
    qty: 48,
    body: "Quote was clear about what was stock and what was indent, with separate lead times for each. More suppliers should do that.",
    state: "published",
  },
  {
    overall: 5, scores: [5, 5, 5, 5], accepted: true, showCompany: true, photos: 0,
    requirement: "Ductile iron check valves DN125",
    qty: 9,
    body: "Straightforward. Quoted, delivered, invoiced, all as agreed.",
    state: "published",
  },
  {
    overall: 5, scores: [4, 5, 5, 5], accepted: true, showCompany: true, photos: 1,
    requirement: "Pressure reducing valves for a high rise",
    qty: 7,
    photoAlt: "Pressure reducing valve installed on the riser",
    body: "Set the reducing valves to our schedule before delivery and labelled each one with the floor it was for. Commissioning took an afternoon instead of two days.",
    reply: "Pre-setting and tagging is free on anything over five units. Send the schedule with the enquiry.",
    state: "published",
  },
  {
    overall: 3, scores: [3, 4, 3, 2], accepted: false, showCompany: true, photos: 0,
    requirement: "Butterfly valves DN200 wafer type",
    qty: 20,
    body: "Priced well and answered, but the answer took three days and I had already committed by then.",
    state: "published",
  },
  {
    overall: 5, scores: [5, 5, 5, 5], accepted: true, showCompany: true, photos: 0,
    requirement: "Strainers and isolation valves for a laundry plant",
    qty: 26,
    body: "Third job with them this year. Consistent, which is the whole thing I want from a stockist.",
    state: "published",
  },
  {
    overall: 4, scores: [4, 3, 5, 4], accepted: true, showCompany: false, photos: 0,
    requirement: "Gate valves DN65 for a retrofit",
    qty: 15,
    body: "Goods exactly as described. A day late and they told me the day before, which I can work with.",
    state: "published",
  },
  {
    overall: 5, scores: [5, 5, 5, 5], accepted: false, showCompany: true, photos: 0,
    requirement: "Technical query on seat material for treated water",
    qty: 1,
    body: "Asked a question rather than an enquiry and got a proper answer with the temperature limits written down. Went back to them with the real job a month later.",
    state: "published",
  },
  {
    overall: 2, scores: [3, 1, 2, 2], accepted: true, showCompany: true, photos: 0,
    requirement: "DN100 check valves, three week programme",
    qty: 11,
    body: "Two weeks late on a three week programme and the second delivery was short by two units, which nobody mentioned until I counted them. The credit came through without argument once I raised it, but I should not have been the one counting.",
    reply: "The shortage was ours and the delivery note was wrong, which is why nothing flagged it. We now count out against the note at the gate rather than at the rack.",
    state: "published",
  },
  {
    overall: 5, scores: [5, 5, 5, 5], accepted: true, showCompany: true, photos: 0,
    requirement: "Compact ball valves for a fit-out",
    qty: 80,
    body: "Bulk of small sizes, all in stock, collected from the counter the same morning.",
    state: "published",
  },
  {
    overall: 4, scores: [4, 4, 4, 4], accepted: false, showCompany: true, photos: 0,
    requirement: "Flanged gate valves DN250",
    qty: 5,
    body: "Solid reply with a firm indent lead time. We could not wait fourteen weeks but the answer was honest about it.",
    state: "published",
  },
  {
    overall: 5, scores: [5, 5, 5, 5], accepted: true, showCompany: true, photos: 0,
    requirement: "Valve spares for an annual maintenance contract",
    qty: 44,
    body: "They keep our AMC spares list on file and quote against it without me re-typing it every year.",
    state: "published",
  },
  {
    overall: 4, scores: [5, 4, 4, 3], accepted: true, showCompany: true, photos: 0,
    requirement: "Grooved end valves for a sprinkler main",
    qty: 28,
    body: "Right goods, right price, slightly hard to reach on the phone during the afternoon break.",
    state: "published",
  },
  {
    overall: 5, scores: [5, 5, 5, 5], accepted: true, showCompany: true, photos: 0,
    requirement: "Air release valves for a pumped main",
    qty: 6,
    body: "Small delivery, handled as carefully as the big ones.",
    state: "published",
  },
  {
    overall: 3, scores: [2, 3, 4, 3], accepted: false, showCompany: true, photos: 0,
    requirement: "Stainless butterfly valves for a coastal site",
    qty: 12,
    body: "The quoted figure moved between the first reply and the formal quote. Same goods, different number, and nobody explained the gap.",
    state: "published",
  },
  {
    overall: 5, scores: [5, 5, 5, 5], accepted: false, showCompany: true, photos: 0,
    requirement: "Emergency isolation valve, Sharjah site",
    qty: 2,
    body: "Held two units for us on a phone call and did not release them to anyone else while we arranged transport.",
    state: "published",
  },
  {
    overall: 4, scores: [4, 5, 4, 4], accepted: true, showCompany: true, photos: 0,
    requirement: "Bronze gate valves for a potable line",
    qty: 33,
    body: "WRAS approved as asked. Early delivery, and the driver waited while the storeman checked every box.",
    state: "published",
  },
  {
    overall: 1, scores: [1, 1, 1, 1], accepted: false, showCompany: false, photos: 0,
    requirement: "Valve set for a warehouse fit-out",
    qty: 18,
    body: "Held while our team checks a report.",
    state: "held",
  },
  {
    overall: 1, scores: [1, 1, 1, 1], accepted: false, showCompany: false, photos: 0,
    requirement: "Assorted valves",
    qty: 3,
    body: "Removed by moderation.",
    state: "removed",
  },
];

/**
 * A seller with enough reviews to have a reviews page, for board 1m.
 *
 * The rest of the seed carries one published review, which is what a young
 * directory honestly looks like and is exactly the wrong fixture for this
 * board: it exercises the "fewer than five" state and nothing else. Board 1m is
 * a distribution, four filter chips, four sorts, a page size and a held row,
 * and none of those can be looked at — or tested — against a single row.
 *
 * So one supplier gets a real review history and everybody else keeps theirs.
 * `al-manara-equipment-trading-llc` stays on one review and is the thin-page
 * fixture; `al-marwan-industrial-supplies-llc` stays on none, which is what
 * `storefront.spec.ts` asserts when it checks that `aggregateRating` is absent
 * where there is nothing to aggregate.
 *
 * **No PRNG draws in here.** Two comments in this file record what happens when
 * one moves: every business generated afterwards is renamed and a dozen test
 * files pin those slugs. Everything below is index arithmetic over fixed
 * arrays, so it can be added, reordered or removed without touching anything
 * else in the seed.
 */
async function seedReviewDepth(db: Db) {
  console.log("→ a review history, for board 1m");

  const category = await db.category.findFirst({
    where: { slug: "valves-and-fittings" },
    select: { id: true },
  });
  const area = await db.area.findFirst({
    where: { slug: "al-quoz-industrial-3" },
    select: { id: true, lat: true, lng: true },
  });
  if (!category || !area) {
    console.log("   skipped — the taxonomy this seller sits in is not in this seed");
    return;
  }

  /*
     A fixed slug, because it is the board's own URL and because every test that
     asserts a count on this page has to be able to find the page. The name
     collides with nothing: `NAME_PREFIX` carries "Al Waha", but the generated
     suffix differs and the claim search that broke on an ambiguous prefix
     searches "Al Marwan".
  */
  const seller = await db.business.upsert({
    where: { slug: "al-waha-industrial-supplies" },
    update: {},
    create: {
      tradeName: "Al Waha Industrial Supplies LLC",
      displayName: "Al Waha Industrial Supplies",
      slug: "al-waha-industrial-supplies",
      licenceNumber: "DED-664201",
      licenceAuthority: "DED",
      licenceExpiry: days(420),
      trn: "100664201900003",
      establishedYear: 2009,
      teamSize: "b11_50",
      languages: ["English", "Arabic", "Hindi"],
      description:
        "Valve and fitting stockist supplying MEP contractors across Dubai and the Northern Emirates. Counter sales, scheduled site delivery and an indent desk for sizes held off the shelf.",
      verificationTier: 3,
      verifiedAt: days(-64),
      visitedAt: days(-64),
      claimStatus: "claimed",
      planId: "pro",
      primaryCategoryId: category.id,
      source: "self_added",
      publishedAt: days(-380),
      themePreset: "industrial",
      paymentTerms: "30 days on approved account · 50% with order otherwise",
      ratingOverall: null,
      reviewCount: 0,
      derivedAt: NOW,
      locations: {
        create: {
          type: "head_office",
          emirate: "dubai",
          areaId: area.id,
          addressLine: "Warehouse 11, Street 8, Al Quoz Industrial 3",
          published: true,
          phone: "043470112",
          whatsapp: "+971506610044",
          phoneVerified: true,
          lat: area.lat === null ? null : Number((area.lat + 0.004).toFixed(6)),
          lng: area.lng === null ? null : Number((area.lng - 0.003).toFixed(6)),
          hours: {
            sun: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "20:00" }],
            mon: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "20:00" }],
            tue: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "20:00" }],
            wed: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "20:00" }],
            thu: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "18:00" }],
            sat: [{ open: "08:00", close: "13:00" }],
          },
        },
      },
    },
    select: { id: true, slug: true },
  });

  const existing = await db.review.count({ where: { businessId: seller.id } });
  if (existing > 0) {
    console.log(`   skipped — ${seller.slug} already has ${existing} reviews`);
    return;
  }

  /*
     Buyers with names, because a page of thirty-four reviews from two accounts
     reads as a fixture rather than as a directory. Each is a real shape: a
     company that shows its name, a company that does not, and a sole trader
     with no company at all.
  */
  const BUYERS = [
    { company: "Harbour Contracting LLC", person: "Rashid Al Hameli", emirate: "dubai" },
    { company: "Marina Facilities LLC", person: "Suhail Bin Haider", emirate: "dubai" },
    { company: "Cornerstone MEP Contracting LLC", person: "Anita Menon", emirate: "sharjah" },
    { company: "Deira Cold Store LLC", person: "Yousef Haddad", emirate: "dubai" },
    { company: "Northgate Facilities Management LLC", person: "Priya Raghavan", emirate: "abu_dhabi" },
    { company: null, person: "Imran Sheikh", emirate: "dubai" },
    { company: "Bluewater Marine Services LLC", person: "Kareem Nassar", emirate: "sharjah" },
    { company: "Sandpiper Property Services LLC", person: "Grace Okoye", emirate: "ajman" },
  ] as const;

  const buyerIds: string[] = [];
  for (const [index, buyer] of BUYERS.entries()) {
    const id = uuid(300 + index);
    const companyId = buyer.company
      ? (
          await db.buyerCompany.create({
            data: { name: buyer.company, emirate: buyer.emirate as never },
            select: { id: true },
          })
        ).id
      : null;
    await db.user.create({
      data: {
        id,
        phone: `+9715${index}${(4110022 + index * 137).toString().padStart(7, "0")}`,
        fullName: buyer.person,
        roles: ["buyer"],
        ...(companyId ? { buyerCompanyId: companyId } : {}),
      },
    });
    buyerIds.push(id);
  }

  /*
     Thirty-four published reviews, plus one held and one removed.

     Each row is written rather than generated: a review body is a person
     describing their own job, and a template with a size substituted into it
     would be the platform writing reviews. The lengths vary because "Most
     detailed" sorts on length and a fixture where every body is the same
     length cannot show that the sort does anything.

     `accepted` decides the provenance rung, which is derived from the enquiry
     rather than stored — an accepted row releases contact to this seller, an
     unaccepted one only records that the seller replied.
  */
  let created = 0;
  let photos = 0;

  for (const [index, row] of REVIEW_FIXTURES.entries()) {
    const buyerId = buyerIds[index % buyerIds.length]!;
    const createdAt = days(-(4 + index * 9));

    const enquiry = await db.enquiry.create({
      data: {
        ref: `ENQ-7${(200 + index).toString().padStart(3, "0")}`,
        buyerId,
        requirement: row.requirement,
        closesAt: new Date(createdAt.getTime() - 7 * 86_400_000),
        createdAt: new Date(createdAt.getTime() - 21 * 86_400_000),
        ...(row.accepted
          ? {
              contactReleasedToBusinessId: seller.id,
              contactReleasedAt: new Date(createdAt.getTime() - 9 * 86_400_000),
            }
          : {}),
        lines: { create: [{ description: row.requirement, qty: row.qty, sortOrder: 0 }] },
      },
      select: { id: true },
    });

    /*
       The recipient row is what makes the second rung true.

       `firstReplyAt` is the column response time is measured from, and
       `canReview` reads exactly it: a supplier who received a fan-out and never
       answered is not a supplier the buyer has anything to report on.
    */
    await db.enquiryRecipient.create({
      data: {
        enquiryId: enquiry.id,
        businessId: seller.id,
        // `quoted` either way: the second rung is "this seller answered", and
        // a quote that was sent and not accepted is exactly that. `delivered`
        // would describe a supplier who never replied, which is the case the
        // gate refuses.
        state: "quoted",
        openedAt: new Date(createdAt.getTime() - 20 * 86_400_000),
        firstReplyAt: new Date(createdAt.getTime() - 20 * 86_400_000 + 3_600_000),
        createdAt: new Date(createdAt.getTime() - 21 * 86_400_000),
      },
    });

    const review = await db.review.create({
      data: {
        businessId: seller.id,
        buyerId,
        enquiryId: enquiry.id,
        overall: row.overall,
        quotedAccurate: row.scores[0],
        onTime: row.scores[1],
        asDescribed: row.scores[2],
        responsiveness: row.scores[3],
        body: row.body,
        showCompanyName: row.showCompany,
        editableUntil: new Date(createdAt.getTime() + 14 * 86_400_000),
        createdAt,
        ...(row.reply
          ? {
              sellerReply: row.reply,
              sellerRepliedAt: new Date(createdAt.getTime() + 2 * 86_400_000),
            }
          : {}),
        ...(row.state === "held"
          ? {
              heldAt: days(-2),
              heldReason:
                "Reported as containing a third party's mobile number. Held while the reporter's evidence is checked.",
            }
          : {}),
        ...(row.state === "removed"
          ? {
              removedAt: days(-11),
              removalReason:
                "provably_false: names a delivery date the enquiry thread shows was never quoted, and the reviewer withdrew the claim on being asked.",
            }
          : {}),
      },
      select: { id: true },
    });

    /*
       Photographs on a handful of them, so the "With photos" chip counts
       something. The objects are not in the bucket — nothing uploads during a
       seed — so these 404 at the storage layer exactly as the seeded datasheet
       does. That is the honest failure for a fixture: it does not pretend a
       file exists.
    */
    for (let p = 0; p < row.photos; p += 1) {
      await db.media.create({
        data: {
          kind: "review",
          reviewId: review.id,
          storagePath: `reviews/${review.id}/${p + 1}.jpg`,
          alt: row.photoAlt ?? "Goods as delivered, photographed by the buyer",
          sortOrder: p,
        },
      });
      photos += 1;
    }

    created += 1;
  }

  const published = REVIEW_FIXTURES.filter((row) => row.state === "published").length;
  const accepted = REVIEW_FIXTURES.filter(
    (row) => row.state === "published" && row.accepted,
  ).length;
  console.log(
    `   ${created} on ${seller.slug} — ${published} published, ${accepted} from accepted quotes, ` +
      `${photos} photos`,
  );
}

/**
 * Reviews that exist to be removed.
 *
 * `/admin/reviews` sorts by `removedAt` and then `createdAt` descending, and
 * the e2e test for criterion 9 removed whatever that put first. On a fresh seed
 * that is one of the five `ENQ-BEST-*-0` rows: `seedCurated` gives each of its
 * listings exactly `MIN_REVIEWS` reviews and dates the first of each two days
 * ago, so the top of the moderation queue is always the curated fixture. The
 * listing it belongs to drops to fourteen countable reviews and off
 * `/best/hvac-suppliers-al-quoz` the moment the moderation test passes, and
 * four assertions fail in `curated.spec.ts` — a file that never mentions the
 * admin console.
 *
 * CI never saw it. One worker, and the `staff` project runs after `chromium`
 * and `mobile`, so the curated page was always read before the review was
 * taken. It only appears locally, where `pnpm test:e2e` does not reseed and a
 * removal is irreversible by design, so the first run to draw `al-hvac-001`
 * breaks the list until somebody reseeds.
 *
 * The other destructive console tests hand back what they take: the suspension
 * test lifts, the tier test moves the row to the tier it is not on. Removal has
 * no undo, so it is given something expendable rather than the first row it can
 * reach.
 *
 * The host is suspended, which keeps it off every public surface — search, the
 * category and area counts, the curated lists, its own storefront — so nothing
 * it carries is a number another test asserts. `main` truncates before it
 * writes, so the pool comes back whole on every `pnpm db:seed`; the eight are
 * the headroom between one reseed and the next, since `pnpm test:e2e` does not
 * reseed and each run takes one.
 */
async function seedModerationQueue(db: Db) {
  console.log("→ reviews that exist to be removed, for the console's criterion 9");

  const category = await db.category.findFirst({
    where: { slug: "valves-and-fittings" },
    select: { id: true },
  });
  if (!category) {
    console.log("   skipped — the taxonomy this host sits in is not in this seed");
    return;
  }

  /*
     A fixed slug and a prefix that is not in `NAME_PREFIX`, so the generated
     businesses can never collide with it and the test can scope to the name
     without matching a second row.
  */
  const host = await db.business.upsert({
    where: { slug: "jebel-rock-trading" },
    update: {},
    create: {
      tradeName: "Jebel Rock Trading LLC",
      displayName: "Jebel Rock Trading",
      slug: "jebel-rock-trading",
      licenceNumber: "DED-771904",
      licenceAuthority: "DED",
      licenceExpiry: days(180),
      establishedYear: 2016,
      description:
        "Valve and fitting stockist. Suspended while the licence holder is contacted, and kept in the seed because a moderator still has to be able to act on what was written about it.",
      verificationTier: 1,
      claimStatus: "claimed",
      primaryCategoryId: category.id,
      source: "self_added",
      publishedAt: days(-300),
      /*
         Suspended, and that is the point rather than colour. A suspended
         listing is on no public surface, so the reviews below are counted by
         nothing: not a rating, not a curated list, not an area tally. They are
         only ever read by the moderation queue, which does not filter on
         publication because a removal decision does not wait for one.
      */
      suspendedAt: days(-9),
    },
    select: { id: true, slug: true },
  });

  /*
     Eight, so a local run has headroom before it has to reseed, and each with
     its own words: `ModerationRow` quotes the body in full and a queue of eight
     identical sentences would not show that it does.
  */
  const BODIES = [
    "Quoted quickly but the sizes on the quote were not the sizes on my enquiry.",
    "Two of the four valves arrived with the wrong end connection and the swap took a fortnight.",
    "Counter staff were helpful. Delivery was a day later than the date on the quote.",
    "Priced well above the others and would not put the lead time in writing.",
    "Stock said available and it was not. Told after I had paid a deposit elsewhere.",
    "Fine on the small order, no answer at all on the second one.",
    "The gaskets were not the grade written on the quote and nobody would say why.",
    "Answered the enquiry the same day and then went quiet for three weeks.",
  ];

  let written = 0;
  for (const [index, body] of BODIES.entries()) {
    const ref = `ENQ-MOD-${index}`;
    const existing = await db.enquiry.findUnique({ where: { ref }, select: { id: true } });
    if (existing) continue;

    const buyer = await db.user.create({
      data: { id: uuid(700 + index), fullName: `Moderation Queue Buyer ${index}`, roles: ["buyer"] },
      select: { id: true },
    });
    const createdAt = days(-(30 + index));
    const enquiry = await db.enquiry.create({
      data: {
        ref,
        buyerId: buyer.id,
        requirement: "Gate valves and flanged fittings for a pump room, sizes on the drawing.",
        closesAt: new Date(createdAt.getTime() + 14 * 86_400_000),
        createdAt,
      },
      select: { id: true },
    });
    /*
       The recipient row, because a review without one describes a buyer
       reviewing a supplier who never received the enquiry. `canReview` reads
       exactly this column and the seed does not get to skip the rung it makes
       every other fixture carry.
    */
    await db.enquiryRecipient.create({
      data: {
        enquiryId: enquiry.id,
        businessId: host.id,
        state: "quoted",
        createdAt,
        firstReplyAt: new Date(createdAt.getTime() + 5 * 3_600_000),
      },
    });
    await db.review.create({
      data: {
        businessId: host.id,
        buyerId: buyer.id,
        enquiryId: enquiry.id,
        overall: 1 + (index % 3),
        quotedAccurate: 1 + (index % 3),
        onTime: 1 + ((index + 1) % 3),
        asDescribed: 1 + ((index + 2) % 3),
        responsiveness: 1 + (index % 2),
        body,
        editableUntil: new Date(createdAt.getTime() + 14 * 86_400_000),
        createdAt: new Date(createdAt.getTime() + 2 * 86_400_000),
      },
    });
    written += 1;
  }

  console.log(`   ${written} on ${host.slug}, which is suspended`);
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
      claimConflicts: await prisma.claimConflict.count(),
      undecidedClaims: await prisma.claimSubmission.count({ where: { decidedAt: null } }),
      visitRequests: await prisma.siteVisitRequest.count(),
      auditEvents: await prisma.auditEvent.count(),
      contactReveals: await prisma.contactReveal.count(),
      zeroResults: await prisma.zeroResultQuery.count(),
      guides: await prisma.guide.count(),
      areaPages: await prisma.areaPage.count(),
      curatedLists: await prisma.curatedList.count(),
      legalPages: await prisma.legalPage.count(),
    };
    console.log("\nseeded:");
    for (const [k, v] of Object.entries(counts)) console.log(`  ${String(v).padStart(4)}  ${k}`);
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    /*
       A refusal is an answer, not a crash. Printing the error object dumps a
       stack nobody needs above the sentence that matters — and the object used
       to carry the connection string, so the first version of this guard
       printed the password it was protecting. The message alone, for this one.
    */
    if (e instanceof NonLocalTargetError) console.error(`\n${e.message}`);
    else console.error(e);
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
          // Board 8a's one nudge. Routed here as well as templated, because an
          // event absent from a seller's matrix sends nothing at all — a seeded
          // template with no routing row is a feature that looks wired and is
          // not, which is how the nudge would have been judged as dead.
          setup_nudge: ["whatsapp", "in_app"],
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
  /*
     The renewal receipt.

     Email and in-app, and deliberately no WhatsApp: a receipt is a record
     somebody keeps for their accountant, and `INTERRUPTING_CHANNELS` exists to
     stop us buzzing a phone with something nobody has to act on. It is also the
     only template here sent by a cron rather than by a request.

     The amount is the period's, not the month's — an annual seller reads what
     they were actually charged.
  */
  {
    event: "subscription_renewed",
    channel: "email",
    body:
      "Your {planName} plan has been charged {amount}. The next payment is due {renewsAt}. " +
      "Your invoice is on the billing page.",
    actionLabel: "See the invoice",
    actionPath: "/dashboard/billing",
    status: "live",
  },
  {
    event: "subscription_renewed",
    channel: "in_app",
    body: "{planName} charged {amount}. Next payment {renewsAt}.",
    actionLabel: "See the invoice",
    actionPath: "/dashboard/billing",
    status: "live",
  },
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
  /*
     Board 8a's one nudge, and the only template here whose recipient did not
     ask for it.

     WhatsApp because that is what the hub promises out loud — "one WhatsApp
     three days after you went live if anything is still open, then nothing" —
     and in-app because the delivery log should carry a real row rather than a
     skip when Meta has not approved the words yet. **Deliberately no email.**
     An email fallback is a second message, and the promise is one.

     `pending_meta` like every other WhatsApp template: Meta approves the words
     before they can be sent, and seeding one live would have the send layer
     believe in a template that does not exist on the Bird side.
  */
  {
    event: "setup_nudge",
    channel: "whatsapp",
    // One string rather than two concatenated: the criterion-8 scan in
    // tests/unit/notification-templates.test.ts matches `body: "…"` and reads
    // only the first chunk, so a split body hides half of itself from the check
    // that exists to stop a template carrying contact details.
    body: "Your listing is live and some setup is still open: {taskList}. About {minutes} minutes of work. This is the only reminder we send.",
    actionLabel: "Finish setting up",
    actionPath: "/dashboard/setup",
    metaTemplateName: "bl_setup_nudge_v1",
    status: "pending_meta",
  },
  {
    event: "setup_nudge",
    channel: "in_app",
    body: "Still open on your listing: {taskList}. About {minutes} minutes of work.",
    actionLabel: "Finish setting up",
    actionPath: "/dashboard/setup",
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

  const claimRows = [
      {
        // Undecided sits at `unclaimed`: the submission has not moved the
        // listing yet. Nothing about the row says pending except the absence
        // of a decision, which is what the queue filters on.
        businessId: phoneClaimTarget.id,
        claimantId: claimantPhone.id,
        route: "phone_callback" as const,
        phone: "+97143472290",
        createdAt: days(-1),
      },
      {
        businessId: licenceClaimTarget.id,
        claimantId: claimantLicence.id,
        route: "licence_upload" as const,
        documentId: licenceDoc.id,
        createdAt: days(-3),
      },
      {
        // The state handoff 3 takes and handoff 4 resolves: somebody already
        // holds this listing and a second person says it is theirs. Taken
        // anyway, flagged, and staff see both sides.
        businessId: contestedTarget.id,
        claimantId: claimantContesting.id,
        route: "licence_upload" as const,
        documentId: contestedDoc.id,
        contested: true,
        createdAt: days(-7),
      },
      {
        businessId: approvedTarget.id,
        claimantId: approvedOwner,
        route: "phone_callback" as const,
        phone: "+97142678831",
        status: "claimed" as const,
        decidedAt: days(-40),
        decisionReason:
          "Called the number on the DED record and reached the manager named on the licence. Ownership confirmed on the call.",
        createdAt: days(-42),
      },
      {
        businessId: refusedTarget.id,
        claimantId: claimantRefused.id,
        route: "phone_callback" as const,
        phone: "+97165331074",
        contested: true,
        status: "disputed" as const,
        decidedAt: days(-15),
        decisionReason:
          "Claimant could not name the licence holder and the number reached a different company. Listing stays with the existing holder; claimant told what evidence would change that.",
        createdAt: days(-18),
      },
  ];

  // Created one at a time rather than with createMany: the conflict row below
  // needs the contested submission's id, and createMany does not return them.
  const claimIds: string[] = [];
  for (const row of claimRows) {
    const created = await db.claimSubmission.create({ data: row, select: { id: true } });
    claimIds.push(created.id);
  }
  const contestedClaimId = claimIds[2]!;

  // ── A conflicting claim, with both sides ──────────────────────────────────
  // Board 4c needs a pair, not a flag. `contested` has been a boolean since
  // handoff 3 and flagged nothing to anybody; the conflict row is what the
  // queue actually renders.

  const conflictTarget = disputed[0]!;
  const rivalClaimant = await db.user.create({
    data: {
      id: uuid(914),
      phone: "+971509912074",
      fullName: "Yusuf Rahman",
      roles: ["buyer"],
    },
  });
  const rivalDoc = await db.document.create({
    data: {
      kind: "trade_licence",
      businessId: conflictTarget.id,
      storagePath: `documents/${conflictTarget.id}/second-licence.pdf`,
      filename: "second-licence.pdf",
      bytes: 401_338,
      mimeType: "application/pdf",
      createdAt: days(-6),
    },
  });
  const rivalClaim = await db.claimSubmission.create({
    data: {
      businessId: conflictTarget.id,
      claimantId: rivalClaimant.id,
      route: "licence_upload",
      documentId: rivalDoc.id,
      contested: true,
      createdAt: days(-6),
    },
    select: { id: true },
  });

  await db.claimConflict.create({
    data: {
      businessId: conflictTarget.id,
      submissionAId: contestedClaimId,
      submissionBId: rivalClaim.id,
      buyersWaiting: await db.enquiryRecipient.count({
        where: { businessId: conflictTarget.id, state: { in: ["delivered", "opened"] } },
      }),
      createdAt: days(-6),
    },
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

/**
 * A branch network, for board 1f.
 *
 * Every catalogue in this seed was in one emirate, every location was pinned,
 * and no business had a sales office or a closure. Four of board 1f's states
 * were therefore unreachable in a browser and could only be seen in a unit
 * test — the emirate cap on the header sub-line, the type badge that stops a
 * buyer driving to an office, the unpinned branch that keeps its address and
 * loses its pin, and the closure strip.
 *
 * Appended for the reason `seedDeepCatalogue` above it is: the PRNG is a
 * sequence, and a draw inserted earlier renames every business generated after
 * it.
 */
/**
 * The quotes on `/for-buyers` and `/list-your-business`.
 *
 * Development data, and nothing more. These people do not exist — they are the
 * same invented cast as the businesses and buyers above, written so the entry
 * pages have a populated state to render in the gallery and in e2e.
 *
 * They are deliberately not in the production database, and this file is the
 * reason they can be: a testimonial is an attributed claim, `attribution` is
 * `NOT NULL` because an unsigned one is the platform talking about itself in a
 * borrowed voice, and a directory that checks trade licences for a living
 * cannot be the thing publishing quotes nobody said. Real ones are written
 * through `/admin/content/testimonials` by somebody who has the sender's
 * permission.
 *
 * Voice, per §08: each names something specific — an area, a lead time, a
 * count — because the vague version is what an invented quote reads like and
 * the specific version is what a real one does. If these ever get mistaken for
 * production copy, the specificity is what will give them away.
 */
async function seedTestimonials(db: Db) {
  console.log("→ entry page testimonials");

  const quotes = [
    {
      audience: "buyer" as const,
      body: "We had three days to find a stockist for DN100 gate valves in Al Quoz. Four suppliers quoted by the next morning and two of them had the stock on the shelf.",
      attribution: "Rashid Al Hameli",
      context: "Procurement Manager, Harbour Contracting LLC",
      sortOrder: 0,
    },
    {
      audience: "buyer" as const,
      body: "The licence check is the part we use most. Half the suppliers we used to ring had a website and nothing behind it, and we were the ones finding that out.",
      attribution: "Fatima Al Zaabi",
      context: "Facilities, Sharjah",
      sortOrder: 1,
    },
    {
      audience: "supplier" as const,
      body: "Eleven enquiries in the first month and we quoted nine of them. The two we let go were outside our range, which is a better problem than silence.",
      attribution: "Imran Qureshi",
      context: "Owner, Al Marwan Industrial Supplies",
      sortOrder: 0,
    },
    {
      audience: "supplier" as const,
      body: "Being able to point at a badge we did not award ourselves ended an argument we used to have on every first call.",
      attribution: "Deepa Nair",
      context: "Sales Director, Gulf Valve & Fitting Co",
      sortOrder: 1,
    },
  ];

  for (const quote of quotes) {
    const already = await db.testimonial.findFirst({
      where: { attribution: quote.attribution },
      select: { id: true },
    });
    if (already) continue;

    await db.testimonial.create({
      // Published, because an unpublished one renders nothing and the whole
      // point of seeding these is that the section has something to draw.
      data: { ...quote, publishedAt: days(-21) },
    });
  }

  console.log(`   ${quotes.length} quotes across the two entry pages`);
}

async function seedBranchNetwork(db: Db) {
  console.log("→ a branch network, for board 1f");

  const seller = await db.business.findFirst({
    where: { slug: "al-marwan-industrial-supplies-llc" },
    select: { id: true },
  });
  if (!seller) {
    console.log("   skipped — the flagship seller is not in this seed");
    return;
  }

  const areaBySlug = new Map(
    (
      await db.area.findMany({
        where: {
          slug: {
            in: ["mussafah-m17", "sharjah-industrial-area-12", "ajman-new-industrial-area"],
          },
        },
        select: { id: true, slug: true },
      })
    ).map((area) => [area.slug, area.id]),
  );

  /* The standard week these branches keep. Split shifts, as the market runs. */
  const WEEK = {
    mon: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "20:00" }],
    tue: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "20:00" }],
    wed: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "20:00" }],
    thu: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "18:00" }],
    sat: [{ open: "08:00", close: "13:00" }],
  };
  const OFFICE_WEEK = {
    mon: [{ open: "08:30", close: "17:30" }],
    tue: [{ open: "08:30", close: "17:30" }],
    wed: [{ open: "08:30", close: "17:30" }],
    thu: [{ open: "08:30", close: "17:30" }],
    fri: [{ open: "08:30", close: "12:00" }],
  };
  /* Reduced hours, applied automatically inside the platform's Ramadan window. */
  const RAMADAN = { all: [{ open: "09:00", close: "15:00" }] };

  const rows = [
    {
      /*
         Criterion 6. A buyer must not drive to an office expecting a trade
         counter, so this one renders "Sales only" where the others show hours.
      */
      slug: "mussafah-m17",
      type: "sales_office" as const,
      emirate: "abu_dhabi" as const,
      addressLine: "Office 402, Al Fahim Building, Mussafah M-14",
      lat: 24.3512,
      lng: 54.5089,
      phone: "025531190",
      hours: OFFICE_WEEK,
      radius: null,
      closure: null,
    },
    {
      /* A closure, which outranks the hours on the badge and gets its own strip. */
      slug: "sharjah-industrial-area-12",
      type: "depot" as const,
      emirate: "sharjah" as const,
      addressLine: "Plot 217, Industrial Area 12",
      lat: 25.3218,
      lng: 55.4033,
      phone: "065528810",
      hours: WEEK,
      radius: 40,
      closure: {
        from: days(-6),
        until: days(24),
        reason: "Roof repairs after the storm. Collections are running from Al Quoz until then.",
      },
    },
    {
      /*
         Criterion 4. No coordinates, so no pin — and the address still renders,
         because it is useful, and it is never approximated to an area centroid.
      */
      slug: "ajman-new-industrial-area",
      type: "trade_counter" as const,
      emirate: "ajman" as const,
      addressLine: "Shop 11, Al Jurf Industrial 1",
      lat: null,
      lng: null,
      phone: "067481120",
      hours: WEEK,
      radius: null,
      closure: null,
    },
  ];

  for (const row of rows) {
    const areaId = areaBySlug.get(row.slug);
    if (!areaId) continue;
    const existing = await db.location.findFirst({
      where: { businessId: seller.id, areaId, type: row.type },
      select: { id: true },
    });
    if (existing) continue;

    await db.location.create({
      data: {
        businessId: seller.id,
        areaId,
        type: row.type,
        emirate: row.emirate,
        addressLine: row.addressLine,
        lat: row.lat,
        lng: row.lng,
        phone: row.phone,
        whatsapp: row.type === "sales_office" ? null : "+971506412288",
        phoneVerified: true,
        hours: row.hours,
        ramadanHours: row.type === "sales_office" ? undefined : RAMADAN,
        serviceRadiusKm: row.radius,
        published: true,
        closedFrom: row.closure?.from ?? null,
        closedUntil: row.closure?.until ?? null,
        closureReason: row.closure?.reason ?? null,
      },
    });
  }

  /*
     The delivery promise, in the seller's own words.

     `coverageOf` will not invent one — a business that has said nothing about
     delivery gets no card rather than a reassuring sentence the platform made
     up. This is what a supplier actually writes.
  */
  await db.business.update({
    where: { id: seller.id },
    data: {
      deliveryNote:
        "Same-day inside Dubai on stocked lines · 48h to Northern Emirates and Abu Dhabi",
    },
  });

  /*
     Criterion 5 needs a supplier whose locations are *all* unpinned, so the map
     column is replaced by the explanatory panel rather than showing a partial
     map. Unpinning one branch of a multi-branch business would not reach it.
  */
  const unpinnable = await db.business.findFirst({
    where: {
      claimStatus: { not: "unclaimed" },
      publishedAt: { not: null },
      slug: { not: "al-marwan-industrial-supplies-llc" },
      locations: { every: { lat: { not: null } } },
    },
    orderBy: { slug: "asc" },
    select: { id: true, slug: true, _count: { select: { locations: true } } },
  });
  if (unpinnable && unpinnable._count.locations > 0) {
    await db.location.updateMany({
      where: { businessId: unpinnable.id },
      data: { lat: null, lng: null },
    });
    console.log(`   ${unpinnable.slug} left unpinned, for the no-pins panel`);
  }
}

/**
 * What board 1g's product page needs and no seed produced.
 *
 * Four of its sections could not be seen at all: no product carried a
 * datasheet, an image or an answered question, and no two verified sellers
 * carried the same spec — so the comparison table and the other-sellers card
 * rendered their empty states on every product on the platform, which made the
 * "only verified listing" copy look like the normal case rather than the
 * notable one.
 *
 * Appended, for the reason the two blocks above it are: the PRNG is a sequence,
 * and a draw inserted earlier renames every business generated after it.
 */
async function seedProductDetail(db: Db) {
  console.log("→ documents, questions and a spec twin, for board 1g");

  const seller = await db.business.findFirst({
    where: { slug: "al-marwan-industrial-supplies-llc" },
    select: { id: true, primaryCategoryId: true },
  });
  if (!seller) {
    console.log("   skipped — the flagship seller is not in this seed");
    return;
  }

  /*
     A product that actually has a spec.

     The comparison table matches on filterable spec values, and a listing with
     none of them filled has nothing to match — so hanging these fixtures on
     whichever product sorted first produced a page where every 1g section was
     its own empty state. `specValues` is JSON, so "has any" is a `not: {}`
     rather than a length check.
  */
  const flagship = await db.product.findFirst({
    where: {
      businessId: seller.id,
      status: { not: "draft" },
      availability: "in_stock",
      specValues: { not: {} },
    },
    orderBy: { slug: "asc" },
    select: { id: true, name: true, categoryId: true, specValues: true, slug: true },
  });
  if (!flagship) {
    console.log("   skipped — the flagship seller has no published product");
    return;
  }

  /*
     Payment terms, so the detail list has four rows rather than three and a
     gap. Free text because terms here are a negotiation — board 1d's reason.
  */
  await db.business.update({
    where: { id: seller.id },
    data: { paymentTerms: "30 days on approved account · 50% with order otherwise" },
  });

  /*
     A datasheet, downloadable without an enquiry or a login.

     `datasheet` is in `PUBLISHABLE_DOCUMENT_KINDS`, so the signed-URL route
     will serve it. The storage path is the shape the uploader writes; nothing
     is actually in the bucket for a seeded row, and the link 404s at the
     storage layer rather than at ours — which is the honest failure for a
     fixture and does not pretend the file exists.
  */
  const existingDoc = await db.document.findFirst({
    where: { productId: flagship.id, kind: "datasheet" },
    select: { id: true },
  });
  if (!existingDoc) {
    await db.document.createMany({
      data: [
        {
          productId: flagship.id,
          kind: "datasheet",
          storagePath: `products/${flagship.id}/datasheet.pdf`,
          filename: "scan_0043_final.pdf",
          displayName: `${flagship.name} — technical datasheet`,
          isPublic: true,
          bytes: 491_520,
          mimeType: "application/pdf",
        },
        {
          productId: flagship.id,
          kind: "certificate",
          storagePath: `products/${flagship.id}/wras.pdf`,
          filename: "WRAS-2024-scan.pdf",
          displayName: "WRAS approval — potable water",
          isPublic: true,
          bytes: 212_992,
          mimeType: "application/pdf",
        },
      ],
    });
  }

  /*
     Two answered questions and one unanswered.

     The unanswered one is the point of the third: it must not reach the public
     card. A page listing questions nobody replied to reads as a supplier who
     ignores people, and that is a claim we would be making on their behalf out
     of an absence — so it sits in the seller's queue instead.
  */
  const questionCount = await db.productQuestion.count({ where: { productId: flagship.id } });
  if (questionCount === 0) {
    await db.productQuestion.createMany({
      data: [
        {
          productId: flagship.id,
          businessId: seller.id,
          body: "Is the seat EPDM or NBR? We are on potable water and the consultant has specified WRAS.",
          answer:
            "EPDM as standard, and it is WRAS approved — the certificate is on this page. NBR is available on indent, about three weeks.",
          answeredAt: days(-9),
        },
        {
          productId: flagship.id,
          businessId: seller.id,
          body: "Can you supply with the counter flanges and bolts as a set?",
          answer: "Yes. Tell us the flange standard on the enquiry and we will quote it as one line.",
          answeredAt: days(-21),
        },
        {
          productId: flagship.id,
          businessId: seller.id,
          body: "Do you hold DN200 in the same range?",
        },
      ],
    });
  }

  /*
     A second verified seller carrying the same spec, so the comparison table
     and the other-sellers card have something true to say.

     The values are copied from the flagship rather than invented: the table's
     whole premise is that specs are templated and the rows line up, and a twin
     built from different values would demonstrate the opposite. Lead time and
     reply time differ, which is what the table is actually comparing.
  */
  /*
     Any verified, published seller will do — the twin's own primary category is
     irrelevant, because the product it carries names its category explicitly.
     Requiring a matching `primaryCategoryId` found nobody and left the
     comparison table with a single row, which renders as nothing at all.
  */
  const twinSeller = await db.business.findFirst({
    where: {
      id: { not: seller.id },
      verificationTier: { gte: 2 },
      publishedAt: { not: null },
      suspendedAt: null,
    },
    orderBy: { slug: "asc" },
    select: { id: true, slug: true },
  });

  if (twinSeller) {
    const twinSlug = `${flagship.slug}-alt`;
    const already = await db.product.findFirst({
      where: { businessId: twinSeller.id, slug: twinSlug },
      select: { id: true },
    });
    if (!already) {
      await db.product.create({
        data: {
          businessId: twinSeller.id,
          categoryId: flagship.categoryId,
          name: flagship.name,
          slug: twinSlug,
          sku: "IND-GV-150",
          availability: "in_stock",
          stockQty: 40,
          stockUpdatedAt: days(-4),
          leadTimeDays: 2,
          minOrderQty: 1,
          status: "live",
          specValues: flagship.specValues as never,
          description:
            "Same range, stocked in Sharjah. Counter flanges and bolts available as a set.",
        },
      });
      console.log(`   a spec twin at ${twinSeller.slug}, for the comparison table`);
    }
  }
}

/**
 * The tracking states board 1i needs and no seed produced.
 *
 * `ENQ-8871` is the five-recipient, two-quote state the render depicts, and
 * `ENQ-8879` turned out to be the *accepted* state — its one quote was taken.
 * Neither is the single-quote-still-open state, which is its own thing: the
 * header reframes to "One supplier has quoted", Compare stays blocked because
 * one quote is not a comparison, and that quote still carries a primary action
 * because it is perfectly actionable on its own.
 *
 * Appended for the reason the blocks above it are: the PRNG is a sequence, and
 * a draw inserted earlier renames every business generated after it.
 */
async function seedTrackingStates(db: Db) {
  console.log("→ a single-quote enquiry, for board 1i");

  const existing = await db.enquiry.findFirst({ where: { ref: "ENQ-8890" }, select: { id: true } });
  if (existing) return;

  const buyer = await db.user.findFirst({
    where: { isProvisional: true, claimToken: "seed-0000-4000-8000-provisional01" },
    select: { id: true },
  });
  const businesses = await db.business.findMany({
    where: { publishedAt: { not: null }, suspendedAt: null, claimStatus: "claimed" },
    orderBy: { slug: "asc" },
    select: { id: true },
    take: 3,
  });
  if (!buyer || businesses.length < 3) {
    console.log("   skipped — no provisional buyer or too few claimed suppliers");
    return;
  }

  const enquiry = await db.enquiry.create({
    data: {
      ref: "ENQ-8890",
      buyerId: buyer.id,
      requirement:
        "Chilled water riser replacement at a hotel in Dubai Marina. UL/FM listed valves, Civil Defence acceptable.",
      deliverToArea: "Dubai Marina",
      closesAt: days(4),
      lines: {
        create: [
          { description: "Grooved butterfly valve DN100, PN16", qty: 18, unit: "pcs", sortOrder: 0 },
          { description: "Grooved gasket, EPDM, 4 inch", qty: 40, unit: "pcs", sortOrder: 1 },
        ],
      },
      recipients: {
        create: [
          /*
             One who quoted, two who have not — the state under test.

             `createdAt` is set explicitly because it is the delivery moment,
             and the latency the page prints is `quotedAt − deliveredAt`. Left
             to default it would be seed time, which is *after* the quote below
             and produces a negative duration.
          */
          { businessId: businesses[0]!.id, state: "quoted", createdAt: days(-3), openedAt: days(-2) },
          { businessId: businesses[1]!.id, state: "opened", createdAt: days(-3), openedAt: days(-1) },
          { businessId: businesses[2]!.id, state: "delivered", createdAt: days(-3) },
        ],
      },
    },
    select: { id: true },
  });

  /*
     A partial quote: two lines asked, one priced. Board 1i insists the row says
     which count, because a buyer needs to know a line went unpriced *before*
     they compare rather than during.
  */
  await db.quote.create({
    data: {
      ref: "QTE-8890-1",
      enquiryId: enquiry.id,
      businessId: businesses[0]!.id,
      status: "sent",
      sentAt: days(-2),
      validityDays: 7,
      expiresAt: days(5),
      lines: {
        create: [
          { description: "Grooved butterfly valve DN100, PN16", qty: 18, unitPrice: 182, sortOrder: 0 },
        ],
      },
    },
  });
}
