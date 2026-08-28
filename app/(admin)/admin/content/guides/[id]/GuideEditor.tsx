"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/display";
import { Button, IconButton, Input, Label, Select, Textarea } from "@/components/primitives";
import { ChevronDown, ChevronUp } from "@/components/primitives/icons";
import { Panel } from "@/components/structure";
import {
  GUIDE_BLOCK_SPECS,
  GUIDE_MIN_WORDS,
  guideWords,
  type GuideBlock,
  type GuideBlockKind,
} from "@/lib/guides/blocks";
import { t } from "@/lib/i18n";
import type { ActionResult } from "../actions";

/**
 * Boards 10b and 6d — the guide editor.
 *
 * The word count is live and to the left of the publish button, because it is
 * the one number that decides whether the button works. A writer who finds out
 * at 240 words that the floor is 250 has written the article twice.
 */

const MIN_REASON = 4;

export interface GuideEditorProps {
  id: string | null;
  slug: string;
  title: string;
  summary: string;
  byline: string;
  ctaCategoryId: string;
  blocks: GuideBlock[];
  publishedAt: string | null;
  categories: readonly { id: string; name: string }[];
  save: (formData: FormData) => Promise<ActionResult>;
  publish: (formData: FormData) => Promise<ActionResult>;
  unpublish: (formData: FormData) => Promise<ActionResult>;
  remove: (formData: FormData) => Promise<ActionResult>;
}

let counter = 0;
function nextId() {
  counter += 1;
  return `b${Date.now().toString(36)}${counter}`;
}

function emptyBlock(kind: GuideBlockKind): GuideBlock {
  return { id: nextId(), kind, values: {} };
}

export function GuideEditor(props: GuideEditorProps) {
  const router = useRouter();
  /*
     The id of the guide being edited, which `new` does not have until the first
     save. Held in state rather than read from the route so that creating one
     does not navigate: a `router.replace` here remounts the editor, and the
     "Saved." line disappears before anybody has read it.
  */
  const [id, setId] = useState(props.id);
  /*
     Held here as well as on the row, because publish and unpublish change what
     the editor offers — the address field locks, and the button swaps. Reading
     it back off the server would mean a refresh, and a refresh remounts.
  */
  const [publishedAt, setPublishedAt] = useState(props.publishedAt);
  const [slug, setSlug] = useState(props.slug);
  const [title, setTitle] = useState(props.title);
  const [summary, setSummary] = useState(props.summary);
  const [byline, setByline] = useState(props.byline);
  const [ctaCategoryId, setCta] = useState(props.ctaCategoryId);
  const [blocks, setBlocks] = useState<GuideBlock[]>(props.blocks);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  /*
     A plain flag, not `useTransition`.

     Updates made inside `startTransition(async () => …)` are deferred, and
     under load the deferred `setReason("")` from a finished save landed after
     somebody had already typed the next reason — wiping it, and disabling every
     button on the panel with no visible cause. A save is a request with a
     spinner, not a transition.
  */
  const [pending, setPending] = useState(false);

  const published = publishedAt !== null;
  const words = useMemo(() => guideWords(blocks), [blocks]);
  const short = Math.max(0, GUIDE_MIN_WORDS - words);
  const ready = reason.trim().length >= MIN_REASON;

  function setValue(id: string, key: string, value: string | string[]) {
    setBlocks((current) =>
      current.map((block) =>
        block.id === id ? { ...block, values: { ...block.values, [key]: value } } : block,
      ),
    );
  }

  function move(index: number, delta: number) {
    setBlocks((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      const a = next[index];
      const b = next[target];
      if (!a || !b) return current;
      next[index] = b;
      next[target] = a;
      return next;
    });
  }

  /**
   * Run one action and settle the editor from its result.
   *
   * Deliberately no `router.refresh()`. Everything the editor shows after a
   * mutation is already known here, and a refresh remounts the component —
   * which throws away the reason somebody has just typed and the confirmation
   * they have not read yet. The server action revalidates the list and the
   * public routes, which is where fresh data is actually needed.
   */
  function send(
    action: (formData: FormData) => Promise<ActionResult>,
    settle?: (outcome: ActionResult & { ok: true }) => void,
  ) {
    const form = new FormData();
    form.set("id", id ?? "");
    form.set("slug", slug);
    form.set("title", title);
    form.set("summary", summary);
    form.set("byline", byline);
    form.set("ctaCategoryId", ctaCategoryId);
    form.set("blocks", JSON.stringify(blocks));
    form.set("reason", reason);

    void (async () => {
      setPending(true);
      try {
        const outcome = await action(form);
        setResult(outcome);
        if (!outcome.ok) return;
        setReason("");
        if (!id && outcome.id) {
          setId(outcome.id);
          // `history.replaceState`, not `router.replace`: the address should be
          // the guide's own so a reload lands on it, and a Next navigation here
          // would throw the confirmation away with the remount.
          window.history.replaceState(null, "", `/admin/content/guides/${outcome.id}`);
        }
        settle?.(outcome);
      } finally {
        setPending(false);
      }
    })();
  }

  return (
    <div className="flex flex-col gap-[var(--gutter)]">
      {result && (
        <Alert tone={result.ok ? "ok" : "bad"}>
          {result.ok ? result.message : result.error}
        </Alert>
      )}

      <Panel title={t("guide_admin.panel.details")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="guide-title">{t("guide_admin.field.title")}</Label>
            <Input
              id="guide-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="guide-slug">{t("guide_admin.field.slug")}</Label>
            <Input
              id="guide-slug"
              value={slug}
              mono
              // Frozen once published. The service refuses the change as well;
              // this is so a writer is not typing into a field that will be
              // rejected on save.
              disabled={published}
              onChange={(event) => setSlug(event.target.value)}
            />
            <p className="mt-1 text-caption text-muted">{t("guide_admin.field.slug_hint")}</p>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="guide-summary">{t("guide_admin.field.summary")}</Label>
            <Textarea
              id="guide-summary"
              rows={2}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
            <p className="mt-1 text-caption text-muted">{t("guide_admin.field.summary_hint")}</p>
          </div>
          <div>
            <Label htmlFor="guide-byline">{t("guide_admin.field.byline")}</Label>
            <Input
              id="guide-byline"
              value={byline}
              onChange={(event) => setByline(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="guide-cta">{t("guide_admin.field.cta")}</Label>
            <Select
              id="guide-cta"
              value={ctaCategoryId}
              onChange={(event) => setCta(event.target.value)}
              options={[
                { value: "", label: t("guide_admin.field.cta_none") },
                ...props.categories.map((category) => ({
                  value: category.id,
                  label: category.name,
                })),
              ]}
            />
          </div>
        </div>
      </Panel>

      <Panel
        title={t("guide_admin.panel.body")}
        actions={
          <span className="text-caption text-muted">
            {t("guide_admin.words", { words, need: GUIDE_MIN_WORDS })}
            {short > 0 ? ` · ${t("guide_admin.words_short", { short })}` : ""}
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          {blocks.map((block, index) => {
            const spec = GUIDE_BLOCK_SPECS.find((candidate) => candidate.kind === block.kind);
            if (!spec) return null;
            const kindLabel = t(spec.labelKey as never);

            return (
              <fieldset key={block.id} className="rounded-card border border-line p-4">
                <legend className="px-1 font-mono text-eyebrow uppercase text-muted">
                  {kindLabel}
                </legend>

                <div className="flex flex-col gap-3">
                  {spec.fields.map((field) => {
                    const inputId = `${block.id}-${field.key}`;
                    const value = block.values[field.key];

                    if (field.type === "items") {
                      const items = Array.isArray(value) ? (value as string[]) : [];
                      return (
                        <div key={field.key}>
                          <Label htmlFor={inputId}>{t("guide_admin.block_items")}</Label>
                          <Textarea
                            id={inputId}
                            rows={4}
                            value={items.join("\n")}
                            onChange={(event) =>
                              setValue(
                                block.id,
                                field.key,
                                event.target.value.split("\n").filter((line) => line.trim() !== ""),
                              )
                            }
                          />
                        </div>
                      );
                    }

                    const text = typeof value === "string" ? value : "";
                    return (
                      <div key={field.key}>
                        <Label htmlFor={inputId}>{kindLabel}</Label>
                        {field.type === "text" ? (
                          <Textarea
                            id={inputId}
                            rows={5}
                            value={text}
                            onChange={(event) => setValue(block.id, field.key, event.target.value)}
                          />
                        ) : (
                          <Input
                            id={inputId}
                            value={text}
                            onChange={(event) => setValue(block.id, field.key, event.target.value)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 flex gap-2">
                  <IconButton
                    label={t("guide_admin.move_up", { kind: kindLabel })}
                    icon={<ChevronUp />}
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                  />
                  <IconButton
                    label={t("guide_admin.move_down", { kind: kindLabel })}
                    icon={<ChevronDown />}
                    onClick={() => move(index, 1)}
                    disabled={index === blocks.length - 1}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setBlocks((current) => current.filter((entry) => entry.id !== block.id))
                    }
                  >
                    {t("guide_admin.remove_block", { kind: kindLabel })}
                  </Button>
                </div>
              </fieldset>
            );
          })}

          <div className="flex flex-wrap gap-2">
            {GUIDE_BLOCK_SPECS.map((spec) => (
              <Button
                key={spec.kind}
                variant="secondary"
                size="sm"
                onClick={() => setBlocks((current) => [...current, emptyBlock(spec.kind)])}
              >
                {t("guide_admin.add_block")} · {t(spec.labelKey as never)}
              </Button>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title={t("guide_admin.panel.commit")}>
        <Label htmlFor="guide-reason">{t("guide_admin.field.reason")}</Label>
        <Textarea
          id="guide-reason"
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <p className="mt-1 text-caption text-muted">{t("guide_admin.field.reason_hint")}</p>

        <div className="mt-4 flex flex-wrap gap-3">
          <Button onClick={() => send(props.save)} disabled={!ready || pending}>
            {t("guide_admin.save")}
          </Button>
          {published ? (
            <Button
              variant="secondary"
              onClick={() => send(props.unpublish, () => setPublishedAt(null))}
              disabled={!ready || pending || !id}
            >
              {t("guide_admin.unpublish")}
            </Button>
          ) : (
            <Button
              variant="secondary"
              // The date is not shown here, so any truthy stamp settles the
              // editor into its published shape; the row carries the real one.
              onClick={() => send(props.publish, () => setPublishedAt(new Date().toISOString()))}
              // Disabled below the floor, and the count beside it says by how
              // much. The service refuses it too — this is the courtesy, not
              // the enforcement.
              disabled={!ready || pending || !id || words < GUIDE_MIN_WORDS}
            >
              {t("guide_admin.publish")}
            </Button>
          )}
          <Button
            variant="ghost"
            // The guide is gone, so the editor has nothing left to edit.
            onClick={() => send(props.remove, () => router.push("/admin/content/guides"))}
            disabled={!ready || pending || !id || published}
          >
            {t("guide_admin.delete")}
          </Button>
        </div>
      </Panel>
    </div>
  );
}
