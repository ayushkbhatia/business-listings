import { Section, Specimen, States } from "../_kit";
import { CredentialTable, type CredentialView } from "@/components/domain/CredentialTable";
import {
  CoverageSummary,
  CoverageTable,
  DeclaredSectors,
  ServiceCatalogueCard,
  ServiceSummaryCard,
} from "@/components/domain/ServicesStorefront";
import { buttonClassName } from "@/components/primitives";
import {
  ServiceEnquiryComposer,
  type ServiceEnquiryOption,
} from "@/components/domain/ServiceEnquiryComposer";

/**
 * Board `1d-s` — the storefront of a firm that sells work, in every state its
 * spec documents.
 *
 * Plain objects, no loader, so each state renders exactly as the board names
 * it: typical, a service missing fields, one credential, unverified only,
 * expired, no sectors declared, coverage unanswered, and the composer cold,
 * refused and signed in. A state that exists only in the running app is a
 * state nobody reviews.
 */

const credentials: CredentialView[] = [
  {
    id: "c1",
    kind: "fta_tax_agent",
    identifier: "30014982",
    issuer: null,
    expiresOn: new Date("2027-03-31T00:00:00Z"),
    verified: true,
    verifiedBy: "FTA tax agent register",
  },
  {
    id: "c2",
    kind: "mof_audit_approval",
    identifier: "Register no. 1142",
    issuer: "Ministry of Finance",
    expiresOn: new Date("2026-12-31T00:00:00Z"),
    verified: false,
    verifiedBy: null,
  },
  {
    id: "c3",
    kind: "professional_body",
    identifier: "Two partners",
    issuer: "ACCA",
    expiresOn: new Date("2026-12-31T00:00:00Z"),
    verified: false,
    verifiedBy: null,
  },
  {
    id: "c4",
    kind: "indemnity_insurance",
    identifier: "AED 5m, single claim",
    issuer: "AXA Gulf",
    expiresOn: new Date("2027-07-31T00:00:00Z"),
    verified: false,
    verifiedBy: null,
  },
];

const expired: CredentialView = {
  id: "c5",
  kind: "other",
  identifier: "DMCC-AP-2231",
  issuer: "DMCC approved auditor",
  expiresOn: new Date("2025-06-30T00:00:00Z"),
  verified: false,
  verifiedBy: null,
};

const options: ServiceEnquiryOption[] = [
  {
    slug: "statutory-audit",
    name: "Statutory audit",
    familyId: "professional-services",
    requiresFromClient: "Trial balance, bank confirmations, fixed asset register",
  },
  { slug: "vat-return-filing", name: "VAT return filing", familyId: "professional-services", requiresFromClient: null },
];

const NAME = "Meridian Chartered Accountants";
const SLUG = "meridian-chartered-accountants";

export function ServicesStorefrontGallery() {
  return (
    <>
      <Section id="service-summary-card" title="service-summary-card" note="board 1d-s · rows with deliverables, no fee, no availability chip">
        <States label="typical">
          <div className="grid w-full gap-4 md:grid-cols-2">
            <ServiceSummaryCard
              businessSlug={SLUG}
              service={{
                slug: "statutory-audit",
                name: "Statutory audit",
                chips: ["Annual", "3–4 weeks", "Fixed fee"],
                deliverable: "Signed report and management letter, IFRS or IFRS for SMEs.",
              }}
            />
            <ServiceSummaryCard
              businessSlug={SLUG}
              service={{
                slug: "vat-return-filing",
                name: "VAT return filing",
                chips: ["Quarterly retainer", "5 working days", "Per return"],
                deliverable: "Filed return and the FTA acknowledgement, each quarter.",
              }}
            />
          </div>
        </States>
        <States label="missing fields — absent, not blank (B6)">
          <div className="grid w-full gap-4 md:grid-cols-2">
            <ServiceSummaryCard
              businessSlug={SLUG}
              service={{
                slug: "corporate-tax-registration",
                name: "Corporate tax registration",
                chips: ["One-off", "2 weeks"],
                deliverable: "Registration confirmation and the first-period filing calendar.",
              }}
            />
            <ServiceSummaryCard
              businessSlug={SLUG}
              service={{ slug: "bookkeeping", name: "Monthly bookkeeping", chips: [], deliverable: null }}
            />
          </div>
        </States>
      </Section>

      <Section id="service-catalogue-card" title="service-catalogue-card" note="board 1e-s · four fields, fixed order, fee on enquiry">
        <States label="most enquired, with what you provide" stack>
          <div className="w-full">
            <ServiceCatalogueCard
              businessSlug={SLUG}
              enquiries={17}
              enquire={<span className={buttonClassName({ block: true })}>Enquire</span>}
              service={{
                slug: "statutory-audit",
                name: "Statutory audit",
                summary:
                  "Full statutory audit under IFRS or IFRS for SMEs, for companies filing with a free zone authority. Signed report, audit opinion and a management letter.",
                fields: [
                  { key: "engagement", value: "Ongoing contract" },
                  { key: "turnaround", value: "3–4 weeks from complete records" },
                  { key: "fee_basis", value: "Fixed fee" },
                  { key: "delivered", value: "Remotely" },
                ],
                provides: "Trial balance, bank confirmations, fixed asset register, contract schedule",
              }}
            />
          </div>
        </States>
        <States label="thin — Not stated, no completeness badge (B1, B2)" stack>
          <div className="w-full">
            <ServiceCatalogueCard
              businessSlug={SLUG}
              enquiries={null}
              enquire={<span className={buttonClassName({ block: true })}>Enquire</span>}
              service={{
                slug: "corporate-tax-registration",
                name: "Corporate tax registration",
                summary: null,
                fields: [
                  { key: "engagement", value: "One-off job" },
                  { key: "turnaround", value: null },
                  { key: "fee_basis", value: null },
                  { key: "delivered", value: null },
                ],
                provides: null,
              }}
            />
          </div>
        </States>
      </Section>

      <Section id="coverage-table" title="coverage-table" note="board 1f-s · one row per service, free zones as a qualifier">
        <States label="typical — coverage differs by service" stack>
          <div className="w-full">
            <CoverageTable
              businessSlug={SLUG}
              caption="Coverage — typical"
              rows={[
                { slug: "vat-return-filing", name: "VAT return filing", where: "Dubai, Sharjah and Abu Dhabi", qualifier: null, how: "Remotely" },
                { slug: "bookkeeping", name: "Monthly bookkeeping", where: "Dubai and Sharjah", qualifier: null, how: "Remotely" },
                { slug: "corporate-tax-registration", name: "Corporate tax registration", where: "All seven emirates", qualifier: null, how: null },
                { slug: "statutory-audit", name: "Statutory audit", where: "Dubai", qualifier: "Registered in DMCC and JAFZA", how: "On the client’s site" },
              ]}
            />
          </div>
        </States>
        <States label="one service — the header stays" stack>
          <div className="w-full">
            <CoverageTable
              businessSlug={SLUG}
              caption="Coverage — one service"
              rows={[{ slug: "marine-survey", name: "Condition survey", where: "Al Ain and Dubai", qualifier: null, how: "On the client’s site" }]}
            />
          </div>
        </States>
      </Section>

      <Section id="credential-table" title="credential-table" note="boards 1d-s, 1g-s · one component on both">
        <States label="typical — four shown, more behind the link" stack>
          <div className="w-full">
            <CredentialTable
              rows={credentials}
              name={NAME}
              caption="Credentials — typical"
              footer={<span className="text-body-sm text-muted">2 more credentials · See all credentials</span>}
            />
          </div>
        </States>
        <States label="one credential — no link" stack>
          <div className="w-full">
            <CredentialTable rows={[credentials[3]!]} name={NAME} caption="Credentials — one" />
          </div>
        </States>
        <States label="unverified only — the firm's own claim (B3)" stack>
          <div className="w-full">
            <CredentialTable rows={credentials.slice(1, 3)} name={NAME} caption="Credentials — claims only" />
          </div>
        </States>
        <States label="expired — printed as it is (B4)" stack>
          <div className="w-full">
            <CredentialTable rows={[expired]} name={NAME} caption="Credentials — expired" />
          </div>
        </States>
      </Section>

      <Section id="declared-sectors" title="declared-sectors" note="board 1d-s B8 · declared, never computed">
        <States label="counts declared" stack>
          <DeclaredSectors
            sectors={[
              { label: "Construction & contracting", engagements: 41 },
              { label: "Trading & distribution", engagements: 28 },
              { label: "Free zone entities", engagements: 19 },
              { label: "Real estate", engagements: 7 },
            ]}
          />
        </States>
        <States label="some undeclared" stack>
          <DeclaredSectors
            sectors={[
              { label: "Contracting", engagements: 41 },
              { label: "Free zone entities", engagements: null },
            ]}
          />
        </States>
        <States label="no counts — no disclaimer" stack>
          <DeclaredSectors sectors={[{ label: "Hospitality", engagements: null }]} />
        </States>
      </Section>

      <Section id="coverage-summary" title="coverage-summary" note="board 1d-s B7 · the union, never the default line">
        <States label="typical">
          <Specimen caption="three emirates, two modes">
            <CoverageSummary places={["Dubai", "Sharjah", "Abu Dhabi"]} modes={["remote", "at_our_office"]} className="w-80" />
          </Specimen>
          <Specimen caption="unanswered">
            <CoverageSummary places={[]} modes={[]} className="w-80" />
          </Specimen>
        </States>
      </Section>

      <Section id="service-enquiry-composer" title="service-enquiry-composer" note="board 1d-s · a situation, not a quantity">
        <States label="typical, signed out" stack>
          <div className="w-full max-w-md">
            <ServiceEnquiryComposer
              formLabel="Service enquiry — typical"
              businessName={NAME}
              services={options}
              initialService="statutory-audit"
              askForContact
              responseLine="Typically replies in about 2 h during business hours."
            />
          </div>
        </States>
        <States label="refused by the server" stack>
          <div className="w-full max-w-md">
            <ServiceEnquiryComposer
              formLabel="Service enquiry — refused"
              businessName={NAME}
              services={options}
              initialService="vat-return-filing"
              askForContact={false}
              responseLine="New to the directory — no reply time measured yet."
              error="Some answers need another look. Each one is marked below."
              fieldErrors={{
                requirement: "Say a little more about the job — at least 10 characters, so the firm can quote on it.",
                neededBy: "Pick today or a later date.",
              }}
            />
          </div>
        </States>
        <States label="no service published — cold start" stack>
          <div className="w-full max-w-md">
            <ServiceEnquiryComposer
              formLabel="Service enquiry — cold start"
              businessName="Gulf Harbour Surveyors"
              services={[]}
              initialService={null}
              askForContact={false}
              responseLine="New to the directory — no reply time measured yet."
            />
          </div>
        </States>
        <States label="sending" stack>
          <div className="w-full max-w-md">
            <ServiceEnquiryComposer
              formLabel="Service enquiry — sending"
              businessName={NAME}
              services={options}
              initialService="statutory-audit"
              askForContact={false}
              responseLine="Typically replies in about 2 h during business hours."
              busy
            />
          </div>
        </States>
      </Section>
    </>
  );
}
