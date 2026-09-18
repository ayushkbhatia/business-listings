import { AddressesCard, type AddressItem } from "@/app/(public)/account/company/_addresses";
import { DetailsReadOnly } from "@/app/(public)/account/company/_details";
import { RequestItem } from "@/app/(public)/account/company/_requests";
import { RuleCard } from "@/app/(public)/account/company/_rule";
import { TeamCard, type TeamRow } from "@/app/(public)/account/company/_team";
import { ApprovalNotice } from "@/app/(public)/enquiry/_approval-notice";
import type { RequestCard } from "@/lib/buyer-company/queue";
import { requestView } from "@/lib/buyer-company/request-words";
import { ruleSentences, type RuleFacts } from "@/lib/buyer-company/words";
import { Section, States } from "../_kit";

/**
 * Board `7b` — the buying company's account, in the states its spec documents.
 *
 * Rendered from plain values, as Marina Facilities is drawn: Rami the admin
 * and named approver, Priya in procurement at AED 25,000 a month with 12,400
 * used, Joseph a requester, Deepa invited. The request is the board's row,
 * explained by the counter rather than left unexplained.
 *
 * Nothing here is editable. The cards' write paths are server actions against
 * the viewer's own company, and the gallery viewer has none — so every card is
 * shown in its member (read-only) form except the request, whose approver
 * buttons are the state being documented and are refused if pressed.
 *
 * Each card that owns a titled Panel appears once: a titled Panel is a
 * landmark, and two with one name fail `landmark-unique`. Their empty states
 * are covered by the page itself and by `tests/e2e/buyer-company.spec.ts`.
 */

const BOARD_RULE: RuleFacts = {
  thresholdAed: 25_000,
  approverName: "Rami Haddad",
  unverifiedNeedsApproval: false,
  requirePoNumber: true,
  requireCostCode: false,
  hasProcurement: true,
  hasRequesters: true,
  approverHasNoCover: true,
};

const FLAGS = {
  requirePoNumber: true,
  requireCostCode: false,
  unverifiedNeedsApproval: false,
  tellAdminsOffPlatform: true,
};

const ADDRESSES: AddressItem[] = [
  {
    id: "a1",
    label: "Marina Plaza, Tower 2, Level 14",
    addressLine: "Marina Plaza Tower 2, Level 14, Al Marsa Street, Dubai Marina",
    emirate: "dubai",
    areaId: null,
    areaName: null,
    attnName: "Rami Haddad",
    attnPhone: "+971502201188",
    accessPoint: "Loading bay",
    accessFrom: 420,
    accessUntil: 1020,
    loadLimit: null,
    isDefault: true,
  },
  {
    id: "a2",
    label: "Site store — JLT Cluster D",
    addressLine: "Cluster D basement, Jumeirah Lake Towers",
    emirate: "dubai",
    areaId: "dmcc",
    areaName: "DMCC",
    attnName: "Joseph D'Souza",
    attnPhone: "+971502201190",
    accessPoint: null,
    accessFrom: null,
    accessUntil: 660,
    loadLimit: null,
    isDefault: false,
  },
  {
    id: "a3",
    label: "Head office — Business Bay",
    addressLine: "Bay Square Building 5, Office 702, Business Bay",
    emirate: "dubai",
    areaId: null,
    areaName: null,
    attnName: "Reception",
    attnPhone: null,
    accessPoint: null,
    accessFrom: null,
    accessUntil: null,
    loadLimit: "small_parcels",
    isDefault: false,
  },
];

const TEAM: TeamRow[] = [
  { kind: "member", memberId: "m1", name: "Rami Haddad", email: "rami.haddad@marinafacilities.example", isYou: false, role: "company_admin", monthlyLimitAed: null, usedAed: "0.00", isApprover: true },
  { kind: "member", memberId: "m2", name: "Priya Menon", email: "priya.menon@marinafacilities.example", isYou: false, role: "procurement", monthlyLimitAed: 25_000, usedAed: "12400.00", isApprover: false },
  { kind: "member", memberId: "m3", name: "Joseph D'Souza", email: "joseph.dsouza@marinafacilities.example", isYou: false, role: "requester", monthlyLimitAed: null, usedAed: "0.00", isApprover: false },
  { kind: "invite", inviteId: "i1", name: "Deepa Nair", email: "d.nair@marinafacilities.example", role: "procurement", monthlyLimitAed: 10_000, state: "invited", expiresAt: new Date("2026-09-24T08:00:00Z") },
  { kind: "invite", inviteId: "i2", name: "Omar Saeed", email: "o.saeed@marinafacilities.example", role: "requester", monthlyLimitAed: null, state: "expired", expiresAt: new Date("2026-09-10T08:00:00Z") },
];

const BOARD_ROW: RequestCard = {
  id: "gallery-approval",
  state: { kind: "pending" },
  enquiryId: "gallery-enq-8898",
  enquiryRef: "ENQ-8898",
  quoteRef: "QT-8898-R1",
  quoteId: "gallery-quote",
  revision: 1,
  supplierName: "Al Waha Industrial Trading",
  lineCount: 3,
  valueAed: "15624.00",
  proposal: null,
  reasons: ["over_limit"],
  raisedById: "priya",
  raiserName: "Priya Menon",
  raisedAt: new Date("2026-09-18T19:28:00Z"),
  poNumber: "PO-2026-0418",
  costCode: null,
  note: "Al Waha can deliver to the loading bay on Sunday. The riser shutdown is booked for Monday.",
  decisionNote: null,
  decidedByName: null,
  decidedAt: null,
  answer: null,
  approverNames: ["Rami Haddad"],
  viewerMayApprove: true,
  viewerIsRaiser: false,
};

const CONTEXT = {
  thresholdAed: 25_000,
  raiserLimit: { usedAed: "12400.00", limitAed: 25_000 },
  viewerIsAdmin: true,
};

export function CompanyAccountGallery() {
  return (
    <Section id="company-account" title="company-account" note="board 7b · the buying company, its team and its rule">
      <States label="details · member" stack>
        <div className="w-full max-w-2xl">
          <DetailsReadOnly
            value={{
              name: "Marina Facilities LLC",
              trn: "100448216900003",
              licenceNumber: "DED-772104",
              accountsEmail: "accounts@marinafacilities.example",
            }}
          />
        </div>
      </States>

      <States label="details · nothing filled" stack>
        <div className="w-full max-w-2xl">
          <DetailsReadOnly value={{ name: "Marina Facilities LLC", trn: null, licenceNumber: null, accountsEmail: null }} />
        </div>
      </States>

      <States label="addresses · as drawn" stack>
        <div className="w-full max-w-3xl">
          <AddressesCard addresses={ADDRESSES} areas={[]} editable={false} />
        </div>
      </States>

      <States label="team · invited and expired" stack>
        <div className="w-full max-w-3xl">
          <TeamCard rows={TEAM} editable={false} spend={{ totalAed: "12400.00", withoutTotal: 0, accepted: 1 }} />
        </div>
      </States>

      <States label="rule · as drawn, with its gap" stack>
        <div className="w-full max-w-sm">
          <RuleCard
            sentences={ruleSentences(BOARD_RULE)}
            flags={FLAGS}
            editable={false}
            thresholdAed={25_000}
            approverId="rami"
            admins={[{ userId: "rami", name: "Rami Haddad" }]}
          />
        </div>
      </States>

      {/*
         The card owns a titled Panel, which is a landmark, so it is shown once
         (`tests/e2e/landmarks.spec.ts`). The other configuration is its
         sentences, which is the half `B2` is about.
      */}
      <States label="rule sentences · no threshold" stack>
        <ul className="max-w-sm space-y-1 rounded-card bg-paper-sunk px-4 py-3 text-caption text-body">
          {(() => {
            const sentences = ruleSentences({
              ...BOARD_RULE,
              thresholdAed: null,
              approverName: null,
              requirePoNumber: false,
              requireCostCode: true,
              unverifiedNeedsApproval: true,
              hasProcurement: false,
              hasRequesters: false,
              approverHasNoCover: false,
            });
            return [sentences.lead, ...sentences.rest].map((sentence) => <li key={sentence}>{sentence}</li>);
          })()}
        </ul>
      </States>

      <States label="request · waiting on you" stack>
        <div className="w-full max-w-sm rounded-card border border-line bg-card p-4">
          <RequestItem view={requestView(BOARD_ROW, CONTEXT)} compact />
        </div>
      </States>

      <States label="request · queried, the raiser's view" stack>
        <div className="w-full max-w-sm rounded-card border border-line bg-card p-4">
          <RequestItem
            view={{
              ...requestView(
                {
                  ...BOARD_ROW,
                  state: { kind: "queried" },
                  decisionNote: "Is delivery to the loading bay included, or charged separately?",
                  decidedByName: "Rami Haddad",
                  decidedAt: new Date("2026-09-18T20:10:00Z"),
                  viewerMayApprove: false,
                  viewerIsRaiser: true,
                },
                CONTEXT,
              ),
              canAnswer: false,
              canWithdraw: false,
            }}
          />
        </div>
      </States>

      <States label="request · no longer acceptable" stack>
        <div className="w-full max-w-sm rounded-card border border-line bg-card p-4">
          <RequestItem
            view={requestView(
              { ...BOARD_ROW, state: { kind: "lapsed", reason: "revised" }, viewerMayApprove: false },
              CONTEXT,
            )}
          />
        </div>
      </States>

      <States label="notice · on the comparison" stack>
        <div className="w-full max-w-3xl">
          <ApprovalNotice card={BOARD_ROW} />
        </div>
      </States>
    </Section>
  );
}
