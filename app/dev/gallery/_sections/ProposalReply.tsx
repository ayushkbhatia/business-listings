import { ProposalComposer, type ProposalServiceOption } from "@/app/(dashboard)/dashboard/leads/ProposalComposer";
import { ProposalLeadView, type ProposalLeadModel } from "@/app/(dashboard)/dashboard/leads/_proposal-view";
import { Button } from "@/components/primitives";
import type { ProposalInput } from "@/lib/quote/proposal";
import { t } from "@/lib/i18n";
import { Section, States } from "../_kit";

/**
 * Board `3j-s` — replying to a brief, in every state its spec lists.
 *
 * The page's own view and the page's own composer, rendered from plain values.
 * The decline control is a static stand-in: its dialog is a native `<dialog>`,
 * and a gallery page of eight open ones is not a state anybody will see.
 *
 * Typing in a composer here tries to autosave and is refused — there is no seat
 * behind the gallery, and the refusal is the composer's real error path.
 */

const SCOPE =
  "Quarterly PPM visits to a written schedule across both towers, covering 3 chillers, AHUs, pumps, LV distribution and BMS. 24/7 reactive callout with 4-hour attendance. Named account engineer.";
const EXCLUDED =
  "Major plant replacement, refrigerant gas beyond 5 kg per annum, civil and builder's work, asbestos handling, and works requiring a road closure permit. Spare parts above AED 500 quoted separately before proceeding.";

const SERVICE: ProposalServiceOption = {
  id: "svc-hard-fm",
  name: "Planned and reactive MEP maintenance",
  draft: false,
  basis: "ok",
  feeBasisLabel: "Per month",
  editHref: "#proposal-reply",
  seed: { scope: SCOPE, deliverable: "Monthly written report with photographs", deliveredWhere: "On site, both towers", exclusions: EXCLUDED },
};

const TYPICAL_INPUT: ProposalInput = {
  serviceId: SERVICE.id,
  fee: "18,400",
  mobilisation: "6,000",
  termMonths: "24",
  validityDays: 30,
  scope: SCOPE,
  deliverable: SERVICE.seed.deliverable,
  deliveredWhere: SERVICE.seed.deliveredWhere,
  exclusions: EXCLUDED,
};

const MODEL: ProposalLeadModel = {
  ref: "ENQ-8851",
  title: "Hard FM & MEP maintenance",
  replyChip: { tone: "neutral", label: "Reply due in 2 h" },
  othersLabel: "Also sent to 5 others",
  backHref: "#proposal-reply",
  brief: {
    rows: [
      { key: "site", label: "Site", value: "Dubai · Bay Square, Business Bay" },
      { key: "engagement", label: "Engagement", value: "Ongoing contract · Quarterly" },
      { key: "start", label: "From", value: "1 Nov 2026" },
      { key: "scale", label: "Scale, in their words", value: "12 floors, 3 chillers, about 40,000 sq ft" },
    ],
    requirement:
      "Two commercial towers, 12 and 14 floors. Quarterly PPM on chillers, AHUs and pumps plus a 24/7 reactive line. Current contract ends 31 October.",
    attachments: [
      { id: "a1", filename: "asset-register.xlsx", href: "#proposal-reply", size: "48 KB" },
      { id: "a2", filename: "tower-drawings.pdf", href: "#proposal-reply", size: "2.1 MB" },
    ],
  },
  buyer: { name: "Mohammed", released: [] },
  state: { kind: "compose" },
  sent: [],
};

const SENT_ROW = {
  id: "q1",
  ref: "QT-8851-EMIR1",
  sentLabel: "Sent 3 hours ago",
  fee: "AED 18,400 · Per month",
  term: "24 months",
  mobilisation: "AED 6,000 one-off",
  validUntil: "14 Oct 2026",
  status: "Sent",
};

function Lead({
  model,
  composer,
  decline = true,
}: {
  model: ProposalLeadModel;
  composer?: React.ReactNode;
  decline?: boolean;
}) {
  return (
    <div className="w-full">
      <ProposalLeadView
        model={model}
        askHref="#proposal-reply"
        askLabel={model.sent.length > 0 ? t("lead.message_buyer") : t("proposal.ask_first")}
        {...(decline ? { decline: <Button variant="secondary">{t("decline.action")}</Button> } : {})}
        {...(composer ? { composer } : {})}
      />
    </div>
  );
}

function Composer(props: Partial<React.ComponentProps<typeof ProposalComposer>>) {
  return (
    <ProposalComposer
      enquiryId="gallery-3js"
      services={[SERVICE]}
      initial={TYPICAL_INPUT}
      restoredAt={null}
      revision={1}
      others={5}
      lateSince={null}
      {...props}
    />
  );
}

export function ProposalReplyGallery() {
  return (
    <Section id="proposal-reply" title="proposal-reply" note="board 3j-s · a fee on a basis, a scope, an exclusions list">
      <States label="typical" stack>
        <Lead model={MODEL} composer={<Composer />} />
      </States>

      <States label="draft saved" stack>
        <Lead model={MODEL} composer={<Composer restoredAt={new Date("2026-09-14T08:00:00Z").getTime()} />} />
      </States>

      <States label="question asked, no proposal · scale empty" stack>
        <Lead
          model={{
            ...MODEL,
            replyChip: null,
            brief: {
              ...MODEL.brief,
              attachments: [],
              rows: MODEL.brief.rows.map((row) =>
                row.key === "scale"
                  ? { ...row, value: t("proposal.brief_scale_none"), missing: true }
                  : row,
              ),
            },
          }}
          composer={<Composer initial={{ ...TYPICAL_INPUT, fee: "", mobilisation: "", termMonths: "" }} />}
        />
      </States>

      <States label="reply window elapsed · still sendable" stack>
        <Lead
          model={{ ...MODEL, replyChip: { tone: "bad", label: "Reply overdue by 3 h" } }}
          composer={<Composer lateSince={new Date("2026-09-14T05:00:00Z").getTime()} />}
        />
      </States>

      <States label="service has no fee basis · blocked" stack>
        <Lead
          model={MODEL}
          composer={
            <Composer
              services={[{ ...SERVICE, basis: "no_basis", feeBasisLabel: null }]}
              initial={{ ...TYPICAL_INPUT, fee: "" }}
            />
          }
        />
      </States>

      <States label="two scope sheets · pick one" stack>
        <Lead
          model={MODEL}
          composer={
            <Composer
              services={[
                SERVICE,
                { ...SERVICE, id: "svc-callout", name: "Chiller call-out", draft: true, feeBasisLabel: "Per visit" },
              ]}
            />
          }
        />
      </States>

      <States label="revision 2 · proposal sent" stack>
        <Lead model={{ ...MODEL, replyChip: null, sent: [SENT_ROW] }} composer={<Composer revision={2} />} decline={false} />
      </States>

      <States label="declined by you" stack>
        <Lead
          model={{
            ...MODEL,
            replyChip: null,
            state: {
              kind: "read_only",
              tone: "neutral",
              title: t("proposal.readonly.declined_title"),
              body: t("proposal.readonly.declined_reason", { when: "14 Sep 2026", reason: "Outside the area we cover" }),
            },
          }}
          decline={false}
        />
      </States>

      <States label="buyer accepted another supplier" stack>
        <Lead
          model={{
            ...MODEL,
            replyChip: null,
            state: {
              kind: "read_only",
              tone: "neutral",
              title: t("proposal.readonly.elsewhere_title"),
              body: t("proposal.readonly.elsewhere"),
            },
            sent: [{ ...SENT_ROW, status: "Lost" }],
          }}
          decline={false}
        />
      </States>

      <States label="no service in this trade" stack>
        <Lead
          model={{ ...MODEL, state: { kind: "no_service", trade: "Hard FM & MEP maintenance", href: "#proposal-reply" } }}
        />
      </States>
    </Section>
  );
}
