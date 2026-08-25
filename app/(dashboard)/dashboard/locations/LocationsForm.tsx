"use client";

import { Alert } from "@/components/display";
import { useState, useTransition } from "react";
import { Button, Input, Select, Toggle } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { EmirateAreaPicker, type AreaOption } from "@/components/domain";
import { t } from "@/lib/i18n";
import type { DeleteResult, LocationResult } from "./actions";

/**
 * Board 3c — locations and coverage.
 *
 * One branch open at a time. A page of six expanded address forms is six sets
 * of near-identical fields, and a supplier editing the Sharjah depot ends up
 * typing into the Dubai one.
 *
 * The pin instruction is the board's own words and is not decoration: a driver
 * following a pin dropped on the street arrives at the wrong side of a
 * compound, and in Mussafah that is a twenty-minute detour.
 */

export interface BranchRow {
  id: string;
  type: string;
  emirate: string;
  areaId: string;
  areaName: string;
  isFreeZone: boolean;
  addressLine: string;
  phone: string | null;
  whatsapp: string | null;
  serviceRadiusKm: number | null;
  published: boolean;
}

export interface LocationsFormProps {
  branches: readonly BranchRow[];
  areas: readonly AreaOption[];
  saveAction: (formData: FormData) => Promise<LocationResult>;
  deleteAction: (formData: FormData) => Promise<DeleteResult>;
}

const TYPES = ["head_office", "warehouse", "trade_counter", "depot", "sales_office", "workshop"] as const;

export function LocationsForm({ branches, areas, saveAction, deleteAction }: LocationsFormProps) {
  const [editing, setEditing] = useState<string | null>(branches[0]?.id ?? "new");

  return (
    <div className="flex flex-col gap-4">
      {branches.length === 0 && editing !== "new" && (
        <Panel title={t("locations.none")}>
          <p className="max-w-prose text-body-sm text-muted">{t("locations.none_body")}</p>
        </Panel>
      )}

      {branches.map((branch) => (
        <BranchPanel
          key={branch.id}
          branch={branch}
          areas={areas}
          open={editing === branch.id}
          onOpen={() => setEditing(editing === branch.id ? null : branch.id)}
          saveAction={saveAction}
          deleteAction={deleteAction}
        />
      ))}

      {editing === "new" ? (
        <BranchPanel
          branch={null}
          areas={areas}
          open
          onOpen={() => setEditing(null)}
          saveAction={saveAction}
          deleteAction={deleteAction}
        />
      ) : (
        <div>
          <Button variant="secondary" onClick={() => setEditing("new")}>
            {t("locations.add")}
          </Button>
        </div>
      )}
    </div>
  );
}

function BranchPanel({
  branch,
  areas,
  open,
  onOpen,
  saveAction,
  deleteAction,
}: {
  branch: BranchRow | null;
  areas: readonly AreaOption[];
  open: boolean;
  onOpen: () => void;
  saveAction: (formData: FormData) => Promise<LocationResult>;
  deleteAction: (formData: FormData) => Promise<DeleteResult>;
}) {
  const [emirate, setEmirate] = useState<string | null>(branch?.emirate ?? null);
  const [areaId, setAreaId] = useState<string | null>(branch?.areaId ?? null);
  const [published, setPublished] = useState(branch?.published ?? true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const title = branch
    ? `${t(`locations.type.${branch.type}` as never)} — ${branch.areaName}`
    : t("locations.add");

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set("areaId", areaId ?? "");
    if (published) form.set("published", "on");
    setError(null);

    startTransition(async () => {
      const result = await saveAction(form);
      if (!result.ok) setError(result.error);
      else setNotice(t("locations.saved"));
    });
  }

  return (
    <Panel
      title={title}
      actions={
        <Button size="sm" variant="ghost" onClick={onOpen}>
          {open ? t("locations.done") : t("locations.edit")}
        </Button>
      }
    >
      {!open ? (
        <p className="text-body-sm text-muted">{branch?.addressLine}</p>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {branch && <input type="hidden" name="id" value={branch.id} />}

          {error && (
            <Alert tone="bad" live="assertive">{error}</Alert>
          )}

          <label className="flex max-w-sm flex-col gap-1">
            <span className="text-body-sm text-ink">{t("locations.type")}</span>
            <Select
              name="type"
              defaultValue={branch?.type ?? "head_office"}
              options={TYPES.map((type) => ({
                value: type,
                label: t(`locations.type.${type}` as never),
              }))}
            />
          </label>

          <EmirateAreaPicker
            areas={areas}
            emirate={emirate}
            areaId={areaId}
            onChange={(next) => {
              setEmirate(next.emirate);
              setAreaId(next.areaId);
            }}
            label={t("locations.where")}
            emirateLabel={t("locations.emirate")}
            areaLabel={t("locations.area")}
            emiratePlaceholder={t("locations.emirate_placeholder")}
            areaPlaceholder={t("locations.area_placeholder")}
            freeZoneFilterLabel={t("locations.free_zone_filter")}
            freeZoneTagLabel={t("locations.free_zone_tag")}
            freeZoneNote={(emirateName, areaName) =>
              t("locations.free_zone_note", { emirate: emirateName, area: areaName })
            }
            searchLabel={t("locations.search_areas")}
            noAreasLabel={t("locations.no_areas")}
            disabled={pending}
          />

          <label className="flex flex-col gap-1">
            <span className="text-body-sm text-ink">{t("locations.address")}</span>
            <Input name="addressLine" defaultValue={branch?.addressLine ?? ""} required />
            <span className="text-caption text-muted">{t("locations.address_hint")}</span>
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-body-sm text-ink">{t("locations.phone")}</span>
              <Input name="phone" mono defaultValue={branch?.phone ?? ""} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-body-sm text-ink">{t("locations.whatsapp")}</span>
              <Input name="whatsapp" mono defaultValue={branch?.whatsapp ?? ""} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-body-sm text-ink">{t("locations.radius")}</span>
              <Input
                name="serviceRadiusKm"
                mono
                inputMode="numeric"
                defaultValue={branch?.serviceRadiusKm ?? ""}
              />
              <span className="text-caption text-muted">{t("locations.radius_hint")}</span>
            </label>
          </div>

          {/*
            The board's own instruction, kept word for word. A driver following
            a pin on the street arrives at the wrong side of the compound.
          */}
          <p className="max-w-prose rounded-ctl border border-line bg-paper-sunk px-3 py-2 text-caption text-muted">
            {t("locations.pin_hint")}
          </p>

          <Toggle
            checked={published}
            label={t("locations.published")}
            onChange={setPublished}
            disabled={pending}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending}>
              {t("locations.save")}
            </Button>
            {branch && (
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() => {
                  if (!window.confirm(t("locations.confirm_delete"))) return;
                  const form = new FormData();
                  form.set("id", branch.id);
                  startTransition(async () => {
                    const result = await deleteAction(form);
                    if (!result.ok) setError(result.error);
                    else window.location.reload();
                  });
                }}
              >
                {t("locations.delete")}
              </Button>
            )}
            <span aria-live="polite" className="text-body-sm text-muted">
              {notice}
            </span>
          </div>
        </form>
      )}
    </Panel>
  );
}
