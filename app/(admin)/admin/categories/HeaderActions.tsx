"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Alert } from "@/components/display";
import { Button, FieldError, Input, Label, Select } from "@/components/primitives";
import { Plus } from "@/components/primitives/icons";
import { formatCount } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import type { MergePreview } from "@/lib/taxonomy/merge";
import { codeProblem, nameProblem, slugify, slugProblem } from "@/lib/taxonomy/rules";
import { createAction, mergeAction, mergePreviewAction } from "./actions";
import { TaxonomyDialog } from "./TaxonomyDialog";

/**
 * Board 4d — the header's two actions: `Merge tool` and `+ Add category`.
 *
 * Both open a dialog that states what the change does before the reason is
 * asked for. The merge figures come from `previewMerge`, the function the merge
 * runs again inside its own transaction, so the dialog and the write agree on
 * what moves and on whether it is refused.
 */

export interface CategoryOptions {
  sectors: { id: string; name: string; listings: number }[];
  groups: { sectorId: string; sector: string; options: { id: string; name: string; listings: number }[] }[];
}

function optionLabel(option: { name: string; listings: number }): string {
  return t("taxonomy.option", { name: option.name, count: formatCount(option.listings) });
}

export function HeaderActions({
  options,
  selectedId,
  canWrite,
  canMerge,
}: {
  options: CategoryOptions;
  selectedId: string | null;
  canWrite: boolean;
  canMerge: boolean;
}) {
  const [merging, setMerging] = useState(false);
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canMerge ? (
        <Button variant="secondary" onClick={() => setMerging(true)}>
          {t("taxonomy.merge.open")}
        </Button>
      ) : null}
      {canWrite ? (
        <Button leadingIcon={<Plus size={14} />} onClick={() => setAdding(true)}>
          {t("taxonomy.add.open")}
        </Button>
      ) : null}

      {canMerge && merging ? (
        <MergeDialog options={options} selectedId={selectedId} onClose={() => setMerging(false)} />
      ) : null}
      {canWrite && adding ? (
        <AddDialog options={options} selectedId={selectedId} onClose={() => setAdding(false)} />
      ) : null}
    </div>
  );
}

/** Sectors first, then each sector's subcategories under its own heading. */
function groupsFor(options: CategoryOptions) {
  return [
    { label: t("taxonomy.merge.group_sectors"), options: options.sectors.map((sector) => ({ value: sector.id, label: optionLabel(sector) })) },
    ...options.groups
      .filter((group) => group.options.length > 0)
      .map((group) => ({
        label: group.sector,
        options: group.options.map((option) => ({ value: option.id, label: optionLabel(option) })),
      })),
  ];
}

function MergeDialog({ options, selectedId, onClose }: { options: CategoryOptions; selectedId: string | null; onClose: () => void }) {
  const router = useRouter();
  const ids = { source: useId(), target: useId() };
  const [sourceId, setSourceId] = useState(selectedId ?? "");
  const [targetId, setTargetId] = useState("");
  const [preview, setPreview] = useState<{ key: string; value: MergePreview | null } | null>(null);
  const key = `${sourceId}>${targetId}`;
  const both = Boolean(sourceId && targetId);

  useEffect(() => {
    if (!sourceId || !targetId) return;
    let live = true;
    void mergePreviewAction(sourceId, targetId).then((value) => {
      if (live) setPreview({ key: `${sourceId}>${targetId}`, value });
    });
    return () => {
      live = false;
    };
  }, [sourceId, targetId]);

  const current = both && preview?.key === key ? preview.value : null;
  const loading = both && preview?.key !== key;
  const groups = groupsFor(options);

  return (
    <TaxonomyDialog
      open
      onClose={onClose}
      size="lg"
      title={t("taxonomy.merge.title")}
      description={t("taxonomy.merge.body")}
      confirmLabel={
        current && !current.refusal
          ? t("taxonomy.merge.confirm", { count: current.moves.redirects })
          : t("taxonomy.merge.confirm_pending")
      }
      destructive
      ready={Boolean(current && !current.refusal)}
      onSubmit={async (reason) => {
        const form = new FormData();
        form.set("sourceId", sourceId);
        form.set("targetId", targetId);
        form.set("reason", reason);
        return mergeAction(form);
      }}
      onDone={() => {
        onClose();
        router.push(`/admin/categories?c=${encodeURIComponent(targetId)}`);
        router.refresh();
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.source} requirement="required" requirementLabel={t("field.required")} hint={t("taxonomy.merge.source_hint")}>
            {t("taxonomy.merge.source")}
          </Label>
          <Select
            id={ids.source}
            placeholder={t("taxonomy.merge.choose")}
            options={[]}
            groups={groups}
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.target} requirement="required" requirementLabel={t("field.required")} hint={t("taxonomy.merge.target_hint")}>
            {t("taxonomy.merge.target")}
          </Label>
          <Select
            id={ids.target}
            placeholder={t("taxonomy.merge.choose")}
            options={[]}
            groups={groups}
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
          />
        </div>
      </div>

      <div aria-live="polite" className="flex flex-col gap-3">
        {loading ? <p className="text-caption text-body">{t("taxonomy.merge.counting")}</p> : null}
        {current?.refusal ? (
          <Alert tone="warn">
            {t(`taxonomy.merge.refusal.${current.refusal.error}` as MessageKey, { name: current.refusal.name ?? "" })}
          </Alert>
        ) : null}
        {current && !current.refusal ? <MergeFigures preview={current} /> : null}
      </div>
    </TaxonomyDialog>
  );
}

/** What the confirmation states. Every line a count from `previewMerge`; a zero line is left out rather than drawn at zero. */
export function MergeFigures({ preview }: { preview: MergePreview }) {
  const moves = preview.moves;
  const lines: { key: MessageKey; count: number }[] = [
    { key: "taxonomy.merge.moves.listings", count: moves.listings },
    { key: "taxonomy.merge.moves.unlisted", count: moves.unlistedListings },
    { key: "taxonomy.merge.moves.second", count: moves.secondCategoryLinks },
    { key: "taxonomy.merge.moves.products", count: moves.products },
    { key: "taxonomy.merge.moves.services", count: moves.services },
    { key: "taxonomy.merge.moves.subcategories", count: moves.subcategories },
    { key: "taxonomy.merge.moves.area_pages", count: moves.areaPages },
    { key: "taxonomy.merge.moves.emirate_pages", count: moves.emiratePages },
    { key: "taxonomy.merge.moves.pages_kept", count: moves.pagesKept },
    { key: "taxonomy.merge.moves.redirects", count: moves.redirects },
  ];
  return (
    <div className="rounded-ctl bg-paper-sunk px-4 py-3">
      <p className="text-body-sm text-ink">
        {t("taxonomy.merge.summary", { source: preview.source.name, target: preview.target.name })}
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {lines
          .filter((line) => line.count > 0)
          .map((line) => (
            <li key={line.key} className="text-body-sm text-body">
              {t(line.key, { count: line.count, n: formatCount(line.count) })}
            </li>
          ))}
        {moves.synonymsAdded.length > 0 ? (
          <li className="text-body-sm text-body">
            {t("taxonomy.merge.moves.synonyms", { terms: moves.synonymsAdded.join(", "), count: moves.synonymsAdded.length })}
          </li>
        ) : null}
      </ul>
      <p className="mt-2 text-caption text-body">
        {preview.targetTemplate
          ? t("taxonomy.merge.template", { name: preview.targetTemplate.name, version: preview.targetTemplate.version })
          : t("taxonomy.merge.template_none")}
      </p>
    </div>
  );
}

function AddDialog({ options, selectedId, onClose }: { options: CategoryOptions; selectedId: string | null; onClose: () => void }) {
  const router = useRouter();
  const ids = { parent: useId(), name: useId(), slug: useId(), code: useId() };
  // Opened from a sector or one of its subcategories, the new row goes under that sector.
  const preselected =
    options.sectors.find((sector) => sector.id === selectedId)?.id ??
    options.groups.find((group) => group.options.some((option) => option.id === selectedId))?.sectorId ??
    "";
  const [parentId, setParentId] = useState(preselected);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [code, setCode] = useState("");
  const [touched, setTouched] = useState({ name: false, slug: false, code: false });

  const effectiveSlug = slugTouched ? slug : slugify(name);
  const problems = {
    name: nameProblem(name),
    slug: slugProblem(effectiveSlug),
    code: codeProblem(code),
  };
  const ready = !problems.name && !problems.slug && !problems.code;

  return (
    <TaxonomyDialog
      open
      onClose={onClose}
      title={t("taxonomy.add.title")}
      description={t(parentId ? "taxonomy.add.body_subcategory" : "taxonomy.add.body_sector")}
      confirmLabel={t(parentId ? "taxonomy.add.confirm_subcategory" : "taxonomy.add.confirm_sector")}
      ready={ready}
      onSubmit={async (reason) => {
        const form = new FormData();
        form.set("parentId", parentId);
        form.set("name", name);
        form.set("slug", effectiveSlug);
        form.set("code", code);
        form.set("reason", reason);
        const outcome = await createAction(form);
        if (outcome.ok) router.push(`/admin/categories?c=${encodeURIComponent(outcome.id)}`);
        return outcome;
      }}
      onDone={() => {
        onClose();
        router.refresh();
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor={ids.parent} hint={t("taxonomy.add.parent_hint")}>
          {t("taxonomy.add.parent")}
        </Label>
        <Select
          id={ids.parent}
          options={[
            { value: "", label: t("taxonomy.add.parent_none") },
            ...options.sectors.map((sector) => ({ value: sector.id, label: sector.name })),
          ]}
          value={parentId}
          onChange={(event) => setParentId(event.target.value)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.name} requirement="required" requirementLabel={t("field.required")}>
            {t("taxonomy.editor.name")}
          </Label>
          <Input
            id={ids.name}
            value={name}
            invalid={touched.name && Boolean(problems.name)}
            aria-describedby={`${ids.name}-error`}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => setTouched((current) => ({ ...current, name: true }))}
          />
          <FieldError id={`${ids.name}-error`} reserveSpace={false}>
            {touched.name && problems.name ? t(`taxonomy.problem.${problems.name}` as MessageKey) : null}
          </FieldError>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.code} requirement="required" requirementLabel={t("field.required")} hint={t("taxonomy.editor.code_hint")}>
            {t("taxonomy.editor.code")}
          </Label>
          <Input
            id={ids.code}
            mono
            maxLength={2}
            value={code}
            invalid={touched.code && Boolean(problems.code)}
            aria-describedby={`${ids.code}-error`}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            onBlur={() => setTouched((current) => ({ ...current, code: true }))}
          />
          <FieldError id={`${ids.code}-error`} reserveSpace={false}>
            {touched.code && problems.code ? t(`taxonomy.problem.${problems.code}` as MessageKey) : null}
          </FieldError>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor={ids.slug} requirement="required" requirementLabel={t("field.required")} hint={t("taxonomy.slug.hint")}>
          {t("taxonomy.editor.slug")}
        </Label>
        <Input
          id={ids.slug}
          mono
          value={effectiveSlug}
          invalid={(touched.slug || slugTouched || name.length > 0) && Boolean(problems.slug)}
          aria-describedby={`${ids.slug}-error`}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(event.target.value);
          }}
          onBlur={() => setTouched((current) => ({ ...current, slug: true }))}
        />
        <FieldError id={`${ids.slug}-error`} reserveSpace={false}>
          {(touched.slug || slugTouched) && problems.slug ? t(`taxonomy.problem.${problems.slug}` as MessageKey) : null}
        </FieldError>
      </div>
    </TaxonomyDialog>
  );
}
