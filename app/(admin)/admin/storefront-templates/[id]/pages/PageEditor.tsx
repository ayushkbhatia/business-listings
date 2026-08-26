"use client";

import { useMemo, useState, useTransition } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Checkbox, Input, Label, Textarea } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { BLOCK_SPECS, type Block } from "@/lib/storefront/blocks";
import { contentChecks, passedCount } from "@/lib/storefront/content-check";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 5d — the page template editor.
 *
 * Blocks left, the page centre, settings right, and the content check below
 * them. The check runs here as you type using the same pure function the server
 * would: it is advisory, so there is nothing to enforce server-side, and a
 * count that only appears after saving is a count nobody uses.
 *
 * The address field is disabled once the page is live. Criterion 9 makes the
 * slug immutable at publish, and the rename control says what it will do — a
 * disabled field with no explanation is a field somebody files a bug about.
 */

export interface PageRow {
  id: string;
  slug: string;
  title: string;
  metaDescription: string | null;
  blocks: Block[];
  showInNav: boolean;
  allowIndexing: boolean;
  status: string;
}

export interface PageEditorProps {
  templateId: string;
  storeCount: string;
  sectorName: string;
  places: string[];
  pages: PageRow[];
  actions: {
    addPage: (formData: FormData) => Promise<ActionResult>;
    savePage: (formData: FormData) => Promise<ActionResult>;
    goLive: (formData: FormData) => Promise<ActionResult>;
    movePage: (formData: FormData) => Promise<ActionResult>;
  };
}

const MIN_REASON = 4;
const META_LIMIT = 160;

export function PageEditor({
  templateId,
  storeCount,
  sectorName,
  places,
  pages,
  actions,
}: PageEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(pages[0]?.id ?? null);
  const [newSlug, setNewSlug] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [reason, setReason] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = pages.find((page) => page.id === selectedId) ?? null;
  const [draft, setDraft] = useState<PageRow | null>(selected);
  const page = draft?.id === selected?.id ? draft : selected;

  const ready = reason.trim().length >= MIN_REASON;

  const checks = useMemo(
    () => contentChecks({ blocks: page?.blocks ?? [], sectorName, places }),
    [page, sectorName, places],
  );

  function send(action: (formData: FormData) => Promise<ActionResult>, fields: Record<string, string>) {
    const form = new FormData();
    form.set("templateId", templateId);
    form.set("reason", reason);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) setReason("");
    });
  }

  function update(patch: Partial<PageRow>) {
    if (!page) return;
    setDraft({ ...page, ...patch });
  }

  const metaLength = (page?.metaDescription ?? "").length;

  return (
    <div className="grid gap-[var(--gutter)] lg:grid-cols-[16rem_minmax(0,1fr)_20rem]">
      {result && (
        <div className="lg:col-span-3">
          <Alert tone={result.ok ? "ok" : "bad"} live="assertive">
            {result.ok ? (result.message ?? "") : result.error}
          </Alert>
        </div>
      )}

      <aside aria-label={t("pages.title")} className="min-w-0">
        <Panel title={t("pages.title")}>
          {pages.length === 0 ? (
            <p className="text-caption text-muted">{t("pages.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {pages.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(entry.id);
                      setDraft(entry);
                    }}
                    className={
                      entry.id === selectedId
                        ? "flex w-full items-center justify-between gap-2 rounded-chip border border-moss bg-moss-wash px-2 py-1.5 text-start"
                        : "flex w-full items-center justify-between gap-2 rounded-chip border border-transparent px-2 py-1.5 text-start hover:bg-paper-sunk"
                    }
                  >
                    <span className="min-w-0 truncate text-caption text-ink">{entry.title}</span>
                    <StatusBadge tone={entry.status === "live" ? "ok" : "warn"} size="sm">
                      {t(`pages.status.${entry.status}` as never)}
                    </StatusBadge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="mt-3">
          <Panel title={t("pages.add_title")} description={t("pages.add_hint")}>
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="new-title">{t("pages.page_title")}</Label>
                <Input
                  id="new-title"
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="new-slug" hint={t("pages.slug_hint")}>
                  {t("pages.slug")}
                </Label>
                <Input
                  id="new-slug"
                  mono
                  value={newSlug}
                  onChange={(event) => setNewSlug(event.target.value)}
                />
              </div>
              <Button
                disabled={!ready || pending || !newSlug.trim() || !newTitle.trim()}
                onClick={() => send(actions.addPage, { slug: newSlug, title: newTitle })}
              >
                {t("pages.add")}
              </Button>
            </div>
          </Panel>
        </div>
      </aside>

      <div className="min-w-0">
        {page && (
          <Panel title={page.title}>
            <ul className="flex flex-col gap-2">
              {page.blocks.map((block) => (
                <li
                  key={block.id}
                  className="flex items-center justify-between gap-2 rounded-card border border-line bg-card px-3 py-2"
                >
                  <span className="text-caption text-ink">
                    {t(`block.${block.kind}` as never)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      update({ blocks: page.blocks.filter((entry) => entry.id !== block.id) })
                    }
                  >
                    {t("pages.remove_block", { block: t(`block.${block.kind}` as never) })}
                  </Button>
                </li>
              ))}
            </ul>

            {page.blocks.length === 0 && (
              <p className="text-caption text-muted">{t("pages.no_blocks")}</p>
            )}

            <div className="mt-4">
              <h3 className="font-mono text-eyebrow uppercase text-muted">
                {t("pages.add_block")}
              </h3>
              <ul aria-label={t("pages.add_block")} className="mt-2 flex flex-wrap gap-1">
                {BLOCK_SPECS.map((spec) => (
                  <li key={spec.kind}>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() =>
                        update({
                          blocks: [
                            ...page.blocks,
                            {
                              // Stable and unique enough for a list key and for
                              // the diff between saves.
                              id: `${spec.kind}-${page.blocks.length}-${spec.kind.length}`,
                              kind: spec.kind,
                              values: {},
                            },
                          ],
                        })
                      }
                    >
                      {t(spec.labelKey as never)}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
        )}

        <div className="mt-3">
          <Panel title={t("pages.check")} description={t("pages.check_hint")}>
            <p className="font-mono text-eyebrow uppercase text-muted">
              {t("pages.check_summary", { passed: formatCount(passedCount(checks)) })}
            </p>
            <ul aria-label={t("pages.check")} className="mt-2 flex flex-col gap-1">
              {checks.map((entry) => (
                <li
                  key={entry.key}
                  className={entry.passed ? "text-caption text-ok-ink" : "text-caption text-muted"}
                >
                  <span aria-hidden="true">{entry.passed ? "✓" : "·"}</span>{" "}
                  {t(`pages.check.${entry.key}` as never)}
                  {entry.key === "length" && entry.detail && (
                    <> — {t("pages.check.length_detail", { count: entry.detail })}</>
                  )}
                  {entry.key === "local" && entry.detail === "trade" && (
                    <> — {t("pages.check.local_trade")}</>
                  )}
                  {entry.key === "local" && entry.detail === "place" && (
                    <> — {t("pages.check.local_place")}</>
                  )}
                  {entry.key === "image_alt" && entry.detail === "none" && (
                    <> — {t("pages.check.image_alt_none")}</>
                  )}
                  {entry.key === "image_alt" && entry.detail && entry.detail !== "none" && (
                    <> — {t("pages.check.image_alt_some", { detail: entry.detail })}</>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <aside aria-label={t("builder.settings")} className="min-w-0">
        <Panel title={t("builder.settings")}>
          {page ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="page-title">{t("pages.page_title")}</Label>
                <Input
                  id="page-title"
                  value={page.title}
                  onChange={(event) => update({ title: event.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1">
                <Label
                  htmlFor="page-slug"
                  hint={page.status === "live" ? t("pages.rename_locked") : t("pages.slug_hint")}
                >
                  {t("pages.slug")}
                </Label>
                {/*
                  Criterion 9. A live page's address is fixed, and the rename
                  below is the deliberate act that moves it with a 301 per
                  store. A disabled field with no explanation is a field
                  somebody files a bug about.
                */}
                <Input id="page-slug" mono value={page.slug} disabled readOnly />
              </div>

              <div className="flex flex-col gap-1">
                <Label htmlFor="page-meta">{t("pages.meta_description")}</Label>
                <Textarea
                  id="page-meta"
                  rows={3}
                  value={page.metaDescription ?? ""}
                  onChange={(event) => update({ metaDescription: event.target.value })}
                />
                <p
                  className={
                    metaLength > META_LIMIT
                      ? "font-mono text-eyebrow text-bad-ink"
                      : "font-mono text-eyebrow text-faint"
                  }
                >
                  {metaLength > META_LIMIT
                    ? t("pages.meta_over", { count: String(metaLength) })
                    : t("pages.meta_counter", { count: String(metaLength) })}
                </p>
              </div>

              <Checkbox
                checked={page.showInNav}
                label={t("pages.show_in_nav")}
                onChange={(event) => update({ showInNav: event.target.checked })}
              />
              <Checkbox
                checked={page.allowIndexing}
                label={t("pages.allow_indexing")}
                description={t("pages.allow_indexing_hint")}
                onChange={(event) => update({ allowIndexing: event.target.checked })}
              />
            </div>
          ) : (
            <p className="text-caption text-muted">{t("builder.settings_empty")}</p>
          )}
        </Panel>

        <div className="mt-3 flex flex-col gap-1">
          <Label
            htmlFor="pages-reason"
            requirement="required"
            requirementLabel={t("field.required")}
            hint={t("theme.reason_hint", { count: storeCount })}
          >
            {t("builder.reason_label")}
          </Label>
          <Textarea
            id="pages-reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

        {page && (
          <div className="mt-3 flex flex-col gap-2">
            <Button
              disabled={!ready || pending}
              onClick={() =>
                send(actions.savePage, {
                  pageId: page.id,
                  title: page.title,
                  metaDescription: page.metaDescription ?? "",
                  blocks: JSON.stringify(page.blocks),
                  showInNav: page.showInNav ? "on" : "off",
                  allowIndexing: page.allowIndexing ? "on" : "off",
                })
              }
            >
              {t("pages.save")}
            </Button>

            {page.status !== "live" && (
              <Button
                variant="secondary"
                disabled={!ready || pending}
                onClick={() => send(actions.goLive, { pageId: page.id })}
              >
                {t("pages.publish")}
              </Button>
            )}

            <div className="flex flex-col gap-1">
              <Label htmlFor="rename-to" hint={t("pages.rename_locked")}>
                {t("pages.rename")}
              </Label>
              <Input
                id="rename-to"
                mono
                value={renameTo}
                onChange={(event) => setRenameTo(event.target.value)}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={!ready || pending || !renameTo.trim()}
                onClick={() => send(actions.movePage, { pageId: page.id, slug: renameTo })}
              >
                {t("pages.rename")}
              </Button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
