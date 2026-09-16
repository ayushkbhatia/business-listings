"use client";

import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, Input, Label, Select, Textarea } from "@/components/primitives";
import { Modal } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 12e Q3 — *"Can a plan be added, and what happens to the four rows that
 * already exist?"*
 *
 * Nothing happens to them. A fourth plan implies a fourth column on `11f`'s
 * comparison and a fourth card on `/pricing`, and both of those already render
 * whatever the table holds — so the migration the question feared is a
 * rendering question that was answered before it was asked. What was missing is
 * the part that makes adding one safe: a new plan is **born withdrawn from
 * sale**, so it appears on this screen and nowhere a seller can reach until an
 * ops lead deliberately puts it on sale, as its own audited change.
 *
 * It starts from an existing plan's caps rather than from nothing. A plan
 * created with every cap empty is a plan with unlimited everything, which is
 * the one shape of mistake this console must not make easy — and the plan it
 * was copied from is named on the audit row.
 */

export interface AddPlanProps {
  /** Which plans a new one may copy its caps from. */
  sources: readonly { id: string; name: string }[];
  add: (formData: FormData) => Promise<ActionResult>;
}

const MIN_REASON = 4;

export function AddPlan({ sources, add }: AddPlanProps) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [copyFrom, setCopyFrom] = useState(sources[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const field = useId();

  const ready =
    /^[a-z][a-z0-9-]*$/.test(id.trim()) &&
    name.trim().length > 0 &&
    price.trim() !== "" &&
    Number.isFinite(Number(price)) &&
    copyFrom !== "" &&
    reason.trim().length >= MIN_REASON;

  function submit() {
    const form = new FormData();
    form.set("id", id.trim());
    form.set("name", name.trim());
    form.set("monthlyPriceAed", price.trim());
    form.set("copyFrom", copyFrom);
    form.set("reason", reason);

    startTransition(async () => {
      const outcome = await add(form);
      if (outcome.ok) {
        setOpen(false);
        setId("");
        setName("");
        setPrice("");
        setReason("");
        setError(null);
      } else {
        setError(outcome.error);
      }
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t("admin.plans.add")}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("admin.plans.add_title")}
        description={t("admin.plans.add_body")}
        closeLabel={t("overlay.close")}
        footer={
          <>
            <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
              {t("action.cancel")}
            </Button>
            <Button disabled={!ready || pending} onClick={submit}>
              {t("admin.plans.add_confirm")}
            </Button>
          </>
        }
      >
        {error && (
          <div className="mb-3">
            <Alert tone="bad" live="assertive">
              {error}
            </Alert>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${field}-id`} hint={t("admin.plans.add_id_hint")}>
              {t("admin.plans.add_id")}
            </Label>
            <Input
              id={`${field}-id`}
              mono
              value={id}
              onChange={(event) => setId(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={`${field}-name`} hint={t("admin.plans.add_name_hint")}>
              {t("admin.plans.add_name")}
            </Label>
            <Input
              id={`${field}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={`${field}-price`} hint={t("admin.plans.add_price_hint")}>
              {t("admin.plans.add_price")}
            </Label>
            <Input
              id={`${field}-price`}
              mono
              inputMode="numeric"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={`${field}-copy`} hint={t("admin.plans.add_copy_hint")}>
              {t("admin.plans.add_copy")}
            </Label>
            {/*
               No placeholder option, and one is selected from the first render.

               An empty `Select` posts its first option, so a placeholder that
               is not a real choice is a value somebody saves without reading —
               the defect board `3g` found. Every option here is a real plan.
            */}
            <Select
              id={`${field}-copy`}
              value={copyFrom}
              onChange={(event) => setCopyFrom(event.target.value)}
              options={sources.map((source) => ({ value: source.id, label: source.name }))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label
              htmlFor={`${field}-reason`}
              requirement="required"
              requirementLabel={t("field.required")}
              hint={t("admin.plans.reason_hint")}
            >
              {t("admin.plans.reason_label")}
            </Label>
            <Textarea
              id={`${field}-reason`}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
