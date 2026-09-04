"use client";

import { useDeferredValue, useId, useState } from "react";
import { ListingCard, tierSpec } from "@/components/domain";
import { Eyebrow, StatusBadge } from "@/components/display";
import { SegmentedControl } from "@/components/primitives";
import { t } from "@/lib/i18n";

/**
 * Board 2c's right rail, and the reason the screen works.
 *
 * The preview is not decoration. It renders **the card `1c` renders** — the same
 * component, fed the draft record instead of a saved one. A seller who cannot
 * picture the result writes a keyword list; a seller watching the card fill in
 * writes a sentence. Every field on the left has a visible consequence here.
 *
 * The board is explicit that a bespoke approximation would drift from the real
 * card within a sprint and take the screen's whole premise with it, so
 * `ListingCard` is imported rather than imitated. That is also why this file is
 * short: there is nothing to build, only something to feed.
 *
 * `useDeferredValue` is the debounce. The board asks for 400ms after the last
 * keystroke and forbids a re-render per character — a card reflowing on every
 * letter reads as instability while somebody is mid-sentence. React's own
 * deferral does this better than a timer would: it re-renders when the browser
 * is idle rather than on a fixed clock, so a fast typist never sees an
 * intermediate state and a slow one never waits the full four hundred.
 */

export interface PreviewRecord {
  slug: string;
  displayName: string;
  categoryName: string;
  categoryCode: string;
  areaName: string;
  emirateName: string;
  verificationTier: number;
  description: string;
  logoUrl: string | null;
  coverUrl: string | null;
  establishedYear: number | null;
  tradeLine: string;
  /** False where the claim is still with a reviewer. The pill is never optimistic. */
  verified: boolean;
}

export function ProfilePreview({ record }: { record: PreviewRecord }) {
  const deferred = useDeferredValue(record);
  const [mode, setMode] = useState<"search" | "full">("search");
  const modeId = useId();

  /*
     The same ladder the card's own badge reads.

     Hardcoding "Licence verified" here put two labels for one state on one
     screen — this line said tier 2's words while the card beside it said
     "Audited tier 4". One source, and they agree by construction.
  */
  const spec = tierSpec(deferred.verificationTier);

  return (
    <section aria-labelledby={modeId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow as="h2" id={modeId}>
          {t("profile_step.preview")}
        </Eyebrow>
        <SegmentedControl
          label={t("profile_step.preview_mode")}
          value={mode}
          onChange={(next) => setMode(next as "search" | "full")}
          options={[
            { value: "search", label: t("profile_step.preview_search") },
            { value: "full", label: t("profile_step.preview_full") },
          ]}
          size="sm"
        />
      </div>

      {/*
        `aria-hidden`, and deliberately.

        Everything in here is a second rendering of what the form already says,
        and the form is where a screen-reader user edits it. Announcing the card
        would read the display name, the description and the categories back on
        every deferred re-render — a preview is a visual answer to "what will
        this look like", and there is nothing to look at.
      */}
      {/*
        `inert`, and it has to be `inert` rather than the two attributes it
        replaces.

        This is the real card with its real controls — "View storefront", "Send
        enquiry" — which would navigate a seller away from a half-written
        description. `pointer-events-none` stops the mouse and leaves every one
        of them in the tab order; `aria-hidden` over focusable content is an axe
        failure and, underneath the failure, a keyboard user tabbing into
        controls their screen reader has been told do not exist.

        `inert` does both halves properly: out of the tab order, out of the
        accessibility tree, and unclickable. Which is right for a second
        rendering of what the form already says — announcing it would read the
        name, the description and the categories back on every deferred
        re-render.
      */}
      <div inert className="select-none">
        {mode === "search" ? (
          <ListingCard business={toCard(deferred)} context="search" />
        ) : (
          <FullPagePreview record={deferred} />
        )}
      </div>

      {/*
        The pill, stated outside the card for the reader the card is hidden from.
        Real state, never optimistic: a seller who took the phone route and is
        still pending sees that, honestly.
      */}
      <p className="text-caption text-muted">
        <StatusBadge tone={spec.tone} size="sm">
          {deferred.verified ? t(spec.labelKey as never) : t("profile_step.preview_pending")}
        </StatusBadge>
      </p>
    </section>
  );
}

/**
 * The draft, in the shape the real card takes.
 *
 * Only the display name reaches it — never the legal name. That is criterion 3,
 * and it is what makes the rule legible rather than arbitrary: the seller can
 * see for themselves that the suffix is for the registry and not for buyers.
 */
function toCard(record: PreviewRecord) {
  return {
    slug: record.slug,
    displayName: record.displayName,
    categoryName: record.categoryName,
    categoryCode: record.categoryCode,
    areaName: record.areaName,
    emirateName: record.emirateName,
    verificationTier: record.verificationTier,
    logoUrl: record.logoUrl,
    coverImageUrl: record.coverUrl,
    description: record.description,
    tradeLine: record.tradeLine,
    establishedYear: record.establishedYear,
  };
}

/**
 * The `1d` overview, scaled into the rail.
 *
 * Scaled rather than rebuilt: it is the same header treatment and the same
 * description, at the size the rail allows. A separate small-storefront
 * component would be the drift the board warns about, one file over.
 */
function FullPagePreview({ record }: { record: PreviewRecord }) {
  return (
    <div className="overflow-hidden rounded-card-lg border border-line bg-card">
      <div className="h-20 bg-fill">
        {record.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={record.coverUrl} alt="" className="size-full object-cover" />
        )}
      </div>
      <div className="p-4">
        <p className="font-serif text-h2 text-ink">{record.displayName}</p>
        <p className="mt-1 text-caption text-muted">
          {record.categoryName}
          {record.areaName ? ` · ${record.areaName}` : ""}
        </p>
        <p className="mt-3 text-body-sm text-body [text-wrap:pretty]">{record.description}</p>
      </div>
    </div>
  );
}
