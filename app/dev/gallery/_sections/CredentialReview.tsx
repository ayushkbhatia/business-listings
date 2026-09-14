"use client";

import type { ActionResult } from "@/app/(admin)/admin/queue/actions";
import { CredentialDecision, RefetchButton } from "@/app/(admin)/admin/queue/credential/CredentialDecision";
import { CredentialRail, UnlocksPanel } from "@/app/(admin)/admin/queue/credential/panels";
import { RegisterComparison } from "@/app/(admin)/admin/queue/credential/RegisterComparison";
import { comparisonView, decisionView } from "@/app/(admin)/admin/queue/credential/view";
import { CredentialsWorkspace, type CredentialTile } from "@/app/(dashboard)/dashboard/setup/credentials/CredentialsWorkspace";
import { compareCredential, type Submitted } from "@/lib/credentials/compare";
import { FIXTURE_FIRMS, type FixtureFirm } from "@/lib/credentials/fta-fixture";
import { FTA_REGISTER_SOURCE, type RegisterFetch } from "@/lib/credentials/register-fetch";
import { t } from "@/lib/i18n";
import { Section, States } from "../_kit";

/**
 * Board `4c-s` — review a credential, in every state its spec lists.
 *
 * Each state is computed, not drawn: the fixture register the seed and the
 * review screen both read, compared with `compareCredential`, worded by
 * `comparisonView` and `decisionView` — the same three functions the route
 * calls. So "Verify is unavailable: 2 of the three fields match" here is the
 * sentence a reviewer reads on the near-match firm, and a state that cannot be
 * reached cannot be drawn.
 *
 * No `Panel` titles repeat and the rail renders once: a titled region is a
 * landmark, and the gallery drawing one twice fails the axe pass.
 */

const NOW = new Date("2026-09-14T05:14:00.000Z");
const MINUTE = 60_000;

const inert = async (): Promise<ActionResult> => ({ ok: false, error: "The gallery does not decide credentials." });
const inertSeller = async () => ({ ok: false as const, error: "The gallery does not save.", fix: "Use a real session." });

function firm(state: FixtureFirm["state"]): FixtureFirm {
  return FIXTURE_FIRMS.find((row) => row.state === state)!;
}

function submitted(row: FixtureFirm, expires?: string): Submitted {
  return {
    identifier: row.taan,
    name: row.tradeName, // licence-locked: the register compares the licensed name
    expiresOn: expires ? new Date(`${expires}T00:00:00.000Z`) : null,
    licenceNumber: row.licence,
    licenceAuthority: "DED",
  };
}

function read(row: FixtureFirm, agoMs = 5 * MINUTE, unreachable = false): RegisterFetch {
  const base = { v: 1 as const, asked: row.taan, fetchedAt: new Date(NOW.getTime() - agoMs).toISOString(), source: FTA_REGISTER_SOURCE };
  if (unreachable) return { ...base, outcome: "unavailable", cause: "timeout" };
  return row.record ? { ...base, outcome: "found", record: row.record } : { ...base, outcome: "not_found" };
}

function Review({
  row,
  expires,
  agoMs,
  unreachable,
  hasDocument = true,
}: {
  row: FixtureFirm;
  expires?: string;
  agoMs?: number;
  unreachable?: boolean;
  hasDocument?: boolean;
}) {
  const facts = submitted(row, expires);
  const comparison = compareCredential(facts, read(row, agoMs, unreachable), NOW);
  const view = comparisonView(comparison, facts, NOW);
  return (
    <div className="flex w-full max-w-3xl flex-col gap-4 rounded-panel border border-line bg-card p-4">
      <RegisterComparison
        view={view}
        certificate={hasDocument ? { label: "fta-agent-cert.pdf · 1.2 MB", href: "#credential-review" } : null}
        refetch={<RefetchButton credentialId={`gallery-${row.taan}`} refetch={inert} />}
      />
      <CredentialDecision
        credentialId={`gallery-${row.taan}`}
        decision={decisionView(comparison, hasDocument)}
        verify={inert}
        requestMore={inert}
        reject={inert}
      />
    </div>
  );
}

const tile = (over: Partial<CredentialTile> & Pick<CredentialTile, "id">): CredentialTile => ({
  kind: "fta_tax_agent",
  name: t("credentials.kind.fta_tax_agent"),
  identifier: "20040619",
  issuer: "Federal Tax Authority",
  expires: "31 Dec 2027",
  filename: "summit-fta-certificate.pdf",
  verified: false,
  verifiedBy: null,
  verifiedOn: null,
  standing: null,
  resubmit: null,
  ...over,
});

const SELLER_ROWS: CredentialTile[] = [
  tile({ id: "gallery-pending", standing: { tone: "info", body: t("credentials.review.pending") } }),
  tile({
    id: "gallery-more-info",
    standing: {
      tone: "warn",
      body: t("credentials.review.more_info", {
        note: "The certificate's expiry reads 31 Dec 2027 and the register says 31 Jan 2028. Upload the current certificate.",
      }),
      fix: t("credentials.review.more_info_fix"),
    },
    resubmit: { identifier: "20040619", expires: "2027-12-31" },
  }),
  tile({
    id: "gallery-rejected",
    identifier: "20017733",
    standing: {
      tone: "bad",
      body: t("credentials.review.rejected", {
        reason: t("credentials.review.reason.lapsed"),
        note: "The register lists the approval as expired on 30 Jun 2026.",
      }),
      fix: `${t("credentials.review.fix.lapsed")} ${t("credentials.review.hidden")}`,
    },
    resubmit: { identifier: "20017733", expires: "" },
  }),
  tile({
    id: "gallery-verified",
    identifier: "20028841",
    verified: true,
    verifiedBy: FTA_REGISTER_SOURCE,
    verifiedOn: "12 Sep 2026",
  }),
];

export function CredentialReviewGallery() {
  return (
    <Section id="credential-review" title="4c-s · review a credential" note="A register lookup: three fields and a cross-check">
      <States label="as drawn — fresh, all three" stack>
        <Review row={firm("match")} expires="2027-12-31" />
      </States>
      <States label="register unreachable" stack>
        <Review row={firm("unreachable")} unreachable agoMs={30 * MINUTE} />
      </States>
      <States label="number does not resolve" stack>
        <Review row={firm("not_found")} />
      </States>
      <States label="name near-match" stack>
        <Review row={firm("near_match")} />
      </States>
      <States label="different entity" stack>
        <Review row={firm("different_entity")} />
      </States>
      <States label="lapsed on the register" stack>
        <Review row={firm("lapsed")} hasDocument={false} />
      </States>
      <States label="certificate contradicts" stack>
        <Review row={firm("more_info")} expires="2027-12-31" />
      </States>
      <States label="stale read" stack>
        <Review row={firm("match")} expires="2027-12-31" agoMs={3 * 60 * MINUTE} />
      </States>
      <States label="what verifying changes" stack>
        <div className="w-full max-w-3xl">
          <UnlocksPanel unlocks={{ published: true, slug: "nexus-tax-consultancy", liveServices: 3, openProposals: 2 }} />
        </div>
      </States>
      <States label="rail" stack>
        <div className="w-full max-w-xs">
          <CredentialRail registerLive />
        </div>
      </States>
      <States label="seller: pending, more info, rejected, verified" stack>
        <div className="w-full max-w-3xl">
          <CredentialsWorkspace
            held={SELLER_ROWS}
            suggestions={[]}
            kinds={[{ value: "fta_tax_agent", label: t("credentials.kind.fta_tax_agent") }]}
            registerLive
            accept="application/pdf"
            sign={inertSeller}
            add={inertSeller}
            remove={inertSeller}
            resubmit={inertSeller}
          />
        </div>
      </States>
    </Section>
  );
}
