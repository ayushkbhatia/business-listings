import { CoverageFirmList, CoverageFirmRow } from "@/components/domain/BlendedResultRows";
import type { CoverageFirmView } from "@/lib/search/blended-views";
import {
  FanOutCard,
  RailChipsCard,
  RailLinksCard,
  ServicesStatLine,
  WhatToAsk,
} from "@/app/(public)/_landing/ServicesLanding";
import { ServicesLandingPanel } from "@/app/(admin)/admin/categories/ServicesLandingPanel";
import { Section, States } from "../_kit";

/**
 * Board `6a-s` — the services landing page's parts, in every state the page
 * can put them in.
 *
 * The rows are `CoverageFirmRow` from fixed values: a checked FTA agent with an
 * office elsewhere (the board's premise), the practice with no badge, one
 * reached only by an office in the district, an unclaimed licence import with
 * no enquiry button, and a lapsed licence shown at the rung the sweep will
 * write. The rail cards are the page's own, including the fan-out's two
 * states and the empty card that does not render. No `h1` and no landmark
 * the gallery would duplicate — the panel is drawn without its region.
 */

const BASE: Omit<CoverageFirmView, "id" | "businessSlug" | "businessName"> = {
  place: null,
  rating: null,
  replyMs: 2 * 3_600_000 + 10 * 60_000,
  verificationTier: 2,
  verifiedAt: "2026-04-02T08:00:00.000Z",
  checkedCredentials: [],
  categoryCode: "VT",
  summary: null,
  chips: [],
  services: [],
  moreServices: 0,
  office: null,
  covers: true,
  coverageHref: "/b/example/coverage",
  claimed: true,
  sellsWork: true,
  enquireHref: "/rfq/new?to=example&category=vat-and-tax&area=business-bay",
};

const AGENT: CoverageFirmView = {
  ...BASE,
  id: "gallery-6as-agent",
  businessSlug: "lighthouse-tax-consultancy",
  businessName: "Lighthouse Tax Consultancy",
  checkedCredentials: [{ kind: "fta_tax_agent", identifier: "20034512" }],
  summary:
    "Tax and assurance for SMEs and free-zone companies. Registered tax agents; we correspond with the FTA on your behalf.",
  chips: ["Per return", "Remote", "Retail · Logistics · Construction"],
  services: [
    { name: "VAT registration and quarterly compliance", href: "/b/lighthouse-tax-consultancy/s/vat" },
  ],
  office: "Deira, Dubai",
};

const NO_BADGE: CoverageFirmView = {
  ...BASE,
  id: "gallery-6as-no-badge",
  businessSlug: "sterling-fiscal-advisors",
  businessName: "Sterling Fiscal Advisors",
  replyMs: 9 * 3_600_000 + 20 * 60_000,
  summary:
    "VAT registration and quarterly filing for small trading companies. Not a registered agent — they prepare, you submit.",
  chips: ["Fixed fee", "Remote"],
  services: [
    { name: "VAT registration for small traders", href: "/b/sterling-fiscal-advisors/s/vat" },
    { name: "VAT deregistration", href: "/b/sterling-fiscal-advisors/s/dereg" },
  ],
  moreServices: 2,
};

const OFFICE_ONLY: CoverageFirmView = {
  ...BASE,
  id: "gallery-6as-office",
  businessSlug: "canal-tax-partners",
  businessName: "Canal Tax Partners",
  replyMs: null,
  summary: "Audit, VAT and corporate tax. MoF-approved auditors, DMCC and JAFZA listed.",
  chips: ["Retainer", "At their office", "DMCC · Jebel Ali Free Zone"],
  office: "Business Bay, Dubai",
  covers: false,
};

const UNCLAIMED: CoverageFirmView = {
  ...BASE,
  id: "gallery-6as-unclaimed",
  businessSlug: "quayside-tax-services",
  businessName: "Quayside Tax Services",
  replyMs: null,
  verificationTier: 0,
  verifiedAt: null,
  office: "Business Bay, Dubai",
  covers: false,
  claimed: false,
  sellsWork: false,
  enquireHref: null,
};

const LAPSED: CoverageFirmView = {
  ...BASE,
  id: "gallery-6as-lapsed",
  businessSlug: "bayside-vat-desk",
  businessName: "Bayside VAT Desk",
  verificationTier: 1,
  summary: "Registrations and deregistrations, turned round inside a week.",
  chips: ["Fixed fee", "Remote"],
  office: "Business Bay, Dubai",
};

const ASKS = [
  {
    position: 0,
    question: "Are you a registered FTA tax agent?",
    why: "Only an agent can deal with the authority in your name. Everyone else prepares the return and you file it, which matters when a query or a penalty notice arrives.",
  },
  {
    position: 1,
    question: "Is the fee per return or a retainer?",
    why: "Per return suits a company with steady quarters. A retainer usually includes the queries between them, which is where the time actually goes.",
  },
  {
    position: 2,
    question: "Who handles an FTA audit if one comes?",
    why: "Frequently excluded from the fee and quoted separately. Worth reading the exclusions line before you sign, not after.",
  },
];

export function ServicesLandingGallery() {
  return (
    <Section id="services-landing" title="services landing — 6a-s" note="the page for a trade sold by the job">
      <States label="stat line" stack>
        <ServicesStatLine
          firms={37}
          place="Business Bay"
          verified={29}
          credential={{ kind: "fta_tax_agent", holders: 24 }}
          replyMedianMs={3 * 3_600_000 + 20 * 60_000}
          updatedAt={new Date("2026-09-12T00:00:00.000Z")}
        />
        {/* A trade with no checkable credential, and too few measured firms for a median. */}
        <ServicesStatLine
          firms={62}
          place="Business Bay"
          verified={31}
          credential={null}
          replyMedianMs={null}
          updatedAt={null}
        />
      </States>

      <States label="rows" stack>
        <div className="w-full">
          <CoverageFirmList rows={[AGENT, NO_BADGE]} placeName="Business Bay" offset={0} />
        </div>
      </States>
      <States label="office only" stack>
        <div className="w-full">
          <CoverageFirmRow row={OFFICE_ONLY} placeName="Business Bay" rank={3} />
        </div>
      </States>
      <States label="unclaimed" stack>
        <div className="w-full">
          <CoverageFirmRow row={UNCLAIMED} placeName="Business Bay" rank={4} />
        </div>
      </States>
      <States label="lapsed licence" stack>
        <div className="w-full">
          <CoverageFirmRow row={LAPSED} placeName="Business Bay" rank={5} />
        </div>
      </States>

      <States label="fan-out">
        <div className="w-80">
          <FanOutCard
            id="gallery-fanout-match"
            facts={{
              state: "match",
              count: 8,
              cap: 8,
              place: "Business Bay",
              href: "/rfq/new?category=vat-and-tax&kind=services&area=business-bay",
              measuredMs: 2 * 3_600_000,
            }}
          />
        </div>
        <div className="w-80">
          <FanOutCard
            id="gallery-fanout-few"
            facts={{
              state: "match",
              count: 3,
              cap: 8,
              place: "Business Bay",
              href: "/rfq/new?category=vat-and-tax&kind=services&area=business-bay",
              measuredMs: null,
            }}
          />
        </div>
        <div className="w-80">
          <FanOutCard
            id="gallery-fanout-widen"
            facts={{
              state: "widen",
              count: 5,
              place: "Business Bay",
              emirate: "Dubai",
              href: "/rfq/new?category=vat-and-tax&kind=services&emirate=dubai",
            }}
          />
        </div>
      </States>

      <States label="rail links">
        <div className="w-80">
          <RailChipsCard
            id="gallery-nearby"
            heading="Nearby"
            links={[
              { href: "/dubai/downtown-dubai/vat-and-tax", label: "Downtown Dubai", count: 41 },
              { href: "/dubai/difc/vat-and-tax", label: "DIFC", count: 58 },
            ]}
          />
        </div>
        <div className="w-80">
          <RailLinksCard
            id="gallery-related"
            heading="Related work"
            links={[
              { href: "/dubai/business-bay/audit-and-assurance", label: "Auditors in Business Bay", count: 62 },
              { href: "/dubai/business-bay/company-formation", label: "Company formation firms in Business Bay", count: 61 },
            ]}
          />
        </div>
        {/* No live page on the axis: the card does not render, eyebrow and all. */}
        <RailChipsCard id="gallery-nearby-empty" heading="Nearby" links={[]} />
      </States>

      <States label="what to ask" stack>
        <div className="w-full">
          <WhatToAsk heading="What to ask VAT consultants in Business Bay" asks={ASKS} />
        </div>
      </States>

      <States label="trade panel" stack>
        <div className="w-full">
          <ServicesLandingPanel
            landmark={false}
            canWrite
            view={{
              categoryId: "gallery-vat",
              name: "VAT & tax advisory",
              pluralHuman: "VAT consultants",
              credentialKind: "fta_tax_agent",
              inherited: null,
              asks: ASKS.map(({ question, why }) => ({ question, why })),
              openedAt: "2026-09-04T08:00:00.000Z",
              publishedPages: 3,
            }}
          />
        </div>
      </States>
      <States label="read only, closed" stack>
        <div className="w-full">
          <ServicesLandingPanel
            landmark={false}
            canWrite={false}
            view={{
              categoryId: "gallery-audit",
              name: "Audit & assurance",
              pluralHuman: null,
              credentialKind: null,
              inherited: { kind: "professional_body", source: "Inspection & certification" },
              asks: [],
              openedAt: null,
              publishedPages: 0,
            }}
          />
        </div>
      </States>
    </Section>
  );
}
