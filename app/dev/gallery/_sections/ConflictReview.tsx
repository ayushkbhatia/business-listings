"use client";

import type { ConflictActionResult } from "@/app/(admin)/admin/queue/conflict/actions";
import { ConflictWorkspace, type ConflictActions } from "@/app/(admin)/admin/queue/conflict/ConflictWorkspace";
import { conflictView } from "@/app/(admin)/admin/queue/conflict/view";
import { conflictClock } from "@/lib/claims/clock";
import type { ClaimSide, ConflictReview, LogEntry } from "@/lib/claims/review";
import type { ClaimResolution } from "@/lib/db/generated/enums";
import { assess, scoreClaim, type ClaimFacts, type SourceRecord } from "@/lib/claims/signals";
import { Section, States } from "../_kit";

/**
 * Board `4c` — review a submission, the conflicting-claim body, in the states
 * its spec lists.
 *
 * Every state is computed rather than drawn: hand-written claims are scored by
 * `scoreClaim`, tagged by `assess` and worded by `conflictView` — the same
 * three functions the route calls — so a tag, a colour or a recommendation
 * that the rules would not produce cannot appear here either.
 *
 * Each listing has its own name: the rail is a landmark labelled by it, and
 * the gallery drawing two with one name fails the axe pass.
 */

const NOW = new Date("2026-08-22T18:02:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const inert = async (): Promise<ConflictActionResult> => ({ ok: false, error: "The gallery does not decide conflicts." });
const ACTIONS: ConflictActions = { resolve: inert, escalate: inert, requestDocs: inert, logCall: inert, assign: inert };
const HOLDERS = [
  { id: "ops-1", name: "R. Haddad" },
  { id: "ops-2", name: "S. Nair" },
];

function source(name: string, licence = "ADDED-771204"): SourceRecord {
  return {
    legalName: `${name} LLC`,
    licenceNumber: licence,
    authority: "ADDED",
    address: { areaName: "Mussafah M-14", emirate: "abu_dhabi", addressLine: "Plot 22, Street 9" },
    phones: ["02 553 1190"],
    domain: "coolbreeze.ae",
  };
}

interface ClaimInput {
  id: string;
  name: string;
  role: string;
  at: Date;
  facts: Omit<ClaimFacts, "id">;
  outcome?: ClaimSide["outcome"];
  partyReason?: ClaimSide["partyReason"];
  tenancy?: Date;
}

const A_FACTS = (name: string): Omit<ClaimFacts, "id"> => ({
  route: "licence_upload",
  licenceNumber: "ADDED-771204",
  licenceExpiry: new Date("2027-03-01T00:00:00.000Z"),
  calledNumber: null,
  register: { tradeName: `${name} LLC`, areaName: "Mussafah M-14", emirate: "abu_dhabi", addressLine: "Plot 22, Street 9", phones: ["02 553 1190"] }, // licence-locked: the register's own row
  emailDomain: "coolbreeze.ae",
  call: { to: "public_record", confirmed: true },
});

const B_FACTS: Omit<ClaimFacts, "id"> = {
  route: "licence_upload",
  licenceNumber: "ADDED-802116",
  licenceExpiry: new Date("2026-12-01T00:00:00.000Z"),
  calledNumber: null,
  register: { tradeName: "Cool Breeze Air Cond. Maint.", areaName: "Mussafah M-14", emirate: "abu_dhabi", addressLine: "Plot 22, Unit 4", phones: ["02 554 8830"] }, // licence-locked: the register's own row
  emailDomain: "gmail.com",
  call: { to: "claimant_supplied", confirmed: true },
};

function review(input: {
  name: string;
  claims: ClaimInput[];
  sourceLicence?: string;
  challenge?: boolean;
  openedAt?: Date;
  escalated?: Date;
  docsRequested?: Date;
  resolved?: { kind: ClaimResolution; awardedId: string | null; secondId?: string | null };
  dissolved?: Date;
  waiting?: { enquiries: number; buyers: number };
  log?: LogEntry[];
}): ConflictReview {
  const record = source(input.name, input.sourceLicence);
  const sides: ClaimSide[] = input.claims.map((claim, index) => {
    const facts = { id: claim.id, ...claim.facts };
    return {
      id: claim.id,
      label: "ABCDEFG"[index]!,
      claimantName: claim.name,
      accountName: claim.name,
      role: claim.role,
      route: claim.facts.route,
      phone: null,
      createdAt: claim.at,
      decidedAt: claim.outcome ? NOW : null,
      outcome: claim.outcome ?? null,
      partyReason: claim.partyReason ?? null,
      licenceNumber: claim.facts.licenceNumber,
      licenceExpiry: claim.facts.licenceExpiry,
      document: { filename: `licence-${index + 1}.pdf` },
      tenancyDocument: claim.tenancy ? { filename: "tenancy.pdf", createdAt: claim.tenancy } : null,
      register: claim.facts.register
        ? { ...claim.facts.register, businessId: null, businessSlug: null, businessName: null, stagedId: "staged", licenceExpiry: null, authority: "ADDED" }
        : null,
      scored: scoreClaim(facts, record, NOW),
      opened: index === (input.challenge ? 0 : 1),
      live: !claim.outcome,
      branchOfSource: false,
    };
  });
  const openedAt = input.openedAt ?? new Date(NOW.getTime() - (3 * DAY + 6 * HOUR));
  const state: ConflictReview["state"] = input.resolved
    ? "resolved"
    : input.dissolved
      ? "dissolved"
      : input.escalated
        ? "escalated"
        : input.docsRequested
          ? "docs_requested"
          : "open";
  const log: LogEntry[] = input.log ?? [
    ...sides.map((side): LogEntry => ({ kind: "claim_received", at: side.createdAt, claim: side.label, opened: side.opened })),
    { kind: "call", at: new Date(openedAt.getTime() + 19 * HOUR), actor: "R. Haddad", claim: "A", to: "public_record", confirmed: true },
    { kind: "call", at: new Date(openedAt.getTime() + 20 * HOUR), actor: "R. Haddad", claim: "B", to: "claimant_supplied", confirmed: true },
  ];
  return {
    id: `gallery-${input.name.toLowerCase().replace(/\W+/g, "-")}`,
    state,
    challenge: input.challenge ?? false,
    business: {
      id: "gallery-business",
      displayName: input.name,
      tradeName: `${input.name} LLC`, // licence-locked: the record the claims are measured against
      slug: "gallery",
      claimStatus: input.challenge ? "claimed" : "disputed",
      licenceNumber: record.licenceNumber,
      licenceAuthority: "ADDED",
      areaName: "Mussafah M-14",
      emirate: "abu_dhabi",
    },
    source: { record, origin: { kind: "licence_import", importedAt: new Date("2026-01-14T08:00:00.000Z"), run: 9 }, categoryName: "HVAC & refrigeration" },
    incumbent: input.challenge ? { name: "Current owner", since: new Date("2025-11-03T08:00:00.000Z") } : null,
    claims: sides,
    assessment: assess(sides.filter((side) => side.outcome !== "withdrawn").map((side) => side.scored)),
    clock: conflictClock({ openedAt, now: NOW, escalatedAt: input.escalated ?? null }),
    listing: {
      views30d: 1842,
      reviewCount: 31,
      rating: 4.2,
      waitingEnquiries: input.waiting?.enquiries ?? 18,
      waitingBuyers: input.waiting?.buyers ?? 18,
    },
    escalation: input.escalated ? { at: input.escalated, to: "S. Nair", by: "R. Haddad", note: "The lease names a third party; legal needs to read it." } : null,
    docsRequest: input.docsRequested ? { at: input.docsRequested, by: "R. Haddad", note: "Same building; the tenancy settles the unit.", receivedAt: null } : null,
    resolution: input.resolved
      ? {
          kind: input.resolved.kind,
          at: NOW,
          by: "R. Haddad",
          note: "Called both numbers. A answered as the company. B is a former service partner using a similar name.",
          awardedId: input.resolved.awardedId,
          secondId: input.resolved.secondId ?? null,
          producedBusiness: null,
          producedLocationId: null,
          enquiriesReleased: 18,
          notifications: 4,
        }
      : null,
    dissolvedAt: input.dissolved ?? null,
    log,
  };
}

const A = (name: string, over: Partial<ClaimInput> = {}): ClaimInput => ({
  id: "claim-a",
  name: "Faisal Al Marzooqi",
  role: "owner",
  at: new Date(NOW.getTime() - (4 * DAY + 3 * HOUR)),
  facts: A_FACTS(name),
  ...over,
});
const B = (over: Partial<ClaimInput> = {}): ClaimInput => ({
  id: "claim-b",
  name: "Ahmed Siddiqui",
  role: "manager",
  at: new Date(NOW.getTime() - (3 * DAY + 6 * HOUR)),
  facts: B_FACTS,
  ...over,
});

function Workspace({ data, canResolve = true }: { data: ConflictReview; canResolve?: boolean }) {
  return (
    <div className="w-full">
      <ConflictWorkspace view={conflictView(data, { canResolve, holders: HOLDERS, assignee: "R. Haddad", now: NOW })} actions={ACTIONS} />
    </div>
  );
}

export function ConflictReviewGallery() {
  return (
    <Section id="conflict-review" title="4c · review a submission — conflicting claims" note="Every claim scored on the same rows; one resolve call">
      <States label="as drawn — A holds the source licence, 18 waiting, overdue" stack>
        <Workspace data={review({ name: "Cool Breeze Technical Services", claims: [A("Cool Breeze Technical Services"), B()] })} />
      </States>

      <States label="opened by a moderator — evidence and assign only" stack>
        <Workspace data={review({ name: "Arctic Line Refrigeration", claims: [A("Arctic Line Refrigeration"), B()] })} canResolve={false} />
      </States>

      <States label="neither holds the source licence, tied — no tag, no recommendation" stack>
        <Workspace
          data={review({
            name: "Polar Trade Cooling",
            sourceLicence: "ADDED-555000",
            claims: [A("Polar Trade Cooling", { facts: { ...A_FACTS("Polar Trade Cooling"), call: null } }), B({ facts: { ...A_FACTS("Polar Trade Cooling"), licenceNumber: "ADDED-555111", call: null } })],
            waiting: { enquiries: 0, buyers: 0 },
          })}
        />
      </States>

      <States label="a challenge to a granted claim — keep the owner or escalate" stack>
        <Workspace
          data={review({ name: "Glacier Air Systems", challenge: true, claims: [B({ at: new Date(NOW.getTime() - 20 * HOUR) })], openedAt: new Date(NOW.getTime() - 20 * HOUR), waiting: { enquiries: 6, buyers: 5 } })}
        />
      </States>

      <States label="three claims — one card each, nothing assumes two" stack>
        <Workspace
          data={review({
            name: "Tundra Climate Contracting",
            claims: [A("Tundra Climate Contracting"), B(), B({ id: "claim-c", name: "Omar Kassab", role: "partner", at: new Date(NOW.getTime() - 30 * HOUR), facts: { ...B_FACTS, register: null, emailDomain: null, call: null } })],
          })}
        />
      </States>

      <States label="tenancy documents asked for — the clock keeps running" stack>
        <Workspace
          data={review({
            name: "Nimbus Cooling Works",
            claims: [A("Nimbus Cooling Works", { tenancy: new Date(NOW.getTime() - 5 * HOUR) }), B()],
            docsRequested: new Date(NOW.getTime() - 26 * HOUR),
          })}
        />
      </States>

      <States label="escalated — holder named, clock paused" stack>
        <Workspace
          data={review({ name: "Mistral HVAC Services", claims: [A("Mistral HVAC Services"), B()], escalated: new Date(NOW.getTime() - 2 * DAY) })}
        />
      </States>

      <States label="resolved — read-only, the outcome and who decided it" stack>
        <Workspace
          data={review({
            name: "Halcyon Air Conditioning",
            claims: [A("Halcyon Air Conditioning", { outcome: "approved" }), B({ outcome: "rejected", partyReason: "not_source_licence" })],
            resolved: { kind: "award", awardedId: "claim-a" },
          })}
        />
      </States>

      <States label="dissolved — a withdrawal left one claim" stack>
        <Workspace
          data={review({
            name: "Aurora Chillers Trading",
            claims: [A("Aurora Chillers Trading"), B({ outcome: "withdrawn" })],
            dissolved: new Date(NOW.getTime() - 3 * HOUR),
            waiting: { enquiries: 0, buyers: 0 },
          })}
        />
      </States>
    </Section>
  );
}
