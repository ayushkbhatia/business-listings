"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button } from "@/components/primitives";
import { DataTable, Drawer, Modal, SelectionBar, type Column } from "@/components/structure";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { AreaOption } from "@/components/domain";
import type { BranchRow, CoverageRow } from "@/lib/db/queries/locations";
import type { PinIssue } from "@/lib/locations/branch";
import type { HideConsequence } from "@/lib/locations/service";
import { BranchEditor } from "./BranchEditor";
import { BranchMapRail } from "./BranchMapRail";
import { CoveragePanel, type CoveragePanelProps } from "./CoveragePanel";
import type {
  ConsequenceResult,
  DeleteResult,
  LocationResult,
  PinActionResult,
  VisibilityActionResult,
} from "./actions";

/**
 * Board 3c — the locations manager.
 *
 * Onboarding asked for one branch and its pin. This manages a network, and the
 * two things that make it more than a list are both consequences rather than
 * fields: **a branch's pin decides whether buyers can find it**, and the two
 * ways a pin can be wrong fail differently.
 *
 * The table and the rail are one component because they are one set of numbers.
 * Criterion 1 — header, rows and overlay reconcile — is only true while all
 * three read the same `branchCounts`, and splitting them across two servers
 * renders is how the board arrived with `4 branches` over five rows.
 */

export interface LocationsWorkspaceProps {
  branches: readonly BranchRow[];
  coverage: readonly CoverageRow[];
  issues: readonly PinIssue[];
  counts: { total: number; shown: number; pinned: number; missing: number };
  areas: readonly AreaOption[];
  areaCentres: Readonly<Record<string, { lat: number; lng: number }>>;
  coverageGroups: CoveragePanelProps["groups"];
  leadOptions: CoveragePanelProps["leadOptions"];
  readOnly: boolean;

  saveAction: (formData: FormData) => Promise<LocationResult>;
  deleteAction: (formData: FormData) => Promise<DeleteResult>;
  pinAction: (formData: FormData) => Promise<PinActionResult>;
  visibilityAction: (formData: FormData) => Promise<VisibilityActionResult>;
  previewAction: (formData: FormData) => Promise<ConsequenceResult>;
  coverageSaveAction: CoveragePanelProps["saveAction"];
  coverageRemoveAction: CoveragePanelProps["removeAction"];
}

/*
   Three tones for three states, and the middle one is the point.

   `Hidden` is amber rather than grey because it is the state a seller reaches
   for without knowing what it costs — it stops the RFQs too, which is not what
   somebody hiding a walk-in office expects. `Draft` is neutral: nothing has
   been taken away, it has simply not started.
*/
const STATUS_TONE = {
  published: "ok",
  hidden: "warn",
  draft: "neutral",
} as const;

export function LocationsWorkspace(props: LocationsWorkspaceProps) {
  const [selected, setSelected] = useState<string[]>([]);
  /** A branch id, or `"new"` for one that does not exist yet. */
  const [editing, setEditing] = useState<string | null>(null);
  const [focusPin, setFocusPin] = useState(false);
  const [hiding, setHiding] = useState<{ ids: string[]; consequence: HideConsequence } | null>(null);
  /*
     The notice and the way out of it, together.

     `Alert` refuses a `bad` tone with neither — design-system §05.1, enforced at
     runtime — and it is right to: an error that names a problem and no remedy
     is the house rule about error copy broken in the one place it matters.
  */
  const [error, setError] = useState<{ error: string; fix: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const open = props.branches.find((branch) => branch.id === editing) ?? null;
  const adding = editing === "new";

  /* ── Status, and the sentence in front of it ───────────────────────────── */

  function publish(ids: readonly string[]) {
    const form = new FormData();
    form.set("ids", ids.join(","));
    form.set("published", "on");
    setError(null);
    startTransition(async () => {
      const result = await props.visibilityAction(form);
      if (!result.ok) setError(result);
      else setSelected([]);
    });
  }

  /**
   * Hiding asks first — board 3c Q4.
   *
   * *"Does hiding a branch that is the only one in its area remove the business
   * from that area page? Yes, and it should say so at the moment of hiding."*
   * The seller never sees the area page they fall off, so nothing tells them
   * afterwards. This is the shape board 3f §4 settled on for destructive bulk
   * actions: name what it touches, then commit.
   */
  function askToHide(ids: readonly string[]) {
    const form = new FormData();
    form.set("ids", ids.join(","));
    setError(null);
    startTransition(async () => {
      const result = await props.previewAction(form);
      if (!result.ok) setError(result);
      else setHiding({ ids: [...ids], consequence: result.consequence });
    });
  }

  function confirmHide() {
    if (!hiding) return;
    const form = new FormData();
    form.set("ids", hiding.ids.join(","));
    startTransition(async () => {
      const result = await props.visibilityAction(form);
      if (!result.ok) setError(result);
      setHiding(null);
      setSelected([]);
    });
  }

  /* ── The table ─────────────────────────────────────────────────────────── */

  const columns: readonly Column<BranchRow>[] = [
    {
      key: "branch",
      header: t("locations.col.branch"),
      // 264px, so `Head office & main warehouse` and its address fit on two
      // lines rather than three. The board left it 96px beside 620px of fixed
      // columns and every name wrapped.
      width: "minmax(16.5rem, 1fr)",
      render: (branch) => (
        <div className="min-w-0">
          <p className="truncate text-body-sm font-medium text-ink">{branch.name}</p>
          <p className="truncate text-caption text-muted">
            {branch.phone ? `${branch.addressLine} · ${branch.phone}` : branch.addressLine}
          </p>
        </div>
      ),
    },
    {
      key: "type",
      header: t("locations.col.type"),
      width: "8rem",
      // Dropped first below 1280: it repeats in the branch name for every row.
      hideBelow: "lg",
      render: (branch) => <span className="text-body-sm text-body">{branch.typeName}</span>,
    },
    {
      key: "area",
      header: t("locations.col.area"),
      width: "10rem",
      hideBelow: "md",
      /*
         The taxonomy value, beside a free-text address that usually repeats it.

         It earns its column because it is what `1b` and `1c` facet on: the
         address is what a driver reads and this is what a filter matches.
      */
      render: (branch) => (
        <span className="text-body-sm text-body">
          {branch.areaName}
          {branch.isFreeZone && (
            <span className="ms-1.5 font-mono text-eyebrow uppercase text-muted">
              {t("locations.free_zone_tag")}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "pin",
      header: t("locations.col.pin"),
      width: "6rem",
      render: (branch) => (
        <span
          className={cn(
            "text-body-sm",
            branch.pin === "exact" && "text-body",
            branch.pin === "approximate" && "text-warn-deep",
            branch.pin === "missing" && "text-bad",
          )}
        >
          {t(`locations.pin.${branch.pin}` as "locations.pin.exact")}
        </span>
      ),
    },
    {
      key: "status",
      header: t("locations.col.status"),
      width: "7rem",
      render: (branch) => (
        <StatusBadge tone={STATUS_TONE[branch.status]} shape="chip">
          {t(`locations.status.${branch.status}` as "locations.status.published")}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert tone="bad" live="assertive" fix={error.fix}>
          {error.error}
        </Alert>
      )}
      {props.readOnly && <Alert tone="info">{t("locations.staff_read_only")}</Alert>}

      {/*
        Below 1280 the rail moves under the table as a full-width landscape card
        — which suits a square-ish bounding box better than a portrait strip
        does — and the issue card sits beside it.
      */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22.5rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {selected.length > 0 && !props.readOnly && (
            <SelectionBar
              count={selected.length}
              countLabel={(count) => t("locations.selected", { count })}
              onClear={() => setSelected([])}
              clearLabel={t("locations.clear_selection")}
              actions={[
                {
                  key: "publish",
                  label: t("locations.publish"),
                  onSelect: () => publish(selected),
                  disabled: pending,
                },
                {
                  key: "hide",
                  label: t("locations.hide"),
                  onSelect: () => askToHide(selected),
                  disabled: pending,
                  // Not red, and not adjacent to publish. Hiding is reversible;
                  // what it needs is the sentence in the modal, not a colour.
                },
              ]}
            />
          )}

          {!props.readOnly && (
            /*
               `+ Add branch` sits over the table it adds to rather than in the
               page header, where the render draws it. The header is server-
               rendered and the editor is client state; putting the control
               there would mean either a second drawer or this codebase's first
               `useSearchParams`, and neither is worth a button moving 40px.

               There is no `Import from CSV`. `11d` is the *product* importer —
               nine columns, template-driven, built for hundreds of rows and a
               rollback. A locations importer is a different mapper for a seller
               with five branches, and if bulk locations ever becomes real it is
               an `11d`-family board rather than a button here. Criterion 7.
            */
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setFocusPin(false);
                  setEditing("new");
                }}
              >
                {t("locations.add_branch")}
              </Button>
            </div>
          )}

          <DataTable
            columns={columns}
            rows={props.branches}
            rowKey={(branch) => branch.id}
            caption={t("locations.table_caption")}
            selectable={!props.readOnly}
            selected={selected}
            onSelectedChange={setSelected}
            selectAllLabel={t("locations.select_all")}
            selectRowLabel={(branch) => t("locations.select_row", { branch: branch.name })}
            actionsHeader={props.readOnly ? t("locations.view") : t("locations.edit")}
            rowAction={(branch) => ({
              label: props.readOnly ? t("locations.view") : t("locations.edit"),
              onSelect: () => {
                setFocusPin(false);
                setEditing(branch.id);
              },
            })}
            rowMenu={
              props.readOnly
                ? undefined
                : (branch) =>
                    branch.status === "published"
                      ? [
                          {
                            key: "hide",
                            label: t("locations.hide"),
                            onSelect: () => askToHide([branch.id]),
                          },
                        ]
                      : [
                          {
                            key: "publish",
                            label: t("locations.publish"),
                            onSelect: () => publish([branch.id]),
                          },
                        ]
            }
            rowMenuLabel={(branch) => branch.name}
            // Meaning only: a row nobody can see is the row the seller is
            // looking for when they open this screen.
            rowTone={(branch) => (branch.status === "published" ? "default" : "attention")}
            empty={
              <p className="px-4 py-6 text-body-sm text-muted">{t("locations.none_body")}</p>
            }
          />

          {/*
            The two sentences the board never wrote. Under the table rather than
            in a tooltip, because the words they explain are in every row.
          */}
          <div className="flex max-w-prose flex-col gap-1.5 text-caption text-body">
            <p>{t("locations.consequence_status")}</p>
            <p>{t("locations.consequence_pin")}</p>
            <p>
              {t("locations.hours_pointer")}{" "}
              {/*
                Underlined at rest, not on hover.

                It is the one link on this screen that sits inside a paragraph
                of prose, and axe's `link-in-text-block` is right about it:
                moss on body text is 1.29:1, so without the rule the only thing
                separating the link from the sentence around it is a colour a
                reader may not perceive. The standalone links elsewhere in this
                codebase are not in a text block and do not have the problem.
              */}
              <Link
                href="/dashboard/hours"
                className="text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("locations.hours_link")}
              </Link>
            </p>
          </div>

          <CoveragePanel
            rows={props.coverage}
            groups={props.coverageGroups}
            leadOptions={props.leadOptions}
            saveAction={props.coverageSaveAction}
            removeAction={props.coverageRemoveAction}
            readOnly={props.readOnly}
          />
        </div>

        <BranchMapRail
          branches={props.branches}
          issues={props.issues}
          counts={props.counts}
          onFix={(id) => {
            setFocusPin(true);
            setEditing(id);
          }}
          onSelect={(id) => {
            // A pin click is "tell me about this branch", not "fix the pin" —
            // so the editor opens at the top rather than scrolled to its map.
            setFocusPin(false);
            setEditing(id);
          }}
        />
      </div>

      <Drawer
        open={open !== null || adding}
        onClose={() => setEditing(null)}
        title={open?.name ?? t("locations.add")}
        description={props.readOnly ? t("locations.staff_read_only") : undefined}
        closeLabel={t("locations.done")}
        size="lg"
      >
        {(open || adding) && (
          <BranchEditor
            branch={open}
            areas={props.areas}
            areaCentres={props.areaCentres}
            focusPin={focusPin}
            saveAction={props.saveAction}
            deleteAction={props.deleteAction}
            pinAction={props.pinAction}
            onDone={() => setEditing(null)}
            readOnly={props.readOnly}
          />
        )}
      </Drawer>

      <Modal
        open={hiding !== null}
        onClose={() => setHiding(null)}
        title={t("locations.hide_confirm_title", { count: hiding?.ids.length ?? 0 })}
        closeLabel={t("locations.cancel")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setHiding(null)} disabled={pending}>
              {t("locations.cancel")}
            </Button>
            <Button onClick={confirmHide} disabled={pending}>
              {t("locations.hide_do_it")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 text-body-sm text-body">
          {hiding?.consequence.lastPublished && (
            <Alert tone="warn">{t("locations.hide_last")}</Alert>
          )}
          {hiding && hiding.consequence.areasLost.length > 0 && (
            <p>
              {t("locations.hide_areas", {
                count: hiding.consequence.areasLost.length,
                areas: hiding.consequence.areasLost.map((area) => area.name).join(", "),
              })}
            </p>
          )}
          <p className="text-muted">{t("locations.hide_nothing_else")}</p>
        </div>
      </Modal>
    </div>
  );
}
