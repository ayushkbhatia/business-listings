"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/display";
import { Button, FileDrop, IconButton, Input, Label, Select } from "@/components/primitives";
import { Close } from "@/components/primitives/icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { RegisterNote } from "@/lib/credentials/service";
import type {
  AddCredentialResult,
  CredentialSignResult,
  RemoveCredentialResult,
  ResubmitCredentialResult,
} from "./actions";

/**
 * Board `8b-s`'s form, and the rows it has already produced.
 *
 * ## There is no submit button for the screen
 *
 * Each credential is added on its own, and the chrome's primary control is a
 * link back to the hub. That is not a shortcut around "Save and continue is
 * always enabled" (B1) — it is the strongest possible reading of it: a screen
 * with nothing pending cannot have a save that fails, cannot lose work when a
 * seller closes the tab, and cannot present a disabled primary. What the render
 * draws as *Save and continue* is `TaskChrome`'s own control, which every setup
 * task carries and which never refuses.
 *
 * ## Unfilled rows stay visible
 *
 * A credential with no number renders its NUMBER row grey reading "Not
 * provided" rather than dropping it — `CLAUDE.md` § Interface honesty, and the
 * same rule the spec sheet on `1g-s` follows. The seller sees what is thin
 * where a buyer will see it thin.
 */

export interface CredentialTile {
  id: string;
  kind: string;
  name: string;
  identifier: string | null;
  issuer: string | null;
  expires: string | null;
  filename: string | null;
  verified: boolean;
  /** The register's name, once one has answered. */
  verifiedBy: string | null;
  verifiedOn: string | null;
  /**
   * Board `4c-s` — where it stands with our team, already in words. Null on
   * every credential that is not in review, which is most of them.
   */
  standing: { tone: "info" | "warn" | "bad"; body: string; fix?: string } | null;
  /** Asked for a clearer document, or rejected: the seller may send it again, starting from this. */
  resubmit: { identifier: string; expires: string } | null;
}

export interface SuggestionTile {
  kind: string;
  name: string;
  /** Whole per cent, already rounded by the server. */
  rate: number;
  category: string;
}

export interface KindOption {
  value: string;
  label: string;
  /** Set for the kinds a register can answer for. */
  promise?: string;
}

export interface CredentialsWorkspaceProps {
  held: readonly CredentialTile[];
  suggestions: readonly SuggestionTile[];
  kinds: readonly KindOption[];
  /** False when no FTA register is configured. Said once, above the form. */
  registerLive: boolean;
  accept: string;
  sign: (formData: FormData) => Promise<CredentialSignResult>;
  add: (formData: FormData) => Promise<AddCredentialResult>;
  remove: (formData: FormData) => Promise<RemoveCredentialResult>;
  resubmit: (formData: FormData) => Promise<ResubmitCredentialResult>;
}

interface Picked {
  file: File;
  path: string;
}

/**
 * What each register answer says, and whether it owes the seller a fix.
 *
 * Two of the three are the seller's to act on and carry the sentence that says
 * how. The third — no register reachable — is not a warning: nobody could have
 * done anything differently, so it is information, and inventing a fix line for
 * it would be worse than having none.
 */
const NOTE: Record<RegisterNote, { tone: "warn" | "info"; body: string; fix?: string }> = {
  not_found: {
    tone: "warn",
    body: t("credentials.register.not_found"),
    fix: t("credentials.register.not_found_fix"),
  },
  bad_format: {
    tone: "warn",
    body: t("credentials.register.bad_format"),
    fix: t("credentials.register.bad_format_fix"),
  },
  register_unavailable: { tone: "info", body: t("credentials.register.unavailable") },
  // Board 4c-s. Neither is the seller's to fix: one waits for the register,
  // the other for a person. Information, so no invented fix line.
  register_retry: { tone: "info", body: t("credentials.register.register_retry") },
  mismatch: { tone: "info", body: t("credentials.register.mismatch") },
};

export function CredentialsWorkspace({
  held,
  suggestions,
  kinds,
  registerLive,
  accept,
  sign,
  add,
  remove,
  resubmit,
}: CredentialsWorkspaceProps) {
  const router = useRouter();
  const form = useId();
  const formRef = useRef<HTMLFormElement>(null);

  const [kind, setKind] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<{ error: string; fix: string } | null>(null);
  const [note, setNote] = useState<RegisterNote | null>(null);
  const [pending, startTransition] = useTransition();

  const chosen = kinds.find((option) => option.value === kind);

  /*
     The file goes straight to Storage on pick, and the row that points at it is
     written on Add. A seller who picks a certificate and then abandons the form
     leaves an object nothing references — which is the same trade every upload
     on this platform makes, and is cheaper than holding megabytes in a form
     state across a server action.
  */
  async function onPick(files: FileList): Promise<void> {
    const file = files[0];
    if (!file) return;
    setError(null);
    setUploading(true);

    const signForm = new FormData();
    signForm.set("filename", file.name);
    signForm.set("type", file.type);
    signForm.set("bytes", String(file.size));
    const signed = await sign(signForm);
    if (!signed.ok) {
      setUploading(false);
      setError({ error: signed.error, fix: signed.fix });
      return;
    }

    const put = await fetch(signed.url, {
      method: "PUT",
      headers: { "content-type": file.type },
      body: file,
    });
    setUploading(false);
    if (!put.ok) {
      setError({
        error: t("credentials.error.upload"),
        fix: t("credentials.error.upload_fix"),
      });
      return;
    }
    setPicked({ file, path: signed.path });
  }

  function onAdd(formData: FormData): void {
    setError(null);
    setNote(null);
    if (picked) {
      formData.set("path", picked.path);
      formData.set("filename", picked.file.name);
      formData.set("type", picked.file.type);
      formData.set("bytes", String(picked.file.size));
    }

    startTransition(async () => {
      const saved = await add(formData);
      if (!saved.ok) {
        setError({ error: saved.error, fix: saved.fix });
        return;
      }
      setNote(saved.registerNote);
      setPicked(null);
      setKind("");
      formRef.current?.reset();
      router.refresh();
    });
  }

  function onRemove(id: string): void {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("id", id);
      const gone = await remove(form);
      if (!gone.ok) {
        setError({ error: gone.error, fix: gone.fix });
        return;
      }
      router.refresh();
    });
  }

  /**
   * A suggestion's Add selects the kind and moves focus into the form.
   *
   * Moving focus is the point rather than a nicety: the button the seller
   * pressed is several rows above the field it filled in, and a keyboard user
   * who pressed Add and stayed where they were would have no way of knowing
   * anything happened.
   */
  function onSuggest(value: string): void {
    setKind(value);
    document.getElementById(`${form}-kind`)?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-mono text-eyebrow uppercase text-faint">
          {t("credentials.add_eyebrow")}
        </h3>
        <p className="mt-1 text-caption text-muted">{t("credentials.add_note")}</p>
      </div>

      {held.length > 0 && (
        <ul className="flex list-none flex-col gap-2.5">
          {held.map((row) => (
            <li key={row.id}>
              <HeldRow
                row={row}
                onRemove={onRemove}
                busy={pending}
                accept={accept}
                sign={sign}
                resubmit={resubmit}
              />
            </li>
          ))}
        </ul>
      )}

      {suggestions.length > 0 && (
        <ul className="flex list-none flex-col gap-2.5">
          {suggestions.map((row) => (
            <li
              key={row.kind}
              className="flex flex-wrap items-center gap-3 rounded-card border border-dashed border-line bg-paper-sunk px-4 py-3.5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-body-sm font-medium text-ink">{row.name}</p>
                <p className="mt-0.5 text-caption text-muted">
                  {t("credentials.suggested", { category: row.category, rate: row.rate })}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => onSuggest(row.kind)}>
                {t("credentials.suggest_add")}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/*
         Said once, where a register is not wired up, so the WE VERIFY THIS
         promise below never appears over a field nothing checks.
      */}
      {!registerLive && (
        <p className="text-caption text-muted">{t("credentials.register.off")}</p>
      )}

      <form
        ref={formRef}
        action={onAdd}
        className="flex flex-col gap-3.5 rounded-card border border-line-strong bg-card px-5 py-4"
      >
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${form}-kind`}>{t("credentials.field.kind")}</Label>
            <Select
              id={`${form}-kind`}
              name="kind"
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              options={kinds.map((option) => ({ value: option.value, label: option.label }))}
              placeholder={t("credentials.field.kind")}
            />
            {/*
               The promise a field wears before anything is typed into it, and
               never a badge on a saved row. A row is either checked against a
               register or it is the seller's own word.
            */}
            {chosen?.promise && registerLive && (
              <span className="font-mono text-eyebrow uppercase text-moss">{chosen.promise}</span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={`${form}-identifier`} hint={t("credentials.field.identifier_hint")}>
              {t("credentials.field.identifier")}
            </Label>
            <Input id={`${form}-identifier`} name="identifier" autoComplete="off" />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={`${form}-issuer`} hint={t("credentials.field.issuer_hint")}>
              {t("credentials.field.issuer")}
            </Label>
            <Input id={`${form}-issuer`} name="issuer" autoComplete="off" />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor={`${form}-expires`} hint={t("credentials.field.expires_hint")}>
              {t("credentials.field.expires")}
            </Label>
            <Input id={`${form}-expires`} name="expiresOn" type="date" />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`${form}-file`}>{t("credentials.field.file")}</Label>
          <FileDrop
            state={uploading ? "uploading" : picked ? "done" : "idle"}
            idleLabel={t("credentials.file_idle")}
            idleHint={t("credentials.file_hint")}
            uploadingLabel={t("credentials.file_uploading")}
            removeLabel={t("credentials.file_remove")}
            filename={picked?.file.name}
            accept={accept}
            disabled={pending}
            onSelect={(files) => void onPick(files)}
            onRemove={() => setPicked(null)}
          />
        </div>

        {error && (
          <Alert tone="bad" live="assertive" fix={error.fix}>
            {error.error}
          </Alert>
        )}

        <div className="flex items-center gap-3">
          {/*
             Never disabled on emptiness. AC1: the only thing that stops this
             button is a save already in flight.
          */}
          <Button type="submit" size="md" disabled={pending || uploading}>
            {pending ? t("credentials.adding") : t("credentials.add")}
          </Button>
        </div>
      </form>

      {/*
         The register's answer, inline and after the save — Q2, AC10. The row is
         on the list above by the time this is read, which is the point: it was
         saved, and this says what tier it landed at and why.
      */}
      {note && (
        <Alert tone={NOTE[note].tone} live="polite" fix={NOTE[note].fix}>
          {NOTE[note].body}
        </Alert>
      )}
    </div>
  );
}

/* ── One held credential ─────────────────────────────────────────────────── */

function HeldRow({
  row,
  onRemove,
  busy,
  accept,
  sign,
  resubmit,
}: {
  row: CredentialTile;
  onRemove: (id: string) => void;
  busy: boolean;
  accept: string;
  sign: (formData: FormData) => Promise<CredentialSignResult>;
  resubmit: (formData: FormData) => Promise<ResubmitCredentialResult>;
}) {
  const [editing, setEditing] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  return (
    <div className="rounded-card border border-line-strong bg-card px-4 py-3.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-body-sm font-medium text-ink">{row.name}</p>
        {row.verified ? (
          <span className="font-mono text-eyebrow uppercase text-moss">
            {t("credentials.tier.register_verified")}
          </span>
        ) : (
          <span className="text-caption text-muted">{t("credentials.tier.seller_claim")}</span>
        )}
        {/*
           The name is in the accessible name rather than on screen. Four rows
           each spelling out "Remove professional indemnity insurance" is a
           column of repeated sentences to a sighted reader and the only way a
           screen reader can tell the four apart — `IconButton` is where this
           repository already settled that, and `label` is required on it.
        */}
        <span className="ms-auto -my-1">
          <IconButton
            size="sm"
            label={t("credentials.remove", { name: row.name })}
            icon={<Close className="size-4" />}
            onClick={() => onRemove(row.id)}
            disabled={busy}
          />
        </span>
      </div>

      {/*
         Every row, filled or not. An unfilled one is grey and says so — the
         seller sees the thinness a buyer will see, which is the whole of
         `CLAUDE.md` § Interface honesty on this screen.
      */}
      <dl className="mt-2.5 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        <Row label={t("credentials.field.identifier")} value={row.identifier} />
        <Row label={t("credentials.field.issuer")} value={row.issuer} />
        <Row label={t("credentials.field.expires")} value={row.expires} />
        <Row label={t("credentials.field.file")} value={row.filename} />
      </dl>

      {row.verified && row.verifiedBy && row.verifiedOn && (
        <p className="mt-2 text-caption text-muted">
          {t("credentials.verified_on", { register: row.verifiedBy, when: row.verifiedOn })}
        </p>
      )}

      {/*
         Board 4c-s. Where it stands with our team, on the screen the seller
         would come to act on it — a request nobody reads is a submission that
         waits for ever. The reason for a rejection is the one the reviewer
         chose, verbatim, with what to do about it.
      */}
      {row.standing && !sent && (
        <div className="mt-3">
          <Alert
            tone={row.standing.tone}
            {...(row.standing.fix ? { fix: row.standing.fix } : {})}
            {...(row.resubmit && !editing
              ? {
                  action: (
                    <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                      {t("credentials.review.resubmit")}
                    </Button>
                  ),
                }
              : {})}
          >
            {row.standing.body}
          </Alert>
        </div>
      )}

      {sent && (
        <div className="mt-3">
          <Alert tone="ok" live="polite">
            {sent}
          </Alert>
        </div>
      )}

      {row.resubmit && editing && !sent && (
        <ResubmitForm
          id={row.id}
          name={row.name}
          start={row.resubmit}
          accept={accept}
          sign={sign}
          resubmit={resubmit}
          onCancel={() => setEditing(false)}
          onSent={(message) => {
            setEditing(false);
            setSent(message);
          }}
        />
      )}
    </div>
  );
}

/**
 * Board `4c-s` — correct and send again. The number and the expiry start from
 * what was sent before, and a new certificate is optional: a typo fixed is a
 * complete answer to "number does not resolve".
 */
function ResubmitForm({
  id,
  name,
  start,
  accept,
  sign,
  resubmit,
  onCancel,
  onSent,
}: {
  id: string;
  name: string;
  start: { identifier: string; expires: string };
  accept: string;
  sign: (formData: FormData) => Promise<CredentialSignResult>;
  resubmit: (formData: FormData) => Promise<ResubmitCredentialResult>;
  onCancel: () => void;
  onSent: (message: string) => void;
}) {
  const router = useRouter();
  const ids = { identifier: useId(), expires: useId(), file: useId(), title: useId() };
  const [picked, setPicked] = useState<Picked | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<{ error: string; fix: string } | null>(null);
  const [pending, startTransition] = useTransition();

  async function onPick(files: FileList): Promise<void> {
    const file = files[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    const signForm = new FormData();
    signForm.set("filename", file.name);
    signForm.set("type", file.type);
    signForm.set("bytes", String(file.size));
    const signed = await sign(signForm);
    if (!signed.ok) {
      setUploading(false);
      setError({ error: signed.error, fix: signed.fix });
      return;
    }
    const put = await fetch(signed.url, { method: "PUT", headers: { "content-type": file.type }, body: file });
    setUploading(false);
    if (!put.ok) {
      setError({ error: t("credentials.error.upload"), fix: t("credentials.error.upload_fix") });
      return;
    }
    setPicked({ file, path: signed.path });
  }

  function onSubmit(formData: FormData): void {
    setError(null);
    formData.set("id", id);
    if (picked) {
      formData.set("path", picked.path);
      formData.set("filename", picked.file.name);
      formData.set("type", picked.file.type);
      formData.set("bytes", String(picked.file.size));
    }
    startTransition(async () => {
      const saved = await resubmit(formData);
      if (!saved.ok) {
        setError({ error: saved.error, fix: saved.fix });
        return;
      }
      onSent(saved.message);
      router.refresh();
    });
  }

  return (
    <form
      action={onSubmit}
      aria-labelledby={ids.title}
      className="mt-3 flex flex-col gap-3 rounded-card border border-line bg-paper-sunk px-4 py-3.5"
    >
      <p id={ids.title} className="text-body-sm font-medium text-ink">
        {t("credentials.review.resubmit_title")}
        <span className="sr-only"> · {name}</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.identifier} hint={t("credentials.field.identifier_hint")}>
            {t("credentials.field.identifier")}
          </Label>
          <Input id={ids.identifier} name="identifier" defaultValue={start.identifier} autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.expires} hint={t("credentials.field.expires_hint")}>
            {t("credentials.field.expires")}
          </Label>
          <Input id={ids.expires} name="expiresOn" type="date" defaultValue={start.expires} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={ids.file}>{t("credentials.field.file")}</Label>
        <FileDrop
          state={uploading ? "uploading" : picked ? "done" : "idle"}
          idleLabel={t("credentials.file_idle")}
          idleHint={t("credentials.file_hint")}
          uploadingLabel={t("credentials.file_uploading")}
          removeLabel={t("credentials.file_remove")}
          filename={picked?.file.name}
          accept={accept}
          disabled={pending}
          onSelect={(files) => void onPick(files)}
          onRemove={() => setPicked(null)}
        />
      </div>
      {error && (
        <Alert tone="bad" live="assertive" fix={error.fix}>
          {error.error}
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending || uploading}>
          {pending ? t("credentials.review.resubmitting") : t("credentials.review.resubmit")}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel} disabled={pending}>
          {t("credentials.review.cancel")}
        </Button>
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="font-mono text-eyebrow uppercase text-faint">{label}</dt>
      <dd className={cn("text-caption", value === null ? "text-faint" : "text-body")}>
        {value ?? t("table.not_provided")}
      </dd>
    </div>
  );
}
