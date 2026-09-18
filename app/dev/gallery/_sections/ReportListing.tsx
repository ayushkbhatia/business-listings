"use client";

import { ReportListingForm } from "@/components/domain";
import { Alert } from "@/components/display";
import { t } from "@/lib/i18n";
import type { FileResult, ReportFormData } from "@/lib/reports/form";
import { Section, States } from "../_kit";

/**
 * Board 13c — *Report a listing*, in every state the modal reaches.
 *
 * Drawn in the modal's own frame rather than in a `<dialog>`: a closed dialog
 * is invisible and an open one takes the page, so the gallery draws the panel
 * the dialog holds — the same title, the same lede, the same component with
 * `layout="modal"`. Nothing posts. The action here answers with the result each
 * specimen names, so the refusal and the three confirmations are the real
 * component's own rendering of them.
 *
 * The data is built the way `reportFormData` builds it, from the same catalogue
 * keys, for a claimed listing that shows a telephone number and an address and
 * has no photograph. Claimed rather than the board's unclaimed storefront
 * because an unclaimed page prints no telephone, and so offers none to report —
 * this is the specimen where the sub-choice has three rows to choose between.
 */

const BUSINESS = "Deira Bearing House";

function reason(kind: "closed" | "wrong_details" | "wrong_trade", fields: string[], slaHours: number) {
  return {
    value: kind,
    label: t(`report_listing.kind.${kind}` as "report_listing.kind.closed"),
    description: t(`report_listing.kind_hint.${kind}` as "report_listing.kind_hint.closed"),
    fields: fields.map((field) => ({
      value: field,
      label: t(`report_listing.field.${field}` as "report_listing.field.phone"),
      takesCorrection: ["phone", "address", "name", "website", "hours"].includes(field),
      takesCategory: kind === "wrong_trade" && field === "category",
    })),
    slaDays: Math.ceil(slaHours / 24),
  };
}

const DATA: ReportFormData = {
  slug: "deira-bearing-house",
  businessName: BUSINESS,
  reasons: [
    reason("closed", ["licence"], 72),
    reason("wrong_details", ["phone", "address", "name"], 120),
    reason("wrong_trade", ["category"], 120),
    {
      value: "claim_dispute",
      label: t("report_listing.kind.claim_dispute"),
      description: t("report_listing.kind_hint.claim_dispute"),
      fields: [],
      slaDays: 0,
    },
  ],
  categories: [
    {
      label: "Industrial supplies",
      options: [
        { value: "c-industrial", label: t("report_listing.category_general", { sector: "Industrial supplies" }) },
        { value: "c-valves", label: "Valves & actuators" },
        { value: "c-pumps", label: "Pumps" },
      ],
    },
  ],
  signedIn: false,
  claimHref: `/onboarding/claim?q=${encodeURIComponent(BUSINESS)}`,
  limits: { detail: 1200, correction: 160 },
};

const REFERENCE = "RP-4K2M9XQT";

/** A stand-in for the server action. Answers what the specimen asks it to. */
function answering(result: FileResult) {
  return async () => result;
}

const refused: FileResult = {
  ok: false,
  error: t("report_listing.error.already_reported"),
  fix: t("report_listing.fix.already_reported"),
};

function Frame({ children, filed = false }: { children: React.ReactNode; filed?: boolean }) {
  return (
    <div className="w-full max-w-xl overflow-hidden rounded-panel border border-line bg-card shadow-overlay">
      <div className="border-b border-line px-4 py-3">
        <p className="text-h2 text-ink">{t("report_listing.title", { business: BUSINESS })}</p>
        {filed ? null : <p className="mt-0.5 text-caption text-muted">{t("report_listing.lede")}</p>}
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  );
}

export function ReportListingGallery() {
  const neverSent = answering(refused);
  return (
    <Section id="report-listing" title="Report a listing" note="board 13c · /b/:slug?report=1 and /report/:slug">
      <States label="as opened · nothing chosen, send waits" stack>
        <Frame>
          <ReportListingForm
            label="Report a listing · as opened"
            data={DATA}
            fileReport={neverSent}
            layout="modal"
            onCancel={() => {}}
          />
        </Frame>
      </States>
      <States label="a detail is wrong · the telephone, with what it should say" stack>
        <Frame>
          <ReportListingForm
            label="Report a listing · the telephone"
            data={DATA}
            fileReport={neverSent}
            layout="modal"
            onCancel={() => {}}
            initial={{ reason: "wrong_details", field: "phone", correction: "04 227 9901" }}
          />
        </Frame>
      </States>
      <States label="not this trade · the trade it should be" stack>
        <Frame>
          <ReportListingForm
            label="Report a listing · not this trade"
            data={DATA}
            fileReport={neverSent}
            layout="modal"
            onCancel={() => {}}
            initial={{ reason: "wrong_trade" }}
          />
        </Frame>
      </States>
      <States label="someone else claimed my business · a door, not a report" stack>
        <Frame>
          <ReportListingForm
            label="Report a listing · claim door"
            data={DATA}
            fileReport={neverSent}
            layout="modal"
            onCancel={() => {}}
            initial={{ reason: "claim_dispute" }}
          />
        </Frame>
      </States>
      <States label="refused · the same source, twice" stack>
        <Frame>
          <ReportListingForm
            label="Report a listing · refused"
            data={DATA}
            fileReport={neverSent}
            layout="modal"
            onCancel={() => {}}
            initial={{ reason: "closed", result: refused }}
          />
        </Frame>
      </States>
      <States label="sent · an email left, written to once" stack>
        <Frame filed>
          <ReportListingForm
            label="Report a listing · sent, email"
            data={DATA}
            fileReport={neverSent}
            layout="modal"
            onCancel={() => {}}
            initial={{
              reason: "closed",
              result: { ok: true, reference: REFERENCE, replyTo: "email", email: "someone@example.ae" },
            }}
          />
        </Frame>
      </States>
      <States label="sent · no way back, the reference is the answer" stack>
        <Frame filed>
          <ReportListingForm
            label="Report a listing · sent, no way back"
            data={DATA}
            fileReport={neverSent}
            layout="modal"
            onCancel={() => {}}
            initial={{
              reason: "wrong_details",
              field: "phone",
              result: { ok: true, reference: REFERENCE, replyTo: null, email: null },
            }}
          />
        </Frame>
      </States>
      <States label="sent · signed in, the account hears back" stack>
        <Frame filed>
          <ReportListingForm
            label="Report a listing · sent, signed in"
            data={{ ...DATA, signedIn: true }}
            fileReport={neverSent}
            layout="modal"
            onCancel={() => {}}
            initial={{
              reason: "wrong_trade",
              result: { ok: true, reference: REFERENCE, replyTo: "account", email: null },
            }}
          />
        </Frame>
      </States>
      <States label="loading · opened by a click, the form on its way" stack>
        <Frame>
          <p className="py-6 text-center text-body-sm text-muted">{t("report_listing.loading")}</p>
        </Frame>
      </States>
      <States label="no listing to report · suspended, closed or gone" stack>
        <Frame>
          <Alert tone="bad" fix={t("report_listing.fix.not_found")}>
            {t("report_listing.error.not_found")}
          </Alert>
        </Frame>
      </States>
    </Section>
  );
}
