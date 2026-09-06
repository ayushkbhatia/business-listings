"use client";

import { useEffect, useMemo, useState } from "react";
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
  /*
     Board 10b. Six fields board 6d added and left with no form.

     Four of them are what the index prints — the standfirst under the title,
     the shelf, the sequence within it and the review window that decides
     whether a row says "review overdue". Until now the only thing that set any
     of them was `prisma/seed-guides.mts`, which is guide content living in a
     commit: a build, a deploy and a cold cache to change one sentence.
  */
  standfirst: string;
  topic: string;
  bylineRole: string;
  subjectId: string;
  sortOrder: number;
  /** Empty means no window, which is never overdue rather than always. */
  reviewCadenceMonths: string;
  subjects: readonly { id: string; name: string }[];
  save: (formData: FormData) => Promise<ActionResult>;
  publish: (formData: FormData) => Promise<ActionResult>;
  unpublish: (formData: FormData) => Promise<ActionResult>;
  remove: (formData: FormData) => Promise<ActionResult>;
  /** Board 10b §4 — the index's editorial slot. */
  featured: boolean;
  featuredNote: string;
  setFeatured: (formData: FormData) => Promise<ActionResult>;
  /** Board 6d's audited re-check, which had no caller until board 10b. */
  regulatoryCheckedAt: string | null;
  recordCheck: (formData: FormData) => Promise<ActionResult>;
}

/**
 * Where a first save leaves its confirmation for the remount that follows it.
 * See `send` below for why the remount is unavoidable.
 */
const HANDOFF = "guide-editor:saved";

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
  const [standfirst, setStandfirst] = useState(props.standfirst);
  const [topic, setTopic] = useState(props.topic);
  const [bylineRole, setBylineRole] = useState(props.bylineRole);
  const [subjectId, setSubjectId] = useState(props.subjectId);
  const [sortOrder, setSortOrder] = useState(String(props.sortOrder));
  const [cadence, setCadence] = useState(props.reviewCadenceMonths);
  const [featuredNote, setFeaturedNote] = useState(props.featuredNote);
  const [blocks, setBlocks] = useState<GuideBlock[]>(props.blocks);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);

  /*
     Pick up a confirmation left behind by the save that moved us here.

     Read once and cleared, so a later reload of the same guide does not
     announce a save that happened some time ago. Per-tab and never read by the
     server, which is right for a line of text somebody has not finished
     reading yet.
  */
  useEffect(() => {
    try {
      const held = window.sessionStorage.getItem(HANDOFF);
      if (!held) return;
      window.sessionStorage.removeItem(HANDOFF);
      /*
         Genuinely after mount rather than during render. The value lives in
         session storage, which does not exist on the server — reading it in a
         `useState` initialiser would render one thing on the server and
         another on the client, and trade a lint warning for a hydration
         mismatch. One extra render, once, on the way back from a save.
      */
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResult({ ok: true, message: held });
    } catch {
      // Private mode, or storage turned off. The save still happened; the only
      // thing lost is the line saying so.
    }
  }, []);
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
    form.set("standfirst", standfirst);
    form.set("topic", topic);
    form.set("bylineRole", bylineRole);
    form.set("subjectId", subjectId);
    form.set("sortOrder", sortOrder);
    form.set("reviewCadenceMonths", cadence);
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
          /*
             The address should be the guide's own so a reload lands on it.

             This was a bare `replaceState` in the belief that it avoided a
             navigation and so kept the confirmation. It does not: changing
             `[id]` from `new` to a real id changes the dynamic segment, Next
             re-resolves the route, and the editor remounts with `result` gone —
             the save worked and said nothing at all. The shallow case Next
             actually supports is a search-param change on the same segment,
             which this is not.

             The confirmation is handed across the remount in session storage
             rather than in the address. Putting it in the query raced the
             navigation: the effect that tidied the parameter away sometimes ran
             before the router had finished committing, and the router then put
             it back — green alone and red under load, which is the worst of
             both.
          */
          try {
            window.sessionStorage.setItem(HANDOFF, outcome.message);
          } catch {
            // Nothing to do. Losing the line is better than losing the save.
          }
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
            <Label htmlFor="guide-standfirst" hint={t("guide_admin.field.standfirst_hint")}>
              {t("guide_admin.field.standfirst")}
            </Label>
            <Textarea
              id="guide-standfirst"
              rows={2}
              value={standfirst}
              onChange={(event) => setStandfirst(event.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="guide-byline">{t("guide_admin.field.byline")}</Label>
              <Input
                id="guide-byline"
                value={byline}
                onChange={(event) => setByline(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="guide-byline-role">{t("guide_admin.field.byline_role")}</Label>
              <Input
                id="guide-byline-role"
                value={bylineRole}
                onChange={(event) => setBylineRole(event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="guide-subject" hint={t("guide_admin.field.subject_hint")}>
                {t("guide_admin.field.subject")}
              </Label>
              <Select
                id="guide-subject"
                value={subjectId}
                onChange={(event) => setSubjectId(event.target.value)}
                options={[
                  { value: "", label: t("guide_admin.no_subject") },
                  ...props.subjects.map((subject) => ({
                    value: subject.id,
                    label: subject.name,
                  })),
                ]}
              />
            </div>
            <div>
              <Label htmlFor="guide-sort" hint={t("guide_admin.field.sort_order_hint")}>
                {t("guide_admin.field.sort_order")}
              </Label>
              <Input
                id="guide-sort"
                type="number"
                min="0"
                step="1"
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="guide-cadence" hint={t("guide_admin.field.cadence_hint")}>
                {t("guide_admin.field.cadence")}
              </Label>
              <Input
                id="guide-cadence"
                type="number"
                min="1"
                step="1"
                value={cadence}
                onChange={(event) => setCadence(event.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="guide-topic" hint={t("guide_admin.field.topic_hint")}>
              {t("guide_admin.field.topic")}
            </Label>
            <Input
              id="guide-topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
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
        {/*
           Board 10b §4 — the `START HERE` slot.

           Published only, one at a time, and the database refuses a second: a
           unique index over a constant expression filtered to the featured
           rows. Offered here rather than on the list because it is a decision
           about this article, and the reason box below is the one it is
           written into.
        */}
        {publishedAt !== null && (
          <div className="mb-4 rounded-card border border-line bg-card px-4 py-3">
            <p className="text-body-sm text-ink">
              {props.featured ? t("guide_admin.featured_is") : t("guide_admin.featured_not")}
            </p>
            <p className="mt-1 text-caption text-muted">{t("guide_admin.featured_hint")}</p>

            {!props.featured && (
              <div className="mt-3">
                <Label htmlFor="guide-featured-note" hint={t("guide_admin.featured_note_hint")}>
                  {t("guide_admin.featured_note")}
                </Label>
                <Textarea
                  id="guide-featured-note"
                  rows={2}
                  value={featuredNote}
                  onChange={(event) => setFeaturedNote(event.target.value)}
                />
              </div>
            )}

            <div className="mt-2.5" />
            <Button
              variant="secondary"
              size="sm"
              disabled={!ready || pending}
              onClick={() => {
                const form = new FormData();
                form.set("id", props.featured ? "" : (id ?? ""));
                form.set("note", featuredNote);
                form.set("reason", reason);
                void (async () => {
                  setResult(await props.setFeatured(form));
                  router.refresh();
                })();
              }}
            >
              {props.featured ? t("guide_admin.featured_clear") : t("guide_admin.featured_set_cta")}
            </Button>
          </div>
        )}

        {/*
           Board 6d's audited re-check, reachable at last.

           `recordRegulatoryCheck` shipped with 6d and had no caller in `app/`,
           so the date board 10b prints beside every guide on the index could
           only ever be set by the seed. The reader-facing overdue state is only
           defensible if a person can clear it.
        */}
        {publishedAt !== null && id !== null && (
          <div className="mb-4 rounded-card border border-line bg-card px-4 py-3">
            <p className="text-body-sm text-ink">{t("guide_admin.check_title")}</p>
            <p className="mt-1 text-caption text-muted">
              {props.regulatoryCheckedAt
                ? t("guide_admin.check_last", { date: props.regulatoryCheckedAt })
                : t("guide_admin.check_never")}
            </p>
            <p className="mt-1 text-caption text-muted">{t("guide_admin.check_hint")}</p>
            <div className="mt-2.5" />
            <Button
              variant="secondary"
              size="sm"
              disabled={!ready || pending}
              onClick={() => {
                const form = new FormData();
                form.set("id", id);
                form.set("slug", slug);
                form.set("reason", reason);
                void (async () => {
                  setResult(await props.recordCheck(form));
                  router.refresh();
                })();
              }}
            >
              {t("guide_admin.check_cta")}
            </Button>
          </div>
        )}

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
