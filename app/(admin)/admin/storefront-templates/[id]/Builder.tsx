"use client";

import { useMemo, useState, useTransition } from "react";
import { Alert, StatusBadge, Tag } from "@/components/display";
import { Button, Checkbox, IconButton, Textarea } from "@/components/primitives";
import { Modal, Panel } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { TemplateChange } from "@/lib/storefront/diff";
import type { ActionResult } from "./actions";

/**
 * Board 5a — the builder, three panes.
 *
 * Section list left, canvas centre, settings right. The canvas is rendered on
 * the server and passed in as a node: the sections are server components that
 * read no browser API, and re-implementing them for a client preview would be
 * fourteen second renderings that drift from the first fourteen.
 *
 * ## The two-step publish
 *
 * Board 5e asks for a diff of what changed and then a confirm naming the store
 * count, and criterion 1 makes it an acceptance condition. Both halves are
 * here and both are load-bearing: the count without the diff is a number
 * somebody clicks past, and the diff without the count does not say how far it
 * reaches.
 *
 * Destructive changes lead the list. Somebody reading eleven changes reads the
 * first three.
 */

export interface BuilderSection {
  id: string;
  type: string;
  typeLabel: string;
  sourceLabel: string;
  enabled: boolean;
  fixed: boolean;
  showOnMobile: boolean;
  sellerEditableFields: string[];
  availableFields: { key: string; label: string }[];
}

export interface BuilderProps {
  templateId: string;
  sectorName: string;
  storeCount: number;
  status: string;
  sections: BuilderSection[];
  changes: TemplateChange[];
  canvas: React.ReactNode;
  addable: { key: string; label: string; group: string }[];
  actions: {
    toggleSection: (formData: FormData) => Promise<ActionResult>;
    reorder: (formData: FormData) => Promise<ActionResult>;
    addToTemplate: (formData: FormData) => Promise<ActionResult>;
    setFields: (formData: FormData) => Promise<ActionResult>;
    publish: (formData: FormData) => Promise<ActionResult>;
  };
}

const MIN_REASON = 4;

export function Builder({
  templateId,
  sectorName,
  storeCount,
  sections,
  changes,
  canvas,
  addable,
  actions,
}: BuilderProps) {
  const [selectedId, setSelectedId] = useState<string | null>(sections[0]?.id ?? null);
  /**
   * What the reader just clicked, before the server has said so.
   *
   * The checkbox is driven by server state, and a server action plus a
   * revalidate is a round-trip — so without this the box springs back to its
   * old value and sits there until the page data returns. A control that shows
   * the opposite of what somebody just did is worse than a slow one.
   *
   * Cleared when the server disagrees, which is what makes it optimistic rather
   * than a second source of truth.
   */
  const [pendingEnabled, setPendingEnabled] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  /**
   * The publish reason, separate from the edit reason.
   *
   * Each mutation writes its own audit row with its own reason, and publishing
   * is a mutation — it writes a version row that records what somebody agreed
   * to. So "turned reviews off while we re-cut the card" is the reason for the
   * toggle and not for the publish.
   *
   * They were one field to begin with, which meant the edit consumed it and
   * the publish button sat there dead with nothing saying why.
   */
  const [publishReason, setPublishReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const selected = sections.find((section) => section.id === selectedId) ?? null;
  const destructive = useMemo(() => changes.filter((change) => change.destructive), [changes]);
  const ready = reason.trim().length >= MIN_REASON;
  const readyToPublish = publishReason.trim().length >= MIN_REASON;

  function send(
    action: (formData: FormData) => Promise<ActionResult>,
    fields: Record<string, string>,
    withReason = reason,
  ) {
    const form = new FormData();
    form.set("templateId", templateId);
    form.set("reason", withReason);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) {
        setReason("");
        setPublishReason("");
        setConfirming(false);
      } else {
        // The server refused. Whatever the box is showing is wrong.
        setPendingEnabled({});
      }
    });
  }

  function move(index: number, delta: number) {
    const movable = sections.filter((section) => !section.fixed);
    const target = index + delta;
    if (target < 0 || target >= movable.length) return;
    const next = [...movable];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    send(actions.reorder, { orderedIds: next.map((section) => section.id).join(",") });
  }

  const movable = sections.filter((section) => !section.fixed);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)_20rem]">
      {/* ── Left: the section list ── */}
      {/*
        Named. Two unlabelled asides are two `complementary` landmarks a screen
        reader cannot tell apart, which is the whole reason the rule exists.
      */}
      <aside
        aria-label={t("builder.sections")}
        className="min-h-0 overflow-auto border-e border-line bg-card p-3"
      >
        <h2 className="font-mono text-eyebrow uppercase text-muted">{t("builder.sections")}</h2>

        <ul className="mt-2 flex flex-col gap-1">
          {sections.map((section) => {
            const movableIndex = movable.findIndex((candidate) => candidate.id === section.id);
            return (
              <li key={section.id}>
                <div
                  className={
                    section.id === selectedId
                      ? "flex items-center gap-2 rounded-chip border border-moss bg-moss-wash px-2 py-1.5"
                      : "flex items-center gap-2 rounded-chip border border-transparent px-2 py-1.5 hover:bg-paper-sunk"
                  }
                >
                  {/*
                    A checkbox, not a switch, and disabled on the header. The
                    database refuses a disabled fixed section too — criterion 6
                    holds whether or not this control is rendered.
                  */}
                  <Checkbox
                    checked={pendingEnabled[section.id] ?? section.enabled}
                    disabled={section.fixed || pending || !ready}
                    label=""
                    aria-label={t("builder.enabled", { section: section.typeLabel })}
                    onChange={(event) => {
                      const next = event.target.checked;
                      setPendingEnabled((current) => ({ ...current, [section.id]: next }));
                      send(actions.toggleSection, {
                        sectionId: section.id,
                        enabled: next ? "on" : "off",
                      });
                    }}
                  />

                  <button
                    type="button"
                    onClick={() => setSelectedId(section.id)}
                    className="min-w-0 flex-1 rounded-tag text-start text-caption text-ink focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {section.typeLabel}
                  </button>

                  {section.fixed ? (
                    <span className="font-mono text-eyebrow uppercase text-faint">
                      {t("builder.fixed")}
                    </span>
                  ) : (
                    <span className="flex shrink-0 gap-0.5">
                      {/*
                        Buttons rather than a drag handle. The board draws drag
                        to reorder and this is the same operation with a
                        keyboard: a drag-only list is a list somebody using a
                        keyboard cannot reorder at all, and the ordering is the
                        whole feature.
                      */}
                      <IconButton
                        label={t("builder.move_up", { section: section.typeLabel })}
                        size="sm"
                        icon={<span aria-hidden="true">↑</span>}
                        disabled={pending || !ready || movableIndex <= 0}
                        onClick={() => move(movableIndex, -1)}
                      />
                      <IconButton
                        label={t("builder.move_down", { section: section.typeLabel })}
                        size="sm"
                        icon={<span aria-hidden="true">↓</span>}
                        disabled={pending || !ready || movableIndex >= movable.length - 1}
                        onClick={() => move(movableIndex, 1)}
                      />
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {addable.length > 0 && (
          <div className="mt-4">
            <h2 className="font-mono text-eyebrow uppercase text-muted">
              {t("builder.add_section")}
            </h2>
            {/*
              Named, because the section rows above carry buttons whose
              accessible names contain the same words — "Move Hero banner up".
              A list somebody can address by name is a list a test can address
              by name, and both are the same requirement.
            */}
            <ul aria-label={t("builder.add_section")} className="mt-2 flex flex-wrap gap-1">
              {addable.map((type) => (
                <li key={type.key}>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending || !ready}
                    onClick={() => send(actions.addToTemplate, { type: type.key })}
                  >
                    {type.label}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      {/* ── Centre: the canvas ── */}
      <div className="min-h-0 overflow-auto bg-paper-sunk p-6">
        {result && (
          <div className="mb-4">
            <Alert tone={result.ok ? "ok" : "bad"} live="assertive">
              {result.ok ? (result.message ?? "") : result.error}
            </Alert>
          </div>
        )}

        <p className="mb-3 font-mono text-eyebrow uppercase text-faint">
          {t("builder.canvas_note")}
        </p>

        {/*
          `data-theme` on a storefront root only. The console must never take a
          seller theme, so it stops here rather than at the shell.
        */}
        <div className="mx-auto max-w-4xl rounded-card border border-line bg-paper p-6">
          {canvas}
        </div>
      </div>

      {/* ── Right: settings for the selected section, and publish ── */}
      <aside
        aria-label={t("builder.settings")}
        className="min-h-0 overflow-auto border-s border-line bg-card p-3"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="builder-reason" className="font-mono text-eyebrow uppercase text-muted">
            {t("builder.reason_label")}
          </label>
          <Textarea
            id="builder-reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-caption text-faint">{t("builder.reason_hint")}</p>
        </div>

        <div className="mt-4">
          <h2 className="font-mono text-eyebrow uppercase text-muted">{t("builder.settings")}</h2>
          {!selected ? (
            <p className="mt-2 text-caption text-muted">{t("builder.settings_empty")}</p>
          ) : (
            <div className="mt-2">
              <p className="text-body-sm text-ink">{selected.typeLabel}</p>
              <p className="mt-1 text-caption text-muted">{selected.sourceLabel}</p>

              <h3 className="mt-4 font-mono text-eyebrow uppercase text-muted">
                {t("builder.seller_fields")}
              </h3>
              {selected.availableFields.length === 0 ? (
                <p className="mt-1 max-w-prose text-caption text-muted">
                  {t("builder.seller_fields_none")}
                </p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1">
                  {selected.availableFields.map((field) => (
                    <li key={field.key}>
                      <Checkbox
                        checked={selected.sellerEditableFields.includes(field.key)}
                        disabled={pending || !ready}
                        label={field.label}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...selected.sellerEditableFields, field.key]
                            : selected.sellerEditableFields.filter((key) => key !== field.key);
                          send(actions.setFields, {
                            sectionId: selected.id,
                            fields: next.join(","),
                          });
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="mt-6">
          <Panel title={t("builder.unpublished")}>
            {changes.length === 0 ? (
              <p className="text-caption text-muted">{t("builder.no_changes_body")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {changes.map((change, index) => (
                  <li
                    key={`${change.labelKey}-${index}`}
                    className={change.destructive ? "text-caption text-bad-ink" : "text-caption text-body"}
                  >
                    {t(change.labelKey as never, change.values)}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="mt-3">
            <Button
              disabled={changes.length === 0 || pending}
              onClick={() => setConfirming(true)}
            >
              {changes.length === 0 ? t("builder.no_changes") : t("builder.publish_review")}
            </Button>
          </div>
        </div>
      </aside>

      {/* ── Step two: the confirm, which names the count ── */}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("builder.confirm_title", { count: formatCount(storeCount) })}
        closeLabel={t("builder.cancel")}
      >
        <p className="max-w-prose text-body-sm text-prose">
          {t("builder.confirm_body", { sector: sectorName })}
        </p>

        {destructive.length > 0 && (
          <div className="mt-3">
            <Alert tone="warn" live="off">
              {t("builder.confirm_destructive", { count: formatCount(destructive.length) })}
            </Alert>
          </div>
        )}

        <ul className="mt-3 flex flex-col gap-1">
          {changes.map((change, index) => (
            <li
              key={`confirm-${change.labelKey}-${index}`}
              className={change.destructive ? "text-caption text-bad-ink" : "text-caption text-body"}
            >
              {change.destructive && <Tag mono size="sm">{t("builder.takes_away")}</Tag>}{" "}
              {t(change.labelKey as never, change.values)}
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-col gap-1">
          <label
            htmlFor="publish-reason"
            className="font-mono text-eyebrow uppercase text-muted"
          >
            {t("builder.publish_reason_label")}
          </label>
          <Textarea
            id="publish-reason"
            rows={2}
            value={publishReason}
            onChange={(event) => setPublishReason(event.target.value)}
          />
          <p className="text-caption text-faint">{t("builder.publish_reason_hint")}</p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={!readyToPublish || pending}
            onClick={() => send(actions.publish, {}, publishReason)}
          >
            {t("builder.confirm", { count: formatCount(storeCount) })}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>
            {t("builder.cancel")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/** The status pill in the ink bar. Exported so the server page can place it. */
export function TemplateStatus({ status }: { status: string }) {
  const tone = status === "live" ? "ok" : status === "draft" ? "warn" : "neutral";
  return <StatusBadge tone={tone}>{t(`builder.status.${status}` as never)}</StatusBadge>;
}
