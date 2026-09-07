"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/primitives";
import { Panel, Tabs } from "@/components/structure";
import { formatCount, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";
import type { ListingWorkspaceProps } from "./ListingWorkspace";

/**
 * The 392px rail: preview, moderation, documents, recent changes.
 *
 * The preview is why the rail is this wide. An editor for a public listing that
 * does not show the public listing makes the seller save to find out, and
 * criterion 8 asks that it render from **unsaved form state** — so the
 * description arrives as a prop from the form rather than from the record.
 */
export interface ListingRailProps {
  view: ListingWorkspaceProps["view"];
  /** Live from the textarea, so the card moves as the seller types. */
  description: string;
  withdrawAction: (formData: FormData) => Promise<ActionResult>;
  editable: boolean;
}

export function ListingRail({ view, description, withdrawAction, editable }: ListingRailProps) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [pending, startTransition] = useTransition();

  const heldCategories = view.held.filter(
    (row) => row.field === "additional_category" || row.field === "primary_category",
  );

  return (
    <div className="flex w-full shrink-0 flex-col gap-[var(--gutter)] xl:w-[392px]">
      <Panel
        eyebrow={t("listing.preview")}
        actions={
          <Tabs
            label={t("listing.preview_device")}
            active={device}
            onChange={(key) => setDevice(key as "desktop" | "mobile")}
            items={[
              { key: "desktop", label: t("listing.desktop") },
              { key: "mobile", label: t("listing.mobile") },
            ]}
          />
        }
      >
        <div className={device === "mobile" ? "mx-auto max-w-[320px]" : ""}>
          <PreviewCard view={view} description={description} />
        </div>
      </Panel>

      {/* ── Moderation: both halves, always ─────────────────────────────── */}
      <Panel eyebrow={t("listing.moderation")}>
        <ul className="flex flex-col gap-3">
          {heldCategories.map((row) => (
            <li key={row.id} className="flex gap-2">
              <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-pill bg-warn" />
              <span className="min-w-0 flex-1">
                <span className="block text-body-sm text-ink">
                  {t("listing.held_category", { name: row.label })}
                </span>
                <span className="mt-0.5 block font-mono text-eyebrow uppercase tracking-eyebrow text-body">
                  {t("listing.submitted_sla", { when: formatRelative(row.submittedAt) })}
                </span>
                {/*
                   The sentence a seller assumes the opposite of. Without it the
                   reasonable reading is that the whole listing is held while one
                   chip is checked.
                */}
                <span className="mt-1 block text-caption text-body">
                  {view.additional.length === 0
                    ? t("listing.stays_live_none")
                    : t("listing.stays_live", {
                        count: view.additional.length,
                        formatted: formatCount(view.additional.length),
                      })}
                </span>
                {editable && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      const form = new FormData();
                      form.set("id", row.id);
                      startTransition(async () => {
                        await withdrawAction(form);
                      });
                    }}
                  >
                    {t("listing.withdraw")}
                  </Button>
                )}
              </span>
            </li>
          ))}

          {/*
             Board 3b Q3. The refusal, in full, where there is room for a
             sentence.

             The chip beside the categories field carries the mark and points
             here with `aria-describedby`; this is the half that can hold a
             moderator's own words. Both halves, because either alone fails:
             a mark with no reason is the state this board found, and a reason
             with no mark is a paragraph in the rail about a chip that is not
             drawn.

             The canned line runs above the quoted words, and that order is the
             substance of the fix rather than decoration. "A moderator looked at
             this and did not add it" frames what follows as a decision under a
             rule; the sentence on its own reads as one person's opinion, which
             is what a seller assumes when a refusal arrives with no frame.
          */}
          {view.rejected.map((row) => (
            <li key={row.id} className="flex gap-2">
              <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-pill bg-bad" />
              <span id={`refused-${row.id}`} className="min-w-0 flex-1">
                <span className="block text-body-sm text-ink">
                  {t("listing.refused_category", { name: row.label })}
                </span>
                {row.decidedAt && (
                  <span className="mt-0.5 block font-mono text-eyebrow uppercase tracking-eyebrow text-body">
                    {t("listing.refused_when", { when: formatRelative(row.decidedAt) })}
                  </span>
                )}
                <span className="mt-1 block text-caption text-body">
                  {row.reason ? t("listing.refused_lede") : t("listing.refused_no_reason")}
                </span>
                {/*
                   A blockquote, not a `<q>`. The reason is a block passage
                   rather than an inline aside, and `<q>` makes the browser
                   generate quotation marks of its own — which land beside the
                   rule this already draws down the left, quoting it twice.
                */}
                {row.reason && (
                  <blockquote className="mt-1 mb-0 block max-w-prose border-l-2 border-line pl-2 text-caption text-ink">
                    {row.reason}
                  </blockquote>
                )}
                <span className="mt-1 block text-caption text-body">
                  {t("listing.refused_next")}
                </span>
              </span>
            </li>
          ))}

          {/*
             The live half, stated even when nothing is held. A card that only
             ever lists what is stuck reads as though nothing shipped — and when
             there is nothing held at all its absence would read as broken.
          */}
          <li className="flex gap-2">
            <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-pill bg-ok" />
            <span className="min-w-0 flex-1">
              <span className="block text-body-sm text-ink">{t("listing.live_now")}</span>
              <span className="mt-0.5 block font-mono text-eyebrow uppercase tracking-eyebrow text-body">
                {view.lastSavedAt
                  ? t("listing.saved_when", { when: formatRelative(view.lastSavedAt) })
                  : t("listing.never_saved")}
              </span>
            </span>
          </li>
        </ul>

        <p className="mt-3 max-w-prose border-t border-line pt-3 text-caption text-body">
          {t("listing.moderation_note")}
        </p>
      </Panel>

      {/* ── Documents live on 3e, and only there ────────────────────────── */}
      <Panel eyebrow={t("listing.documents")}>
        <p className="max-w-prose text-caption text-body">{t("listing.documents_body")}</p>
        <Link
          href="/dashboard/verification"
          className="mt-3 inline-block text-body-sm text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {t("listing.documents_link")}
        </Link>
      </Panel>

      <Panel eyebrow={t("listing.history")}>
        {view.revisions.length === 0 ? (
          <p className="text-caption text-body">{t("listing.history_empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.revisions.map((row) => (
              <li key={row.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-caption text-ink">
                  {row.itemCount
                    ? t("listing.revision_counted", {
                        field: t(`listing.field.${row.field}` as "listing.field.description"),
                        count: row.itemCount,
                        formatted: formatCount(row.itemCount),
                        author: row.author,
                      })
                    : t("listing.revision", {
                        field: t(`listing.field.${row.field}` as "listing.field.description"),
                        author: row.author,
                      })}
                </span>
                <span className="shrink-0 font-mono text-eyebrow uppercase tabular-nums text-body">
                  {formatRelative(row.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-caption text-body">{t("listing.history_note")}</p>
      </Panel>
    </div>
  );
}

/**
 * What a buyer sees, from what the seller has typed rather than what is stored.
 *
 * Criterion 8. It is a card and not the storefront: a faithful storefront in
 * 392px would be a screenshot nobody can read, and the card is the shape the
 * listing actually appears in on search, on category pages and in the RFQ
 * recipient list — which is where most buyers meet it.
 */
function PreviewCard({
  view,
  description,
}: {
  view: ListingWorkspaceProps["view"];
  description: string;
}) {
  const line = [view.primary.parentName ?? view.primary.name, view.place]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

  return (
    <div className="rounded-card border border-line bg-card">
      <div
        aria-hidden="true"
        className="h-16 rounded-t-card bg-fill"
        style={
          view.photos.picked[0]
            ? { backgroundImage: `url(${view.photos.picked[0].url})`, backgroundSize: "cover", backgroundPosition: "center" }
            : undefined
        }
      />
      <div className="flex flex-col gap-1 p-3">
        {/*
           `displayName`, always. CLAUDE.md's most repeated defect: a card
           carrying the licence-locked name means the buyer reads one name and
           lands on another.
        */}
        <span className="text-body-sm font-medium text-ink">{view.displayName}</span>
        <span className="text-caption text-body">
          {view.ratingOverall === null
            ? line
            : `${line} · ${view.ratingOverall.toFixed(1)} (${formatCount(view.reviewCount)})`}
        </span>
        <p className="mt-1 line-clamp-3 text-caption text-body">
          {description.trim() || t("listing.preview_no_description")}
        </p>
      </div>
    </div>
  );
}
