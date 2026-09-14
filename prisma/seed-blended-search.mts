import type { PrismaClient } from "../lib/db/generated/client.js";
import type { Authority, DeliveredWhere, Emirate, EngagementType, TeamSizeBand } from "../lib/db/generated/enums.js";
import { buildBusinessSearchText, buildProductSearchText } from "../lib/search/index-text.js";

/**
 * Board `1c-s` — a VAT search with something true to blend.
 *
 * Until this, a services query on a fresh database found Meridian, filed under
 * *Valves & fittings*, and a handful of Hard FM firms — one firm per trade, so
 * every tab count was a 1 and no facet had a second option to count against.
 * These are new businesses under *VAT & tax advisory*, and each one exists to
 * make one rule of the board visible:
 *
 *  - **Ardent Audit & Advisory** — Deira, six live services, FTA agent number
 *    checked against the register. The business row whose reason line names
 *    two services and *+ 4 more*.
 *  - **Gulf Tax Partners** — DMCC, two live services, checked FTA number. One
 *    service does not say *return* and is not a result for *vat return filing*.
 *  - **Saqr Tax Consultants** — Sharjah office covering Sharjah and Dubai, with
 *    its VAT service **narrowed to Sharjah**: the firm is in a Dubai search and
 *    its service is not, which is coverage resolving per service. No checked
 *    credential — its ACCA membership is a claim, and a claim is not in the rail.
 *  - **Northstar Accounting** — Abu Dhabi only. In the unscoped search and gone
 *    from the Dubai one.
 *  - **Emirates Software Trading** — a goods seller whose accounting-software
 *    licence is the product that stays in the blend.
 *
 * Idempotent by slug, PRNG-free, and verified long enough ago to stay out of
 * *verified this week*.
 */

type Db = PrismaClient;

const DAY = 86_400_000;

interface ServiceSeed {
  name: string;
  slug: string;
  engagementType: EngagementType;
  feeBasis: string;
  turnaround: string;
  deliveredWhere: DeliveredWhere;
  deliverable: string;
  scope: string;
  sectors?: string;
  regulator?: string;
  /** A service narrowed to these emirates rather than inheriting the default. */
  narrowedTo?: Emirate[];
}

interface FirmSeed {
  slug: string;
  displayName: string;
  licence: string;
  authority: Authority;
  area: string;
  emirate: Emirate;
  tier: 1 | 2;
  teamSize: TeamSizeBand;
  description: string;
  covers: Emirate[];
  checkedFta: string | null;
  claimedBody?: string;
  services: ServiceSeed[];
}

const FIRMS: FirmSeed[] = [
  {
    slug: "ardent-audit-and-advisory",
    displayName: "Ardent Audit & Advisory",
    licence: "DED-771204",
    authority: "DED",
    area: "deira",
    emirate: "dubai",
    tier: 2,
    teamSize: "b11_50",
    description: "Audit, VAT and corporate tax for trading companies and free zone entities.",
    covers: ["dubai", "sharjah"],
    checkedFta: "100177120400003",
    services: [
      {
        name: "VAT return filing",
        slug: "vat-return-filing",
        engagementType: "ongoing_contract",
        feeBasis: "per_return",
        turnaround: "5 working days",
        deliveredWhere: "remote",
        deliverable: "Filed return and the FTA submission receipt",
        scope:
          "Quarterly VAT computation and filing on the FTA portal, with reverse-charge and designated-zone treatment checked before submission.",
        sectors: "Trading, free zone entities",
        regulator: "Federal Tax Authority",
      },
      {
        name: "Statutory audit",
        slug: "statutory-audit",
        engagementType: "ongoing_contract",
        feeBasis: "fixed_fee",
        turnaround: "3–4 weeks from complete records",
        deliveredWhere: "at_our_office",
        deliverable: "Signed audit report and management letter",
        scope: "Planning, substantive testing, the signed report and a management letter on control weaknesses.",
        sectors: "Contracting, trading",
      },
      {
        name: "Corporate tax registration",
        slug: "corporate-tax-registration",
        engagementType: "one_off_job",
        feeBasis: "fixed_fee",
        turnaround: "2 weeks",
        deliveredWhere: "remote",
        deliverable: "Corporate tax registration number",
        scope: "Registration on EmaraTax, including the group and exempt-person questions the portal asks.",
      },
      {
        name: "Transfer pricing documentation",
        slug: "transfer-pricing-documentation",
        engagementType: "one_off_job",
        feeBasis: "per_hour",
        turnaround: "6 weeks",
        deliveredWhere: "remote",
        deliverable: "Local file and disclosure form",
        scope: "Benchmarking, the local file and the related-party disclosure form.",
      },
      {
        name: "Bookkeeping",
        slug: "bookkeeping",
        engagementType: "ongoing_contract",
        feeBasis: "retainer",
        turnaround: "Monthly close by the 10th",
        deliveredWhere: "remote",
        deliverable: "Monthly management accounts",
        scope: "Ledger posting, bank reconciliation and monthly management accounts.",
      },
      {
        name: "Payroll and WPS processing",
        slug: "payroll-and-wps",
        engagementType: "ongoing_contract",
        feeBasis: "retainer",
        turnaround: "Monthly, before the WPS deadline",
        deliveredWhere: "remote",
        deliverable: "SIF file and payslips",
        scope: "Monthly payroll, the WPS salary information file and payslips.",
      },
    ],
  },
  {
    slug: "gulf-tax-partners",
    displayName: "Gulf Tax Partners",
    licence: "DMCC-448210",
    authority: "DMCC",
    area: "dmcc",
    emirate: "dubai",
    tier: 2,
    teamSize: "b1_10",
    description: "VAT and corporate tax advisory for real estate and holding companies.",
    covers: ["dubai"],
    checkedFta: "100244821000003",
    services: [
      {
        name: "VAT registration & deregistration",
        slug: "vat-registration-and-deregistration",
        engagementType: "one_off_job",
        feeBasis: "fixed_fee",
        turnaround: "2 weeks",
        deliveredWhere: "remote",
        deliverable: "TRN certificate or deregistration approval",
        scope:
          "FTA registration, group registration and deregistration, including the penalty waiver application where one applies.",
      },
      {
        name: "VAT return filing",
        slug: "vat-return-filing",
        engagementType: "ongoing_contract",
        feeBasis: "retainer",
        turnaround: "Filed within 10 working days of records",
        deliveredWhere: "at_our_office",
        deliverable: "Filed return and reconciliation workings",
        scope: "Return preparation from your ledger, filing, and the queries that follow.",
        sectors: "Real estate",
      },
    ],
  },
  {
    slug: "saqr-tax-consultants",
    displayName: "Saqr Tax Consultants",
    licence: "SHJ-339017",
    authority: "SHJ",
    area: "sharjah-media-city",
    emirate: "sharjah",
    tier: 2,
    teamSize: "b1_10",
    description: "Tax filing for contractors in the northern emirates.",
    covers: ["sharjah", "dubai"],
    checkedFta: null,
    claimedBody: "ACCA",
    services: [
      {
        name: "VAT return filing",
        slug: "vat-return-filing",
        engagementType: "ongoing_contract",
        feeBasis: "per_return",
        turnaround: "7 working days",
        deliveredWhere: "on_site",
        deliverable: "Filed return",
        scope: "Return preparation at your office from your records, and filing on the FTA portal.",
        sectors: "Contracting",
        narrowedTo: ["sharjah"],
      },
    ],
  },
  {
    slug: "northstar-accounting",
    displayName: "Northstar Accounting",
    licence: "ADGM-000912",
    authority: "ADGM",
    area: "adgm",
    emirate: "abu_dhabi",
    tier: 1,
    teamSize: "b1_10",
    description: "Accounting and VAT for ADGM entities.",
    covers: ["abu_dhabi"],
    checkedFta: null,
    services: [
      {
        name: "VAT return filing",
        slug: "vat-return-filing",
        engagementType: "ongoing_contract",
        feeBasis: "per_hour",
        turnaround: "10 working days",
        deliveredWhere: "remote",
        deliverable: "Filed return",
        scope: "Return preparation and filing for ADGM-registered entities.",
      },
    ],
  },
];

export async function seedBlendedSearch(db: Db, now: Date): Promise<void> {
  console.log("→ a VAT search that blends services, firms and a product, for board 1c-s");

  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const ahead = (days: number) => new Date(now.getTime() + days * DAY);

  const [trade, family, areas, goodsTrade] = await Promise.all([
    db.category.findUnique({ where: { slug: "vat-and-tax" }, select: { id: true, name: true, synonyms: true } }),
    db.scopeSheetFamily.findUnique({ where: { id: "professional-services" }, select: { id: true } }),
    db.area.findMany({
      where: { slug: { in: [...FIRMS.map((firm) => firm.area), "deira"] } },
      select: { id: true, slug: true },
    }),
    db.category.findUnique({ where: { slug: "pos-and-retail-tech" }, select: { id: true, name: true } }),
  ]);
  if (!trade || !family || !goodsTrade) {
    console.log("   skipped: the VAT trade, the professional-services family or the POS trade is missing");
    return;
  }
  const areaId = new Map(areas.map((area) => [area.slug, area.id]));

  for (const seed of FIRMS) {
    const existing = await db.business.findUnique({ where: { slug: seed.slug }, select: { id: true } });
    if (existing) await db.business.delete({ where: { id: existing.id } });
    const area = areaId.get(seed.area);
    if (!area) continue;

    const firm = await db.business.create({
      data: {
        slug: seed.slug,
        displayName: seed.displayName,
        tradeName: `${seed.displayName} LLC`,
        licenceNumber: seed.licence,
        licenceAuthority: seed.authority,
        licenceExpiry: ahead(280),
        primaryCategoryId: trade.id,
        claimStatus: "claimed",
        publishedAt: ago(150),
        verificationTier: seed.tier,
        verifiedAt: ago(140),
        planId: "basic",
        sellsKind: "services",
        scopeSheetFamilyId: family.id,
        deliveryModes: ["remote", "at_our_office"],
        description: seed.description,
        teamSize: seed.teamSize,
        establishedYear: 2012,
        searchText: buildBusinessSearchText({
          displayName: seed.displayName,
          tradeName: `${seed.displayName} LLC`,
          description: seed.description,
          categoryNames: [trade.name],
          synonyms: trade.synonyms,
        }),
        locations: {
          create: {
            type: "head_office",
            emirate: seed.emirate,
            areaId: area,
            addressLine: `${seed.displayName}, ${seed.area.replace(/-/g, " ")}`,
            published: true,
            publishedAt: ago(150),
          },
        },
      },
      select: { id: true },
    });

    await db.serviceCoverage.createMany({
      data: seed.covers.map((emirate) => ({ businessId: firm.id, emirate, areaId: null })),
    });

    for (const [position, service] of seed.services.entries()) {
      const created = await db.service.create({
        data: {
          businessId: firm.id,
          categoryId: trade.id,
          name: service.name,
          slug: service.slug,
          position,
          status: "live",
          publishedAt: ago(120 - position),
          engagementType: service.engagementType,
          feeBasis: service.feeBasis,
          turnaround: service.turnaround,
          deliveredWhere: service.deliveredWhere,
          deliverable: service.deliverable,
          scope: service.scope,
          values: {
            create: [
              ...(service.sectors ? [{ fieldKey: "sectors", value: service.sectors }] : []),
              ...(service.regulator ? [{ fieldKey: "regulator", value: service.regulator }] : []),
            ],
          },
        },
        select: { id: true },
      });
      if (service.narrowedTo) {
        await db.serviceCoverage.createMany({
          data: service.narrowedTo.map((emirate) => ({
            businessId: firm.id,
            serviceId: created.id,
            emirate,
            areaId: null,
          })),
        });
      }
    }

    if (seed.checkedFta) {
      await db.credential.create({
        data: {
          businessId: firm.id,
          kind: "fta_tax_agent",
          identifier: seed.checkedFta,
          issuer: "Federal Tax Authority",
          trust: "register_verified",
          verifiedOn: ago(130),
          verifiedBy: "FTA tax agent register",
          review: "auto_verified",
          reviewOpenedAt: ago(130),
        },
      });
    }
    if (seed.claimedBody) {
      await db.credential.create({
        data: { businessId: firm.id, kind: "professional_body", issuer: seed.claimedBody },
      });
    }
  }

  /* The goods seller, and the product that stays in the blend. */
  const shopSlug = "emirates-software-trading";
  const shop = await db.business.findUnique({ where: { slug: shopSlug }, select: { id: true } });
  if (shop) await db.business.delete({ where: { id: shop.id } });
  const deira = areaId.get("deira");
  if (!deira) return;

  const product = {
    name: "Zoho Books VAT return filing licence, 1 year",
    description:
      "One-year licence for the FTA-compliant edition, with the VAT return report and audit file included.",
  };
  const shopDescription = "Accounting and point-of-sale software licences for small businesses.";
  await db.business.create({
    data: {
      slug: shopSlug,
      displayName: "Emirates Software Trading",
      tradeName: "Emirates Software Trading LLC",
      licenceNumber: "DED-602288",
      licenceAuthority: "DED",
      licenceExpiry: ahead(300),
      primaryCategoryId: goodsTrade.id,
      claimStatus: "claimed",
      publishedAt: ago(200),
      verificationTier: 2,
      verifiedAt: ago(190),
      planId: "basic",
      sellsKind: "goods",
      description: shopDescription,
      searchText: buildBusinessSearchText({
        displayName: "Emirates Software Trading",
        tradeName: "Emirates Software Trading LLC",
        description: shopDescription,
        categoryNames: [goodsTrade.name],
        products: [{ ...product, categoryName: goodsTrade.name }],
      }),
      locations: {
        create: {
          type: "head_office",
          emirate: "dubai",
          areaId: deira,
          addressLine: "Emirates Software Trading, Deira",
          published: true,
          publishedAt: ago(200),
        },
      },
      products: {
        create: {
          name: product.name,
          slug: "zoho-books-vat-return-filing-licence-1-year",
          sku: "ZB-VAT-1Y",
          categoryId: goodsTrade.id,
          availability: "in_stock",
          description: product.description,
          status: "live",
          searchText: buildProductSearchText({ ...product, sku: "ZB-VAT-1Y", categoryName: goodsTrade.name }),
        },
      },
    },
  });
}
