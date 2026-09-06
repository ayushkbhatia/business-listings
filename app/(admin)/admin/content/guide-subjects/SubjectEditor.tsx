"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, Input, Label, Textarea } from "@/components/primitives";
import { DataTable, Panel, type Column } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ActionResult } from "../guides/actions";

/**
 * Board 10b §3 — the shelves, and the one screen that can change them.
 *
 * The slug is the chip's URL and shares one namespace with every article, so a
 * subject taking a guide's slug is refused by the service before it is written.
 * The form says so rather than letting the refusal be a surprise.
 */

const MIN_REASON = 4;

export interface SubjectRowView {
  id: string;
  slug: string;
  name: string;
  blurb: string;
  sortOrder: number;
  published: string;
}

export function SubjectEditor({
  rows,
  save,
}: {
  rows: readonly SubjectRowView[];
  save: (formData: FormData) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState<SubjectRowView | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [blurb, setBlurb] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = reason.trim().length >= MIN_REASON;

  function edit(row: SubjectRowView | null) {
    setOpen(row ?? { id: "", slug: "", name: "", blurb: "", sortOrder: rows.length, published: "0" });
    setName(row?.name ?? "");
    setSlug(row?.slug ?? "");
    setBlurb(row?.blurb ?? "");
    setSortOrder(String(row?.sortOrder ?? rows.length));
    setReason("");
    setResult(null);
  }

  const columns: Column<SubjectRowView>[] = [
    { key: "name", header: t("subjects.col.name"), render: (row) => row.name },
    { key: "slug", header: t("subjects.col.url"), mono: true, render: (row) => `/guides/${row.slug}` },
    {
      key: "published",
      header: t("subjects.col.published"),
      numeric: true,
      render: (row) => row.published,
    },
    {
      key: "sort",
      header: t("subjects.col.order"),
      numeric: true,
      render: (row) => String(row.sortOrder),
    },
    {
      key: "act",
      header: t("matrix.col.edit"),
      render: (row) => (
        <Button variant="ghost" size="sm" onClick={() => edit(row)}>
          {t("subjects.edit", { name: row.name })}
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[var(--gutter)]">
      {result && (
        <Alert tone={result.ok ? "ok" : "bad"} live="assertive">
          {result.ok ? result.message : result.error}
        </Alert>
      )}

      <div>
        <Button size="sm" onClick={() => edit(null)}>
          {t("subjects.new")}
        </Button>
      </div>

      <DataTable
        caption={t("subjects.caption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        empty={t("subjects.empty")}
      />

      {open && (
        <Panel title={open.id ? open.name : t("subjects.new")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="subject-name">{t("subjects.col.name")}</Label>
              <Input
                id="subject-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="subject-slug" hint={t("subjects.slug_hint")}>
                {t("subjects.col.url")}
              </Label>
              <Input
                id="subject-slug"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
              />
            </div>
          </div>

          <div className="mt-4">
            <Label htmlFor="subject-blurb" hint={t("subjects.blurb_hint")}>
              {t("subjects.blurb")}
            </Label>
            <Textarea
              id="subject-blurb"
              rows={2}
              value={blurb}
              onChange={(event) => setBlurb(event.target.value)}
            />
          </div>

          <div className="mt-4 max-w-[12rem]">
            <Label htmlFor="subject-order">{t("subjects.col.order")}</Label>
            <Input
              id="subject-order"
              type="number"
              min="0"
              step="1"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
            />
          </div>

          <div className="mt-4">
            <Label htmlFor="subject-reason">{t("guide_admin.field.reason")}</Label>
            <Textarea
              id="subject-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              disabled={!ready || pending}
              onClick={() => {
                const form = new FormData();
                form.set("id", open.id);
                form.set("name", name);
                form.set("slug", slug);
                form.set("blurb", blurb);
                form.set("sortOrder", sortOrder);
                form.set("reason", reason);
                startTransition(async () => {
                  const outcome = await save(form);
                  setResult(outcome);
                  if (outcome.ok) setOpen(null);
                });
              }}
            >
              {t("action.save")}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(null)} disabled={pending}>
              {t("action.cancel")}
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
