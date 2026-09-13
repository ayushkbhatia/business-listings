"use client";

import { useState } from "react";
import { Section, States } from "../_kit";
import { EMPTY_BRIEF } from "@/lib/enquiry/service-brief";
import {
  ServiceBriefComposer,
  type BriefAreaOption,
  type BriefRail,
  type BriefValue,
  type ServiceBriefComposerProps,
} from "@/components/domain/ServiceBriefComposer";

/**
 * Board `1h-s` — the brief, in every state its spec documents.
 *
 * Client-side because the composer is controlled: each specimen holds its own
 * value and files, so a reviewer can type into any of them and watch the
 * cadence appear, the date field open and the attach warning ask once. Plain
 * objects and no network — the rail's states are props, exactly as the preview
 * would hand them over.
 */

const AREAS: BriefAreaOption[] = [
  { id: "a-bb", name: "Business Bay", emirate: "dubai", isFreeZone: false },
  { id: "a-aq", name: "Al Quoz Industrial 1", emirate: "dubai", isFreeZone: false },
  { id: "a-dmcc", name: "DMCC", emirate: "dubai", isFreeZone: true },
  { id: "a-mu", name: "Mussafah M-17", emirate: "abu_dhabi", isFreeZone: false },
  { id: "a-ain", name: "Al Ain", emirate: "abu_dhabi", isFreeZone: false },
  { id: "a-sh4", name: "Industrial Area 4", emirate: "sharjah", isFreeZone: false },
];

const TRADE = "Hard FM & MEP maintenance";

const FILLED: BriefValue = {
  ...EMPTY_BRIEF,
  site: "area:a-bb",
  description:
    "Two commercial towers, 12 and 14 floors. Need quarterly PPM on chillers, AHUs and pumps plus a 24/7 reactive line. Current contract ends 31 October, so we want to be signed before then.",
  engagement: "ongoing_contract",
  cadence: "quarterly",
  startMode: "from_date",
  startsOn: "2026-11-01",
};

const NAMES = ["Emirates Facilities Group", "Al Shirawi Facilities", "Khansaheb Facilities"];

function Specimen({
  label,
  initial,
  files: initialFiles = [],
  ...props
}: Omit<
  ServiceBriefComposerProps,
  "value" | "onChange" | "files" | "onAddFiles" | "onRemoveFile" | "attachWarned" | "onAttachWarned" | "areas" | "subcategoryName" | "family"
> & { label: string; initial: BriefValue; files?: { name: string; size: number }[] }) {
  const [value, setValue] = useState(initial);
  const [files, setFiles] = useState(initialFiles);
  const [warned, setWarned] = useState(false);
  return (
    <ServiceBriefComposer
      embedded
      formLabel={`Brief — ${label}`}
      subcategoryName={TRADE}
      family="on_site_maintenance"
      areas={AREAS}
      value={value}
      onChange={setValue}
      files={files}
      onAddFiles={(chosen) => setFiles((held) => [...held, ...chosen.map((f) => ({ name: f.name, size: f.size }))])}
      onRemoveFile={(index) => setFiles((held) => held.filter((_, i) => i !== index))}
      attachWarned={warned}
      onAttachWarned={() => setWarned(true)}
      {...props}
    />
  );
}

const rail = (patch: Partial<BriefRail> & Pick<BriefRail, "state">): BriefRail => ({
  names: [],
  scope: "area",
  pinnedName: null,
  ...patch,
});

export function ServiceBriefGallery() {
  return (
    <Section id="service-brief-composer" title="service-brief-composer" note="board 1h-s · five questions, none a quantity">
      <States label="cold, signed out" stack>
        <Specimen
          label="cold"
          initial={EMPTY_BRIEF}
          rail={rail({ state: { kind: "no_site" }, scope: "emirate" })}
          firstReply={null}
          askForContact
        />
      </States>

      <States label="matched · six cover Business Bay" stack>
        <Specimen
          label="matched"
          initial={FILLED}
          files={[
            { name: "asset-register.pdf", size: 420_000 },
            { name: "tower-drawings.pdf", size: 3_100_000 },
          ]}
          rail={rail({ state: { kind: "matched", count: 6, thin: false }, names: NAMES })}
          firstReply="52 min"
          askForContact={false}
        />
      </States>

      <States label="thin · two, anywhere in Sharjah" stack>
        <Specimen
          label="thin"
          initial={{ ...EMPTY_BRIEF, site: "emirate:sharjah", engagement: "call_off", startMode: "asap" }}
          rail={rail({ state: { kind: "matched", count: 2, thin: true }, names: NAMES.slice(0, 2), scope: "emirate" })}
          firstReply={null}
          askForContact={false}
        />
      </States>

      <States label="nobody in the area · widen" stack>
        <Specimen
          label="widen"
          initial={{ ...EMPTY_BRIEF, site: "area:a-aq", engagement: "one_off_job" }}
          rail={rail({ state: { kind: "widen", emirateCount: 4 } })}
          onWiden={() => undefined}
          firstReply={null}
          askForContact={false}
        />
      </States>

      <States label="nobody anywhere · routed" stack>
        <Specimen
          label="none"
          initial={{ ...EMPTY_BRIEF, site: "area:a-ain" }}
          rail={rail({ state: { kind: "none" }, routed: true })}
          onRouteUnmatched={() => undefined}
          firstReply={null}
          askForContact={false}
        />
      </States>

      <States label="a named firm" stack>
        <Specimen
          label="pinned"
          initial={{ ...FILLED, site: "emirate:dubai", cadence: "", engagement: "ongoing_contract" }}
          rail={rail({ state: { kind: "pinned", count: 1 }, pinnedName: "Emirates Facilities Group", scope: "emirate" })}
          unpinHref="/rfq/new?category=hard-fm&kind=services"
          firstReply="3 h"
          askForContact={false}
        />
      </States>

      <States label="a named firm, undeliverable" stack>
        <Specimen
          label="pinned undeliverable"
          initial={{ ...EMPTY_BRIEF, site: "emirate:dubai" }}
          rail={rail({ state: { kind: "pinned", count: 0 }, pinnedName: "Emirates Facilities Group", scope: "emirate" })}
          unpinHref="/rfq/new?category=hard-fm&kind=services"
          firstReply={null}
          askForContact={false}
        />
      </States>

      <States label="refused by the server" stack>
        <Specimen
          label="refused"
          initial={{ ...FILLED, description: "PPM", startsOn: "2020-01-01" }}
          rail={rail({ state: { kind: "matched", count: 6, thin: false }, names: NAMES })}
          firstReply={null}
          askForContact={false}
          error="Some answers need another look. Each one is marked."
          fieldErrors={{
            description:
              "Describe the work in at least 10 characters — what it is, where on the site, and anything already agreed.",
            start: "Pick today or a later date.",
          }}
        />
      </States>

      <States label="draft restored, files lost" stack>
        <Specimen
          label="restored"
          initial={FILLED}
          lostFiles={["asset-register.pdf", "tower-drawings.pdf"]}
          rail={rail({ state: { kind: "matched", count: 6, thin: false }, names: NAMES })}
          firstReply={null}
          askForContact={false}
        />
      </States>

      <States label="sending" stack>
        <Specimen
          label="sending"
          initial={FILLED}
          rail={rail({ state: { kind: "matched", count: 6, thin: false }, names: NAMES })}
          firstReply="52 min"
          askForContact={false}
          busy
        />
      </States>
    </Section>
  );
}
