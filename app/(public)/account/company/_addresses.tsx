"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Select } from "@/components/primitives";
import { Modal, Panel } from "@/components/structure";
import { clockValue, LOAD_LIMITS, type LoadLimit } from "@/lib/buyer-company/address";
import { accessLine, loadLimitLabel, placeLine } from "@/lib/buyer-company/words";
import { formatPhone } from "@/lib/format/phone";
import { t } from "@/lib/i18n";
import { EMIRATES } from "@/lib/uae";
import type { Emirate } from "@/lib/db/generated/enums";
import { archiveAddressAction, saveAddressAction, setDefaultAddressAction, type FieldErrors } from "./actions";
import { Field, keep, Outcome } from "./_field";

export interface AddressItem {
  id: string;
  label: string;
  addressLine: string;
  emirate: string;
  areaId: string | null;
  areaName: string | null;
  attnName: string | null;
  attnPhone: string | null;
  accessPoint: string | null;
  accessFrom: number | null;
  accessUntil: number | null;
  loadLimit: LoadLimit | null;
  isDefault: boolean;
}

export interface AreaChoice {
  id: string;
  name: string;
  emirate: string;
}

/**
 * Board `7b` — *Delivery addresses*.
 *
 * `B6`: every constraint is a value — access hours, the access point, the load
 * limit, the attn. contact — because they travel onto the enquiry and a
 * supplier plans a vehicle around them. The row reads them back as the board
 * drew them, in one line.
 *
 * Picking a default applies at once, like a toggle, and says so; editing opens
 * the form in a dialog and saves on submit. Archiving keeps the row for the
 * enquiries that were sent there.
 */
export function AddressesCard({
  addresses,
  areas,
  editable,
}: {
  addresses: readonly AddressItem[];
  areas: readonly AreaChoice[];
  editable: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<AddressItem | "new" | null>(null);
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const legendId = useId();

  function makeDefault(id: string) {
    setStatus(null);
    start(async () => {
      const result = await setDefaultAddressAction(id);
      setStatus(result.ok ? { tone: "ok", text: result.message ?? "" } : { tone: "bad", text: result.error });
      router.refresh();
    });
  }

  return (
    <Panel
      title={t("company.address.title")}
      description={t("company.address.description")}
      padded={false}
      actions={
        editable ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing("new")}>
            {t("company.address.add")}
          </Button>
        ) : undefined
      }
    >
      {addresses.length === 0 ? (
        <div className="px-4 py-5">
          <p className="text-body-sm text-ink">{t("company.address.empty_title")}</p>
          <p className="mt-1 max-w-[var(--measure-prose)] text-caption text-body">
            {editable ? t("company.address.empty_admin") : t("company.address.empty_member")}
          </p>
        </div>
      ) : (
        <fieldset aria-labelledby={legendId} disabled={!editable || pending} className="m-0 min-w-0 border-0 p-0">
          <legend id={legendId} className="sr-only">
            {t("company.address.default_legend")}
          </legend>
          <ul className="divide-y divide-line">
            {addresses.map((address) => (
              <AddressRow
                key={address.id}
                address={address}
                editable={editable}
                onDefault={() => makeDefault(address.id)}
                onEdit={() => setEditing(address)}
              />
            ))}
          </ul>
        </fieldset>
      )}

      {status?.text ? (
        <div className="border-t border-line px-4 py-3">
          <Outcome tone={status.tone} text={status.text} />
        </div>
      ) : null}

      {editable && editing ? (
        <AddressDialog
          address={editing === "new" ? null : editing}
          areas={areas}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setStatus({ tone: "ok", text: message });
            router.refresh();
          }}
        />
      ) : null}
    </Panel>
  );
}

function AddressRow({
  address,
  editable,
  onDefault,
  onEdit,
}: {
  address: AddressItem;
  editable: boolean;
  onDefault: () => void;
  onEdit: () => void;
}) {
  const id = useId();
  const place = placeLine({ emirate: address.emirate as Emirate, areaName: address.areaName });
  const details = [
    address.addressLine,
    address.attnName ? t("company.address.attn", { name: address.attnName }) : null,
    address.attnPhone ? formatPhone(address.attnPhone) : null,
    accessLine(address),
    address.loadLimit ? loadLimitLabel(address.loadLimit) : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <input
        id={id}
        type="radio"
        name="defaultAddress"
        value={address.id}
        checked={address.isDefault}
        onChange={onDefault}
        disabled={!editable}
        className="mt-1 size-4 shrink-0 accent-[var(--moss)] focus-visible:shadow-focus focus-visible:outline-none"
        aria-describedby={`${id}-detail`}
      />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block text-body-sm text-ink">
          {t("company.address.row_title", { label: address.label, place })}
        </label>
        <p id={`${id}-detail`} className="mt-0.5 text-caption text-body">
          {details.join(" · ")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {address.isDefault ? (
          <span className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted">{t("company.address.default")}</span>
        ) : null}
        {editable ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            aria-label={t("company.address.edit_named", { label: address.label })}
          >
            {t("company.address.edit")}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function AddressDialog({
  address,
  areas,
  onClose,
  onSaved,
}: {
  address: AddressItem | null;
  areas: readonly AreaChoice[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const formId = useId();
  const [pending, start] = useTransition();
  const [fields, setFields] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [emirate, setEmirate] = useState<string>(address?.emirate ?? "");
  const [areaId, setAreaId] = useState<string>(address?.areaId ?? "");
  const areaOptions = useMemo(
    () => areas.filter((a) => a.emirate === emirate).map((a) => ({ value: a.id, label: a.name })),
    [areas, emirate],
  );

  function submit(form: FormData) {
    setError(null);
    start(async () => {
      const result = await saveAddressAction(form);
      if (result.ok) onSaved(result.message ?? "");
      else {
        setFields(result.fields ?? {});
        setError(result.error);
      }
    });
  }

  function archive() {
    if (!address) return;
    setError(null);
    start(async () => {
      const result = await archiveAddressAction(address.id);
      if (result.ok) onSaved(result.message ?? "");
      else {
        setConfirmArchive(false);
        setError(result.error);
      }
    });
  }

  const err = (key: string) => (fields[key] ? { error: fields[key]! } : {});

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={address ? t("company.address.edit_title", { label: address.label }) : t("company.address.add_title")}
      description={t("company.address.dialog_description")}
      closeLabel={t("company.dialog.close")}
      footer={
        confirmArchive ? (
          <>
            <Button variant="secondary" onClick={() => setConfirmArchive(false)} disabled={pending}>
              {t("company.dialog.cancel")}
            </Button>
            <Button variant="danger" onClick={archive} loading={pending}>
              {t("company.address.archive_confirm")}
            </Button>
          </>
        ) : (
          <>
            {address ? (
              <Button variant="ghost" onClick={() => setConfirmArchive(true)} disabled={pending}>
                {t("company.address.archive")}
              </Button>
            ) : null}
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              {t("company.dialog.cancel")}
            </Button>
            <Button type="submit" form={formId} loading={pending}>
              {address ? t("company.address.save") : t("company.address.add_submit")}
            </Button>
          </>
        )
      }
    >
      {confirmArchive ? (
        <p className="text-body-sm text-body">{t("company.address.archive_body")}</p>
      ) : (
        <form id={formId} onSubmit={keep(submit)} noValidate className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          {address ? <input type="hidden" name="addressId" value={address.id} /> : null}
          <Field label={t("company.address.label")} hint={t("company.address.label_hint")} requirement="required" {...err("label")}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} name="label" defaultValue={address?.label ?? ""} maxLength={80} invalid={invalid} aria-describedby={describedBy} />
            )}
          </Field>
          <Field label={t("company.address.line")} hint={t("company.address.line_hint")} requirement="required" {...err("addressLine")}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="addressLine"
                defaultValue={address?.addressLine ?? ""}
                maxLength={160}
                autoComplete="street-address"
                invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>
          <Field label={t("company.address.emirate")} requirement="required" {...err("emirate")}>
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                name="emirate"
                value={emirate}
                onChange={(event) => {
                  setEmirate(event.target.value);
                  setAreaId("");
                }}
                placeholder={t("company.address.emirate_placeholder")}
                options={EMIRATES.map((e) => ({ value: e.value, label: e.label }))}
                invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>
          <Field label={t("company.address.area")} hint={t("company.address.area_hint")} requirement="optional" {...err("areaId")}>
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                name="areaId"
                value={areaId}
                onChange={(event) => setAreaId(event.target.value)}
                placeholder={emirate ? t("company.address.area_placeholder") : t("company.address.area_needs_emirate")}
                options={areaOptions}
                disabled={!emirate}
                invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>
          <Field label={t("company.address.attn_name")} requirement="optional" {...err("attnName")}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} name="attnName" defaultValue={address?.attnName ?? ""} maxLength={80} invalid={invalid} aria-describedby={describedBy} />
            )}
          </Field>
          <Field label={t("company.address.attn_phone")} hint={t("company.address.attn_phone_hint")} requirement="optional" {...err("attnPhone")}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="attnPhone"
                type="tel"
                inputMode="tel"
                defaultValue={address?.attnPhone ? formatPhone(address.attnPhone) : ""}
                invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>
          <Field label={t("company.address.access_point")} hint={t("company.address.access_point_hint")} requirement="optional" {...err("accessPoint")}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} name="accessPoint" defaultValue={address?.accessPoint ?? ""} maxLength={40} invalid={invalid} aria-describedby={describedBy} />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("company.address.access_from")} requirement="optional" {...err("accessFrom")}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} name="accessFrom" type="time" defaultValue={clockValue(address?.accessFrom ?? null)} invalid={invalid} aria-describedby={describedBy} />
              )}
            </Field>
            <Field label={t("company.address.access_until")} requirement="optional" {...err("accessUntil")}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} name="accessUntil" type="time" defaultValue={clockValue(address?.accessUntil ?? null)} invalid={invalid} aria-describedby={describedBy} />
              )}
            </Field>
          </div>
          <Field label={t("company.address.load")} requirement="optional" {...err("loadLimit")}>
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                name="loadLimit"
                defaultValue={address?.loadLimit ?? ""}
                options={[
                  { value: "", label: t("company.address.load_none") },
                  ...LOAD_LIMITS.map((limit) => ({ value: limit, label: loadLimitLabel(limit) })),
                ]}
                invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>
        </form>
      )}
      {error ? (
        <div className="mt-3">
          <Outcome tone="bad" text={error} />
        </div>
      ) : null}
    </Modal>
  );
}
