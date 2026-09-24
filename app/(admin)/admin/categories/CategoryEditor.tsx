"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, FieldError, Input, Label, Select, Textarea } from "@/components/primitives";
import { Close, Plus } from "@/components/primitives/icons";
import { cn } from "@/lib/cn";
import { formatCount, formatDate } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import type { CategoryEditor as EditorData } from "@/lib/taxonomy/board";
import {
  codeProblem,
  nameProblem,
  normaliseSynonyms,
  sameSynonyms,
  slugProblem,
  SYNONYM_MAX,
} from "@/lib/taxonomy/rules";
import { previewRenameAction, removeAction, renameAction, saveDetailsAction } from "./actions";
import { reasonReady, TaxonomyDialog } from "./TaxonomyDialog";

/**
 * Board 4d — the category editor.
 *
 * Display name, address, two-letter code, the spec template offered first, and
 * the synonyms buyers are routed by. These apply on Save, with one reason for
 * the whole change (§02: a checkbox-like edit applies on save; the switches in
 * the visibility panel beside this one apply immediately and are a different
 * section). The address is not a text field: changing it writes a redirect for
 * every page that carries it, so it has its own confirmation (`B7`).
 *
 * The field rules are `lib/taxonomy/rules.ts`, the functions the save runs, so a
 * problem is a line under the field before the round trip rather than a
 * refusal after it.
 */

interface Basis {
  name: string;
  code: string;
  synonyms: string[];
  defaultTemplateId: string | null;
}

const basisOf = (editor: EditorData): Basis => ({
  name: editor.name,
  code: editor.code,
  synonyms: editor.synonyms,
  defaultTemplateId: editor.defaultTemplateId,
});

const keyOf = (basis: Basis) => JSON.stringify(basis);

/** Terms from a paste or a typed line: commas, Arabic commas and new lines separate them. */
function splitTerms(value: string): string[] {
  return value.split(/[,،\n]/).map((term) => term.trim()).filter(Boolean);
}

export function CategoryEditor({
  editor,
  canWrite,
  landmark = true,
}: {
  editor: EditorData;
  canWrite: boolean;
  /** Off in the gallery, where several specimens would each claim a region. */
  landmark?: boolean;
}) {
  const router = useRouter();
  const ids = { name: useId(), slug: useId(), code: useId(), template: useId(), synonym: useId(), reason: useId() };

  const basis = basisOf(editor);
  const [seen, setSeen] = useState(keyOf(basis));
  const [name, setName] = useState(basis.name);
  const [code, setCode] = useState(basis.code);
  const [synonyms, setSynonyms] = useState<string[]>(basis.synonyms);
  const [templateId, setTemplateId] = useState<string | null>(basis.defaultTemplateId);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [slugOpen, setSlugOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);
  const Frame = landmark ? "section" : "div";

  /*
     The saved record moved under the form — this person's own save coming back
     through a refresh, or somebody else's. Re-seed from it rather than keep
     showing values that are no longer the record. Adjusted during render, so
     the form never paints a frame of the old record.
  */
  if (seen !== keyOf(basis)) {
    setSeen(keyOf(basis));
    setName(basis.name);
    setCode(basis.code);
    setSynonyms(basis.synonyms);
    setTemplateId(basis.defaultTemplateId);
  }

  useEffect(() => {
    if (adding) addRef.current?.focus();
  }, [adding]);

  const normalised = normaliseSynonyms(synonyms);
  const problems = {
    name: nameProblem(name),
    code: codeProblem(code.trim().toUpperCase(), basis.code),
    synonyms: normalised.problem,
  };
  const changes = [
    name.trim() !== basis.name,
    code.trim().toUpperCase() !== basis.code,
    !sameSynonyms(normalised.value, basis.synonyms),
    templateId !== basis.defaultTemplateId,
  ].filter(Boolean).length;
  const dirty = changes > 0;
  const valid = !problems.name && !problems.code && !problems.synonyms;

  function addTerms(raw: string) {
    const terms = splitTerms(raw);
    if (terms.length) setSynonyms((current) => normaliseSynonyms([...current, ...terms]).value);
    setDraft("");
  }

  function discard() {
    setName(basis.name);
    setCode(basis.code);
    setSynonyms(basis.synonyms);
    setTemplateId(basis.defaultTemplateId);
    setReason("");
    setReasonError(null);
    setResult(null);
  }

  function save() {
    if (!reasonReady(reason)) {
      setReasonError(t("taxonomy.dialog.reason_short"));
      return;
    }
    const form = new FormData();
    form.set("categoryId", editor.id);
    form.set("basis", JSON.stringify(basis));
    form.set(
      "next",
      JSON.stringify({ name, code: code.trim().toUpperCase(), synonyms: normalised.value, defaultTemplateId: templateId }),
    );
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await saveDetailsAction(form);
      setResult(outcome.ok ? { ok: true, text: outcome.message } : { ok: false, text: outcome.error });
      if (outcome.ok) {
        setReason("");
        router.refresh();
      }
    });
  }

  const address = editor.parent ? `/c/${editor.parent.slug}/${editor.slug}` : `/c/${editor.slug}`;
  const templateOptions = [
    { value: "", label: t("taxonomy.editor.template_none") },
    ...editor.templates.map((template) => ({
      value: template.id,
      label:
        template.status === "live"
          ? t("taxonomy.editor.template_option", { name: template.name, version: template.version })
          : t("taxonomy.editor.template_option_status", {
              name: template.name,
              version: template.version,
              status: t(`taxonomy.editor.template_status.${template.status}` as MessageKey),
            }),
    })),
  ];

  return (
    <Frame aria-labelledby={landmark ? `${ids.name}-heading` : undefined} className="rounded-panel border border-line bg-card">
      <div className="border-b border-line px-5 py-4">
        <h2 id={`${ids.name}-heading`} className="text-h2 text-ink">
          {editor.name}
        </h2>
        <p className="mt-1 font-mono text-eyebrow uppercase tracking-wide text-muted">
          {editor.parent ? `${editor.parent.slug} / ${editor.slug}` : editor.slug}
        </p>
        <p className="mt-1 text-caption text-muted">
          {editor.isSector
            ? t("taxonomy.editor.kind_sector", { count: editor.childCount })
            : t("taxonomy.editor.kind_subcategory", { sector: editor.parent?.name ?? "" })}
          {editor.lastChange
            ? ` · ${t("taxonomy.editor.last_change", { by: editor.lastChange.by, date: formatDate(editor.lastChange.at) })}`
            : ""}
        </p>
      </div>

      <fieldset disabled={!canWrite || pending} className="flex min-w-0 flex-col gap-5 px-5 py-5">
        <legend className="sr-only">{t("taxonomy.editor.legend", { name: editor.name })}</legend>
        {!canWrite ? <p className="text-caption text-body">{t("taxonomy.editor.read_only")}</p> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.name} requirement="required" requirementLabel={t("field.required")}>
              {t("taxonomy.editor.name")}
            </Label>
            <Input
              id={ids.name}
              value={name}
              invalid={Boolean(problems.name)}
              aria-describedby={`${ids.name}-error`}
              onChange={(event) => setName(event.target.value)}
            />
            <FieldError id={`${ids.name}-error`} reserveSpace={false}>
              {problems.name ? t(`taxonomy.problem.${problems.name}` as MessageKey) : null}
            </FieldError>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.slug} hint={t("taxonomy.editor.slug_hint")}>
              {t("taxonomy.editor.slug")}
            </Label>
            <div className="flex gap-2">
              <Input id={ids.slug} value={editor.slug} readOnly mono aria-describedby={`${ids.slug}-address`} />
              {canWrite ? (
                <Button variant="secondary" onClick={() => setSlugOpen(true)} disabled={dirty}>
                  {t("taxonomy.slug.open")}
                </Button>
              ) : null}
            </div>
            <p id={`${ids.slug}-address`} className="font-mono text-caption text-muted">
              {address}
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.code} requirement="required" requirementLabel={t("field.required")} hint={t("taxonomy.editor.code_hint")}>
              {t("taxonomy.editor.code")}
            </Label>
            <Input
              id={ids.code}
              value={code}
              mono
              maxLength={Math.max(2, basis.code.length)}
              invalid={Boolean(problems.code)}
              aria-describedby={`${ids.code}-error`}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
            <FieldError id={`${ids.code}-error`} reserveSpace={false}>
              {problems.code ? t(`taxonomy.problem.${problems.code}` as MessageKey) : null}
            </FieldError>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.template} hint={t("taxonomy.editor.template_hint")}>
              {t("taxonomy.editor.template")}
            </Label>
            <Select
              id={ids.template}
              options={templateOptions}
              value={templateId ?? ""}
              onChange={(event) => setTemplateId(event.target.value || null)}
              aria-describedby={`${ids.template}-resolved`}
            />
            <p id={`${ids.template}-resolved`} className="text-caption text-body">
              {editor.resolvedTemplate
                ? t(`taxonomy.editor.template_resolves.${editor.resolvedTemplate.origin}` as MessageKey, {
                    name: editor.resolvedTemplate.name,
                    version: editor.resolvedTemplate.version,
                    sector: editor.parent?.name ?? "",
                  })
                : null}
            </p>
          </div>
        </div>

        {/* States table: "Category with no spec template — editor shows the gap". */}
        {/*
           The link is the notice's `action`, not a word in its sentence: a
           `warn` Alert owes its fix in the slot component 65 reserves for it,
           and refuses in development without one.
        */}
        {!editor.resolvedTemplate ? (
          <Alert
            tone="warn"
            action={
              <Link href="/admin/spec-library" className="text-body-sm underline underline-offset-2">
                {t("taxonomy.editor.template_gap_link")}
              </Link>
            }
          >
            {t("taxonomy.editor.template_gap")}
          </Alert>
        ) : null}

        {/* Flagged 2: the most consequential field on the record, shown where the record is edited. */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-ctl bg-paper-sunk px-3 py-2">
          <span className="font-mono text-eyebrow uppercase text-muted">{t("taxonomy.editor.trade_kind")}</span>
          <span className="text-body-sm text-ink">
            {t(editor.trade.kind === "services" ? "taxonomy.kind_services" : "taxonomy.kind_goods")}
          </span>
          <span className="text-caption text-body">
            {editor.trade.from === "own"
              ? t("taxonomy.kind_own")
              : editor.trade.from === "inherited"
                ? t("taxonomy.kind_from", { name: editor.trade.ancestorName ?? "" })
                : t("taxonomy.kind_unset")}
            {" · "}
            {t(editor.trade.kind === "services" ? "taxonomy.editor.trade_kind_services" : "taxonomy.editor.trade_kind_goods")}
          </span>
          <Link href="/admin/categories?tab=kind" className="ms-auto text-caption text-moss underline underline-offset-2">
            {t("taxonomy.editor.trade_kind_link")}
          </Link>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-body-sm text-ink">
            <span id={`${ids.synonym}-label`} className="font-medium">
              {t("taxonomy.editor.synonyms")}
            </span>{" "}
            <span className="text-body">· {t("taxonomy.editor.synonyms_hint")}</span>
          </p>

          <ul aria-labelledby={`${ids.synonym}-label`} className="flex flex-wrap gap-2">
            {synonyms.map((term) => (
              <li
                key={term}
                className="inline-flex items-center gap-1 rounded-chip bg-paper-sunk py-1 ps-3 pe-1.5 text-body-sm text-ink"
              >
                <bdi dir="auto">{term}</bdi>
                {canWrite ? (
                  <button
                    type="button"
                    aria-label={t("taxonomy.editor.synonym_remove", { term })}
                    title={t("taxonomy.editor.synonym_remove", { term })}
                    onClick={() => setSynonyms((current) => current.filter((entry) => entry !== term))}
                    className="flex size-5 items-center justify-center rounded-tag text-muted hover:text-ink focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    <Close size={11} />
                  </button>
                ) : null}
              </li>
            ))}
            {canWrite ? (
              <li>
                {adding ? (
                  <span className="inline-flex items-center gap-1">
                    <label htmlFor={ids.synonym} className="sr-only">
                      {t("taxonomy.editor.synonym_add_label")}
                    </label>
                    <input
                      id={ids.synonym}
                      ref={addRef}
                      dir="auto"
                      value={draft}
                      maxLength={SYNONYM_MAX * 4}
                      onChange={(event) => setDraft(event.target.value)}
                      onPaste={(event) => {
                        const pasted = event.clipboardData.getData("text");
                        if (/[,،\n]/.test(pasted)) {
                          event.preventDefault();
                          addTerms(`${draft}${pasted}`);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === ",") {
                          event.preventDefault();
                          addTerms(draft);
                        } else if (event.key === "Escape") {
                          setDraft("");
                          setAdding(false);
                        }
                      }}
                      onBlur={() => {
                        addTerms(draft);
                        setAdding(false);
                      }}
                      className="h-8 w-44 rounded-chip border-[1.5px] border-dashed border-line-strong bg-card px-3 text-body-sm text-ink focus-visible:outline-none focus-visible:shadow-focus"
                    />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="inline-flex h-8 items-center gap-1 rounded-chip border-[1.5px] border-dashed border-line-strong px-3 text-body-sm text-body hover:border-moss hover:text-moss focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    <Plus size={12} />
                    {t("taxonomy.editor.synonym_add")}
                  </button>
                )}
              </li>
            ) : null}
          </ul>

          {synonyms.length === 0 ? <p className="text-caption text-body">{t("taxonomy.editor.synonyms_empty")}</p> : null}
          <FieldError reserveSpace={false}>
            {problems.synonyms ? t(`taxonomy.problem.${problems.synonyms}` as MessageKey) : null}
          </FieldError>

          {/* Q5: a synonym routes buyers, so where one also routes elsewhere, say where. */}
          {editor.sharedSynonyms.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {editor.sharedSynonyms.map((shared) => (
                <li key={shared.term} className="text-caption text-body">
                  {t("taxonomy.editor.synonym_shared", {
                    term: shared.term,
                    categories: shared.categories.join(", "),
                    count: shared.categories.length,
                  })}
                </li>
              ))}
            </ul>
          ) : null}
          {editor.synonymsChanged ? (
            <p className="text-caption text-muted">
              {t("taxonomy.editor.synonyms_changed", {
                by: editor.synonymsChanged.by,
                date: formatDate(editor.synonymsChanged.at),
              })}
            </p>
          ) : null}
        </div>

        {canWrite && dirty ? (
          <div className="flex flex-col gap-3 rounded-ctl border border-line-strong bg-paper-sunk p-4">
            <p className="text-body-sm text-ink">{t("taxonomy.editor.unsaved", { count: changes })}</p>
            <div className="flex flex-col gap-1">
              <Label htmlFor={ids.reason} requirement="required" requirementLabel={t("field.required")} hint={t("taxonomy.dialog.reason_hint")}>
                {t("taxonomy.dialog.reason")}
              </Label>
              <Textarea
                id={ids.reason}
                rows={2}
                value={reason}
                invalid={reasonError !== null}
                aria-describedby={`${ids.reason}-error`}
                onChange={(event) => {
                  setReason(event.target.value);
                  if (reasonError && reasonReady(event.target.value)) setReasonError(null);
                }}
              />
              <FieldError id={`${ids.reason}-error`}>{reasonError}</FieldError>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={discard}>
                {t("taxonomy.editor.discard")}
              </Button>
              <Button onClick={save} loading={pending} disabled={!valid || pending}>
                {t("taxonomy.editor.save")}
              </Button>
            </div>
          </div>
        ) : null}

        {result ? (
          <Alert tone={result.ok ? "ok" : "bad"} live={result.ok ? "polite" : "assertive"}>
            {result.text}
          </Alert>
        ) : null}
      </fieldset>

      {canWrite ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
          <p className="text-caption text-muted">{t("taxonomy.remove.hint")}</p>
          <Button variant="ghost" size="sm" onClick={() => setRemoveOpen(true)}>
            {t("taxonomy.remove.open")}
          </Button>
        </div>
      ) : null}

      {canWrite ? (
        <>
          <SlugDialog
            key={`slug-${editor.id}-${editor.slug}`}
            open={slugOpen}
            onClose={() => setSlugOpen(false)}
            editor={editor}
            onDone={(message) => {
              setSlugOpen(false);
              setResult({ ok: true, text: message });
              router.refresh();
            }}
          />
          <TaxonomyDialog
            open={removeOpen}
            onClose={() => setRemoveOpen(false)}
            title={t("taxonomy.remove.title", { name: editor.name })}
            description={
              editor.parent
                ? t("taxonomy.remove.body_subcategory", { sector: editor.parent.name })
                : t("taxonomy.remove.body_sector")
            }
            confirmLabel={t("taxonomy.remove.confirm")}
            destructive
            size="sm"
            onSubmit={async (why) => {
              const form = new FormData();
              form.set("categoryId", editor.id);
              form.set("reason", why);
              return removeAction(form);
            }}
            onDone={() => {
              setRemoveOpen(false);
              router.push(editor.parent ? `/admin/categories?c=${editor.parent.id}` : "/admin/categories");
              router.refresh();
            }}
          />
        </>
      ) : null}
    </Frame>
  );
}

/** `B7`: a new address, the number of redirects it writes, and a reason. */
function SlugDialog({
  open,
  onClose,
  editor,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  editor: EditorData;
  onDone: (message: string) => void;
}) {
  const inputId = useId();
  const [slug, setSlug] = useState(editor.slug);
  const [moves, setMoves] = useState<{ slug: string; count: number } | null>(null);
  const next = slug.trim().toLowerCase();
  const problem = next === editor.slug ? null : slugProblem(next);
  const changed = next !== editor.slug && !problem;

  useEffect(() => {
    if (!open || !changed) return;
    let live = true;
    const timer = setTimeout(async () => {
      const count = await previewRenameAction(editor.id, next);
      if (live) setMoves({ slug: next, count });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, changed, editor.id, next]);

  const count = moves?.slug === next ? moves.count : null;
  const from = editor.parent ? `/c/${editor.parent.slug}/${editor.slug}` : `/c/${editor.slug}`;
  const to = editor.parent ? `/c/${editor.parent.slug}/${next}` : `/c/${next}`;

  return (
    <TaxonomyDialog
      open={open}
      onClose={onClose}
      title={t("taxonomy.slug.title", { name: editor.name })}
      description={t(editor.isSector ? "taxonomy.slug.body_sector" : "taxonomy.slug.body_subcategory")}
      confirmLabel={count === null ? t("taxonomy.slug.confirm_pending") : t("taxonomy.slug.confirm", { count })}
      ready={changed && count !== null}
      onSubmit={async (reason) => {
        const form = new FormData();
        form.set("categoryId", editor.id);
        form.set("slug", next);
        form.set("reason", reason);
        return renameAction(form);
      }}
      onDone={onDone}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor={inputId} requirement="required" requirementLabel={t("field.required")} hint={t("taxonomy.slug.hint")}>
          {t("taxonomy.slug.label")}
        </Label>
        <Input
          id={inputId}
          mono
          value={slug}
          invalid={Boolean(problem)}
          aria-describedby={`${inputId}-error ${inputId}-moves`}
          onChange={(event) => setSlug(event.target.value)}
        />
        <FieldError id={`${inputId}-error`} reserveSpace={false}>
          {problem ? t(`taxonomy.problem.${problem}` as MessageKey) : null}
        </FieldError>
      </div>
      <div id={`${inputId}-moves`} aria-live="polite" className={cn("rounded-ctl bg-paper-sunk px-3 py-2", !changed && "hidden")}>
        {changed ? (
          <>
            <p className="font-mono text-caption text-body">
              {from} → {to}
            </p>
            <p className="mt-1 text-caption text-body">
              {count === null ? t("taxonomy.slug.counting") : t("taxonomy.slug.moves", { count, n: formatCount(count) })}
            </p>
          </>
        ) : null}
      </div>
    </TaxonomyDialog>
  );
}
