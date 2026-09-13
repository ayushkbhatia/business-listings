import { Section, Specimen, States } from "../_kit";
import { CredentialTable, type CredentialView } from "@/components/domain/CredentialTable";
import {
  CoverageSummary,
  DeclaredSectors,
  ServiceSummaryCard,
} from "@/components/domain/ServicesStorefront";
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
