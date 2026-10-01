"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/display";
import { Button, buttonClassName, Input, Label, Radio, Select, Textarea } from "@/components/primitives";
import { Modal } from "@/components/structure";
import { cn } from "@/lib/cn";
import type { ClaimPartyReason } from "@/lib/db/generated/enums";
import { formatCount } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import type { ConflictActionResult } from "./actions";
import type { CardView, ConflictView, RowView, Tone } from "./view";

/**
 * Board 4c — two or more claims on one listing, scored on the same rows, and
 * the decision.
 *
 * Every control that resolves opens one sheet and submits one form to one
 * action (`B2`): the card's *Award to A*, the rail's *Award to A & notify
 * both*, *Split into two listings* and *Create a separate listing for B* are
 * the same four calls under six labels. The sheet names the resolution, what
 * moves, what every other claimant is told, and that it is final — and it
 * carries the internal note, without which nothing can be saved (`B4`).
 *
 * A moderator reads the same evidence and gets one control: hand it to an ops
 * lead (`B1`). The service refuses everything else from their seat regardless.
 */

export interface ConflictActions {
  resolve: (form: FormData) => Promise<ConflictActionResult>;
  escalate: (form: FormData) => Promise<ConflictActionResult>;
  requestDocs: (form: FormData) => Promise<ConflictActionResult>;
  logCall: (form: FormData) => Promise<ConflictActionResult>;
  assign: (form: FormData) => Promise<ConflictActionResult>;
}

type Resolution = "award" | "split" | "merge_branch" | "keep_owner";
type Sheet = { resolution: Resolution; claimId: string | null; secondClaimId: string | null };
type Dialog = "escalate" | "docs" | "call" | null;

const TONE_TEXT: Record<RowView["tone"], string> = {
  ok: "text-ok-ink",
  warn: "text-warn-ink",
  bad: "text-bad-ink",
  neutral: "text-body",
  muted: "text-muted",
  body: "text-ink",
};

const TAG_TEXT: Record<Tone, string> = {
  ok: "text-ok-ink",
  warn: "text-warn-ink",
  bad: "text-bad-ink",
  neutral: "text-body",
};

const REASONS: readonly ClaimPartyReason[] = [
  "not_source_licence",
  "details_do_not_match",
  "not_confirmed_by_phone",
  "documents_not_received",
];

const MIN_NOTE = 4;

export function ConflictWorkspace({ view, actions }: { view: ConflictView; actions: ConflictActions }) {
  const router = useRouter();
  const noteId = useId();
  const [note, setNote] = useState("");
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [result, setResult] = useState<ConflictActionResult | null>(null);

  const decide = view.mode === "decide";
  const other = (exclude: string | null) => view.sheet.find((claim) => claim.id !== exclude)?.id ?? null;
  const keeper = view.recommendedId ?? view.sheet[0]?.id ?? null;
  const keeperLabel = view.sheet.find((claim) => claim.id === keeper)?.label ?? "";

  function done(outcome: ConflictActionResult) {
    setResult(outcome);
    if (outcome.ok) {
      setSheet(null);
      setDialog(null);
      router.refresh();
    }
  }

  const cardsFor = (card: CardView) => (
    <ClaimCard
      key={card.id}
      card={card}
      decide={decide && !view.challenge && card.live}
      onAward={() => setSheet({ resolution: "award", claimId: card.id, secondClaimId: null })}
    />
  );

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {result && (
            <Alert
              tone={result.ok ? "ok" : "bad"}
              live={result.ok ? "polite" : "assertive"}
              {...(result.ok ? {} : { fix: t("admin.conflict.error.fix") })}
            >
              {result.ok ? result.message : result.error}
            </Alert>
          )}

          <div role="note" className="rounded-panel border border-bad-line bg-bad-surface px-4 py-3.5 text-body-sm text-bad-ink">
            <strong className="font-medium">{view.banner.lead}</strong> {view.banner.body}
          </div>

          {view.notices.map((notice) => (
            <Alert key={notice.key} tone={notice.tone} {...(notice.fix ? { fix: notice.fix } : {})}>
              {notice.body}
            </Alert>
          ))}

          <div role="group" aria-label={t("admin.conflict.claims_label")} className="grid gap-3.5 md:grid-cols-2">
            {view.incumbent && (
              <article className="flex flex-col rounded-panel border border-line bg-card">
                <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                  <h2 className="text-body-sm font-medium text-ink">{view.incumbent.title}</h2>
                  {view.incumbent.since && <span className="font-mono text-eyebrow uppercase text-body">{view.incumbent.since}</span>}
                </header>
                <p className="px-4 py-3.5 text-caption text-body">{view.incumbent.body}</p>
              </article>
            )}
            {view.cards.map(cardsFor)}
          </div>

          {decide && (
            <div className="flex flex-col gap-3 rounded-panel border border-line bg-card px-4 py-4">
              <h2 id={`${noteId}-other`} className="text-body-sm font-medium text-ink">
                {t("admin.conflict.other.title")}
              </h2>
              {view.challenge ? (
                <>
                  <p className="max-w-prose text-caption text-body">{t("admin.conflict.other.challenge_note")}</p>
                  <div className="flex flex-wrap gap-2.5">
                    <Button variant="secondary" onClick={() => setSheet({ resolution: "keep_owner", claimId: null, secondClaimId: null })}>
                      {t("admin.conflict.other.keep_owner")}
                    </Button>
                    <Button variant="secondary" onClick={() => setDialog("escalate")}>
                      {t("admin.conflict.other.escalate")}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap gap-2.5">
                  <Button
                    variant="secondary"
                    disabled={view.sheet.length < 2}
                    onClick={() => setSheet({ resolution: "split", claimId: keeper, secondClaimId: other(keeper) })}
                  >
                    {t("admin.conflict.other.split")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={view.sheet.length < 2}
                    onClick={() => setSheet({ resolution: "merge_branch", claimId: keeper, secondClaimId: other(keeper) })}
                  >
                    {t("admin.conflict.other.merge", { label: keeperLabel })}
                  </Button>
                  <Button variant="secondary" disabled={view.docsOut} onClick={() => setDialog("docs")}>
                    {view.sheet.length === 2 ? t("admin.conflict.other.docs_two") : t("admin.conflict.other.docs_many")}
                  </Button>
                  <Button variant="secondary" onClick={() => setDialog("escalate")}>
                    {t("admin.conflict.other.escalate")}
                  </Button>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <Label htmlFor={noteId} requirement="required" requirementLabel={t("field.required")} hint={t("admin.conflict.note.hint")}>
                  {t("admin.conflict.note.label")}
                </Label>
                <Textarea id={noteId} rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
              </div>
            </div>
          )}

          {view.mode === "read" && view.open && <AssignPanel view={view} assign={actions.assign} onDone={done} />}

          {view.resolved && (
            <div className="flex flex-col gap-2 rounded-panel border border-line bg-card px-4 py-4">
              <h2 id={`${noteId}-resolved`} className="text-body-sm font-medium text-ink">
                {t("admin.conflict.resolved.title")}
              </h2>
              <p className="max-w-prose text-body-sm text-body">{view.resolved.sentence}</p>
              <p className="max-w-prose text-caption text-body">{view.resolved.note}</p>
              {view.resolved.released && <p className="text-caption text-body">{view.resolved.released}</p>}
              <p className="text-caption text-body">{view.resolved.notified}</p>
              <p className="flex flex-wrap gap-4 text-caption">
                {view.resolved.producedHref && (
                  <Link href={view.resolved.producedHref} className="text-moss underline underline-offset-2">
                    {t("admin.conflict.resolved.produced")}
                  </Link>
                )}
                <Link href={view.resolved.auditHref} className="text-moss underline underline-offset-2">
                  {t("admin.conflict.resolved.audit")}
                </Link>
              </p>
            </div>
          )}

          {view.dissolved && (
            <div className="flex flex-col gap-2 rounded-panel border border-line bg-card px-4 py-4">
              <h2 className="text-body-sm font-medium text-ink">{t("admin.conflict.dissolved.title")}</h2>
              <p className="max-w-prose text-body-sm text-body">{view.dissolved}</p>
            </div>
          )}
        </div>

        <aside aria-label={t("admin.conflict.rail.label", { name: view.rail.name })} className="flex min-w-0 flex-col gap-4">
          <p className="font-mono text-eyebrow uppercase text-body">{t("admin.conflict.rail.eyebrow")}</p>
          <div className="rounded-panel border border-line bg-card px-4 py-4">
            <h2 className="text-body font-medium text-ink">{view.rail.name}</h2>
            <p className="mt-0.5 text-caption text-body">{view.rail.place}</p>
            <dl className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
              {view.rail.rows.map((row) => (
                <div key={row.key} className="flex items-baseline justify-between gap-3">
                  <dt className="text-caption text-muted">{row.label}</dt>
                  <dd className={cn("text-end text-caption", TONE_TEXT[row.tone], row.mono && "font-mono tabular-nums", row.tone === "bad" && "font-medium")}>
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
            {view.rail.cost && <p className="mt-3 rounded-tag bg-warn-surface px-3 py-2.5 text-caption text-warn-ink">{view.rail.cost}</p>}
          </div>

          <div className="rounded-panel border border-line bg-card px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-mono text-eyebrow uppercase text-body">{t("admin.conflict.log.title")}</h2>
              {decide && (
                <Button size="sm" variant="ghost" onClick={() => setDialog("call")}>
                  {t("admin.conflict.call.action")}
                </Button>
              )}
            </div>
            <ol className="mt-3 flex flex-col gap-3">
              {view.rail.log.map((line, index) => (
                <li key={`${line.stamp}-${index}`} className="flex gap-2.5">
                  <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-pill", line.done ? "bg-ok" : "bg-line-strong")} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-caption text-ink">{line.text}</span>
                    <span className={cn("font-mono text-eyebrow uppercase", line.late ? "text-bad-ink" : "text-body")}>{line.stamp}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {(view.rail.award || view.rail.split) && (
            <div className="flex flex-col gap-2">
              {view.rail.award && (
                <Button size="lg" block onClick={() => setSheet({ resolution: "award", claimId: view.rail.award!.claimId, secondClaimId: null })}>
                  {view.rail.award.label}
                </Button>
              )}
              {view.rail.split && (
                <Button
                  variant="secondary"
                  block
                  onClick={() => setSheet({ resolution: "split", claimId: view.rail.split!.keeperId, secondClaimId: view.rail.split!.secondId })}
                >
                  {view.rail.split.label}
                </Button>
              )}
            </div>
          )}
        </aside>
      </div>

      {sheet && (
        <ConfirmSheet
          view={view}
          sheet={sheet}
          note={note}
          onNote={setNote}
          onPick={setSheet}
          onClose={() => setSheet(null)}
          resolve={actions.resolve}
          onDone={done}
        />
      )}
      {dialog === "escalate" && (
        <NoteDialog
          title={t("admin.conflict.escalate.title")}
          body={t("admin.conflict.escalate.body")}
          noteLabel={t("admin.conflict.escalate.note")}
          confirm={t("admin.conflict.escalate.confirm")}
          initialNote={note}
          holders={{ label: t("admin.conflict.escalate.holder"), options: view.holders }}
          fields={{ conflictId: view.id }}
          action={actions.escalate}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog === "docs" && (
        <NoteDialog
          title={t("admin.conflict.docs.title")}
          body={t("admin.conflict.docs.body")}
          noteLabel={t("admin.conflict.docs.note")}
          confirm={t("admin.conflict.docs.confirm")}
          initialNote={note}
          fields={{ conflictId: view.id }}
          action={actions.requestDocs}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog === "call" && <CallDialog view={view} logCall={actions.logCall} onClose={() => setDialog(null)} onDone={done} />}
    </>
  );
}

function ClaimCard({ card, decide, onAward }: { card: CardView; decide: boolean; onAward: () => void }) {
  const titleId = useId();
  return (
    <article
      aria-labelledby={titleId}
      className={cn("flex flex-col rounded-panel bg-card", card.recommended ? "border-[1.5px] border-moss" : "border border-line")}
    >
      <header className={cn("flex items-center justify-between gap-3 border-b border-line px-4 py-3", card.recommended && "bg-moss-wash")}>
        <h2 id={titleId} className="text-body-sm font-medium text-ink">
          {card.title}
        </h2>
        <span className="flex items-center gap-2">
          {card.recommended && <span className="sr-only">{t("admin.conflict.recommended")}</span>}
          {card.tag && <span className={cn("font-mono text-eyebrow uppercase", TAG_TEXT[card.tag.tone])}>{card.tag.text}</span>}
        </span>
      </header>
      <dl className="flex flex-col gap-2.5 px-4 py-3.5">
        {card.rows.map((row) => (
          <div key={row.key} className="flex items-start justify-between gap-3">
            <dt className="shrink-0 text-caption text-muted">{row.label}</dt>
            <dd className="flex min-w-0 flex-col items-end gap-0.5 text-end">
              <span className={cn("text-caption", TONE_TEXT[row.tone], row.mono && "font-mono tabular-nums")}>{row.value}</span>
              {row.note && <span className={cn("text-eyebrow", TONE_TEXT[row.note.tone])}>{row.note.text}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <footer className="mt-auto flex flex-wrap items-center gap-2.5 border-t border-line px-4 py-3">
        {decide &&
          (card.awardBlocked ? (
            <span className="flex-1 text-caption text-bad-ink">{card.awardBlocked}</span>
          ) : (
            <span className="min-w-0 flex-1">
              <Button variant={card.recommended ? "primary" : "secondary"} block onClick={onAward}>
                {t("admin.conflict.award_to", { label: card.label })}
              </Button>
            </span>
          ))}
        {card.file ? (
          <a href={card.file.href} target="_blank" rel="noreferrer" className={buttonClassName({ variant: "secondary" })} title={card.file.filename}>
            {card.file.label}
          </a>
        ) : (
          <span className="text-caption text-body">{t("admin.conflict.no_file")}</span>
        )}
        {card.tenancyFile && (
          <a href={card.tenancyFile.href} target="_blank" rel="noreferrer" className={buttonClassName({ variant: "ghost", size: "sm" })}>
            {card.tenancyFile.label}
          </a>
        )}
      </footer>
    </article>
  );
}

/**
 * The confirm sheet (Phase 3.7): the resolution named, what moves, what every
 * other claimant is told — one of four sentences each, pre-selected from the
 * signals and the reviewer's to change — and that it is final. The note is
 * here too, because it is required and because the sheet is where the reason
 * stops being a draft.
 */
function ConfirmSheet({
  view,
  sheet,
  note,
  onNote,
  onPick,
  onClose,
  resolve,
  onDone,
}: {
  view: ConflictView;
  sheet: Sheet;
  note: string;
  onNote: (value: string) => void;
  onPick: (sheet: Sheet) => void;
  onClose: () => void;
  resolve: (form: FormData) => Promise<ConflictActionResult>;
  onDone: (outcome: ConflictActionResult) => void;
}) {
  const ids = { keeper: useId(), second: useId(), note: useId(), name: useId(), expiry: useId() };
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, ClaimPartyReason>>(() =>
    Object.fromEntries(view.sheet.map((claim) => [claim.id, claim.defaultReason])),
  );
  const [splitName, setSplitName] = useState("");
  const [splitExpiry, setSplitExpiry] = useState("");

  const byId = new Map(view.sheet.map((claim) => [claim.id, claim]));
  const keeper = sheet.claimId ? byId.get(sheet.claimId) : undefined;
  const second = sheet.secondClaimId ? byId.get(sheet.secondClaimId) : undefined;
  const pairs = sheet.resolution === "split" || sheet.resolution === "merge_branch";
  const losers = view.sheet.filter((claim) => claim.id !== keeper?.id && claim.id !== second?.id);
  const options = view.sheet.map((claim) => ({ value: claim.id, label: t("admin.conflict.sheet.claim_option", { label: claim.label }) }));

  const needsName = sheet.resolution === "split" && second !== undefined && second.legalName === null;
  const needsExpiry = sheet.resolution === "split" && second !== undefined && second.needsExpiry;
  const blocked =
    (sheet.resolution !== "keep_owner" && (!keeper || keeper.lapsed)) ||
    (pairs && (!second || second.id === keeper?.id || !second.licence)) ||
    (sheet.resolution === "split" && second?.hasListing !== null && second?.hasListing !== undefined) ||
    (needsName && splitName.trim() === "") ||
    (needsExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(splitExpiry));
  const ready = !blocked && note.trim().length >= MIN_NOTE;

  const title =
    sheet.resolution === "award"
      ? t("admin.conflict.sheet.award_title", { label: keeper?.label ?? "" })
      : sheet.resolution === "split"
        ? t("admin.conflict.sheet.split_title")
        : sheet.resolution === "merge_branch"
          ? t("admin.conflict.sheet.merge_title", { label: keeper?.label ?? "" })
          : t("admin.conflict.sheet.keep_title");
  const confirm =
    sheet.resolution === "award"
      ? t("admin.conflict.sheet.confirm_award", { label: keeper?.label ?? "" })
      : sheet.resolution === "split"
        ? t("admin.conflict.sheet.confirm_split")
        : sheet.resolution === "merge_branch"
          ? t("admin.conflict.sheet.confirm_merge")
          : t("admin.conflict.sheet.confirm_keep");

  const moves: string[] = [];
  if (sheet.resolution === "keep_owner") moves.push(t("admin.conflict.sheet.moves_keep"));
  else if (keeper) {
    moves.push(t("admin.conflict.sheet.moves_award", { label: keeper.label }));
    moves.push(
      view.waitingEnquiries > 0
        ? t("admin.conflict.sheet.moves_enquiries", { count: view.waitingEnquiries, n: formatCount(view.waitingEnquiries), label: keeper.label })
        : t("admin.conflict.sheet.moves_none"),
    );
  }
  if (sheet.resolution === "split" && second?.licence) {
    moves.push(
      second.hasListing
        ? t("admin.conflict.sheet.split_has_listing", { licence: second.licence, name: second.hasListing.name })
        : second.legalName
          ? t("admin.conflict.sheet.moves_split", { label: second.label, licence: second.licence, name: second.legalName })
          : t("admin.conflict.sheet.moves_split_unnamed", { label: second.label, licence: second.licence }),
    );
  }
  if (sheet.resolution === "merge_branch" && second?.licence) {
    moves.push(t("admin.conflict.sheet.moves_merge", { licence: second.licence, label: second.label }));
    if (second.branchHint) moves.push(second.branchHint);
  }

  const against =
    view.recommendedId && sheet.resolution !== "keep_owner" && keeper && keeper.id !== view.recommendedId && view.basis
      ? t("admin.conflict.sheet.against", { label: byId.get(view.recommendedId)?.label ?? "", basis: view.basis })
      : null;

  function send() {
    const form = new FormData();
    form.set("conflictId", view.id);
    form.set("resolution", sheet.resolution);
    if (keeper) form.set("claimId", keeper.id);
    if (second && pairs) form.set("secondClaimId", second.id);
    form.set("note", note);
    for (const claim of losers) form.set(`reason:${claim.id}`, reasons[claim.id] ?? claim.defaultReason);
    if (needsName) form.set("splitName", splitName);
    if (needsExpiry) form.set("splitExpiry", splitExpiry);
    startTransition(async () => {
      const outcome = await resolve(form);
      if (outcome.ok) onDone(outcome);
      else setError(outcome.error);
    });
  }

  return (
    <Modal
      open
      size="lg"
      onClose={() => {
        if (!pending) onClose();
      }}
      title={title}
      description={t("admin.conflict.sheet.undo")}
      closeLabel={t("action.cancel")}
      footer={
        <>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button loading={pending} disabled={pending || !ready} onClick={send}>
            {confirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {sheet.resolution !== "keep_owner" && (
          <div className={cn("grid gap-3", pairs && "sm:grid-cols-2")}>
            <div className="flex flex-col gap-1">
              <Label htmlFor={ids.keeper}>{t("admin.conflict.sheet.keeper")}</Label>
              <Select
                id={ids.keeper}
                value={sheet.claimId ?? ""}
                options={options}
                onChange={(event) => onPick({ ...sheet, claimId: event.target.value })}
              />
            </div>
            {pairs && (
              <div className="flex flex-col gap-1">
                <Label htmlFor={ids.second}>
                  {sheet.resolution === "split" ? t("admin.conflict.sheet.second_split") : t("admin.conflict.sheet.second_merge")}
                </Label>
                <Select
                  id={ids.second}
                  value={sheet.secondClaimId ?? ""}
                  options={options.filter((option) => option.value !== sheet.claimId)}
                  onChange={(event) => onPick({ ...sheet, secondClaimId: event.target.value })}
                />
              </div>
            )}
          </div>
        )}

        <ul className="flex list-disc flex-col gap-1.5 ps-5 text-body-sm text-body">
          {moves.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        {against && (
          <Alert tone="warn" fix={t("admin.conflict.note.hint")}>
            {against}
          </Alert>
        )}

        {needsName && second?.licence && (
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.name} requirement="required" requirementLabel={t("field.required")} hint={t("admin.conflict.sheet.split_name_hint")}>
              {t("admin.conflict.sheet.split_name", { licence: second.licence })}
            </Label>
            <Input id={ids.name} value={splitName} onChange={(event) => setSplitName(event.target.value)} />
          </div>
        )}
        {needsExpiry && (
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.expiry} requirement="required" requirementLabel={t("field.required")} hint={t("admin.conflict.sheet.split_expiry_hint")}>
              {t("admin.conflict.sheet.split_expiry")}
            </Label>
            <Input id={ids.expiry} type="date" value={splitExpiry} onChange={(event) => setSplitExpiry(event.target.value)} />
          </div>
        )}

        {(losers.length > 0 || (pairs && second)) && (
          <fieldset className="flex min-w-0 flex-col gap-3 border-0 p-0">
            <legend className="text-body-sm font-medium text-ink">{t("admin.conflict.sheet.told_heading")}</legend>
            <p className="text-caption text-body">{t("admin.conflict.sheet.told_hint")}</p>
            {pairs && second && (
              <p className="text-caption text-body">
                {sheet.resolution === "split"
                  ? t("admin.conflict.sheet.told_split", { label: second.label })
                  : t("admin.conflict.sheet.told_merge", { label: second.label, reason: t("claim.decided.merged") })}
              </p>
            )}
            {losers.map((claim) => (
              <ReasonPicker
                key={claim.id}
                label={t("admin.conflict.sheet.told_label", { label: claim.label })}
                value={reasons[claim.id] ?? claim.defaultReason}
                onChange={(value) => setReasons((current) => ({ ...current, [claim.id]: value }))}
              />
            ))}
          </fieldset>
        )}

        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.note} requirement="required" requirementLabel={t("field.required")} hint={t("admin.conflict.note.hint")}>
            {t("admin.conflict.note.label")}
          </Label>
          <Textarea id={ids.note} rows={3} value={note} onChange={(event) => onNote(event.target.value)} />
        </div>

        {error && (
          <Alert tone="bad" live="assertive" fix={t("admin.conflict.error.fix")}>
            {error}
          </Alert>
        )}
      </div>
    </Modal>
  );
}

function ReasonPicker({ label, value, onChange }: { label: string; value: ClaimPartyReason; onChange: (value: ClaimPartyReason) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Select
        id={id}
        value={value}
        options={REASONS.map((reason) => ({ value: reason, label: t(`admin.conflict.reason.${reason}` as MessageKey) }))}
        onChange={(event) => onChange(event.target.value as ClaimPartyReason)}
      />
      <p className="text-caption text-body">{t(`claim.party_reason.${value}` as MessageKey)}</p>
    </div>
  );
}

/** Escalate and request documents: a sentence about what happens, and the reason. */
function NoteDialog({
  title,
  body,
  noteLabel,
  confirm,
  initialNote,
  holders,
  fields,
  action,
  onClose,
  onDone,
}: {
  title: string;
  body: string;
  noteLabel: string;
  confirm: string;
  initialNote: string;
  holders?: { label: string; options: readonly { id: string; name: string }[] };
  fields: Record<string, string>;
  action: (form: FormData) => Promise<ConflictActionResult>;
  onClose: () => void;
  onDone: (outcome: ConflictActionResult) => void;
}) {
  const ids = { holder: useId(), note: useId() };
  const [holderId, setHolderId] = useState("");
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = note.trim().length >= MIN_NOTE && (!holders || holderId !== "");

  function send() {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    if (holders) form.set("holderId", holderId);
    form.set("note", note);
    startTransition(async () => {
      const outcome = await action(form);
      if (outcome.ok) onDone(outcome);
      else setError(outcome.error);
    });
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title={title}
      description={body}
      closeLabel={t("action.cancel")}
      footer={
        <>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button loading={pending} disabled={pending || !ready} onClick={send}>
            {confirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {holders && (
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.holder} requirement="required" requirementLabel={t("field.required")}>
              {holders.label}
            </Label>
            <Select
              id={ids.holder}
              value={holderId}
              placeholder={holders.label}
              options={holders.options.map((holder) => ({ value: holder.id, label: holder.name }))}
              onChange={(event) => setHolderId(event.target.value)}
            />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.note} requirement="required" requirementLabel={t("field.required")} hint={t("admin.conflict.note.hint")}>
            {noteLabel}
          </Label>
          <Textarea id={ids.note} rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        {error && (
          <Alert tone="bad" live="assertive" fix={t("admin.conflict.error.fix")}>
            {error}
          </Alert>
        )}
      </div>
    </Modal>
  );
}

/** `B7`: which number was called decides whether the call is evidence. */
function CallDialog({
  view,
  logCall,
  onClose,
  onDone,
}: {
  view: ConflictView;
  logCall: (form: FormData) => Promise<ConflictActionResult>;
  onClose: () => void;
  onDone: (outcome: ConflictActionResult) => void;
}) {
  const ids = { claim: useId(), to: useId(), outcome: useId(), note: useId() };
  const [claimId, setClaimId] = useState("");
  const [to, setTo] = useState<"public_record" | "claimant_supplied" | "">("");
  const [confirmed, setConfirmed] = useState<"yes" | "no" | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = claimId !== "" && to !== "" && confirmed !== "" && note.trim().length >= MIN_NOTE;

  function send() {
    const form = new FormData();
    form.set("conflictId", view.id);
    form.set("claimId", claimId);
    form.set("to", to);
    form.set("confirmed", confirmed);
    form.set("note", note);
    startTransition(async () => {
      const outcome = await logCall(form);
      if (outcome.ok) onDone(outcome);
      else setError(outcome.error);
    });
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title={t("admin.conflict.call.title")}
      description={t("admin.conflict.call.body")}
      closeLabel={t("action.cancel")}
      footer={
        <>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button loading={pending} disabled={pending || !ready} onClick={send}>
            {t("admin.conflict.call.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.claim} requirement="required" requirementLabel={t("field.required")}>
            {t("admin.conflict.call.claim")}
          </Label>
          <Select
            id={ids.claim}
            value={claimId}
            placeholder={t("admin.conflict.call.claim")}
            options={view.sheet.map((claim) => ({ value: claim.id, label: t("admin.conflict.call.claim_option", { label: claim.label }) }))}
            onChange={(event) => setClaimId(event.target.value)}
          />
        </div>
        <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="text-body-sm font-medium text-ink">{t("admin.conflict.call.to")}</legend>
          <Radio name={ids.to} value="public_record" checked={to === "public_record"} onChange={() => setTo("public_record")} label={t("admin.conflict.call.to_public")} />
          <Radio name={ids.to} value="claimant_supplied" checked={to === "claimant_supplied"} onChange={() => setTo("claimant_supplied")} label={t("admin.conflict.call.to_supplied")} />
        </fieldset>
        <fieldset className="flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="text-body-sm font-medium text-ink">{t("admin.conflict.call.outcome")}</legend>
          <Radio name={ids.outcome} value="yes" checked={confirmed === "yes"} onChange={() => setConfirmed("yes")} label={t("admin.conflict.call.confirmed")} />
          <Radio name={ids.outcome} value="no" checked={confirmed === "no"} onChange={() => setConfirmed("no")} label={t("admin.conflict.call.not_confirmed")} />
        </fieldset>
        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.note} requirement="required" requirementLabel={t("field.required")} hint={t("admin.conflict.note.hint")}>
            {t("admin.conflict.call.note")}
          </Label>
          <Textarea id={ids.note} rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        {error && (
          <Alert tone="bad" live="assertive" fix={t("admin.conflict.error.fix")}>
            {error}
          </Alert>
        )}
      </div>
    </Modal>
  );
}

/** `B1`: a moderator's one control on a conflict. */
function AssignPanel({
  view,
  assign,
  onDone,
}: {
  view: ConflictView;
  assign: (form: FormData) => Promise<ConflictActionResult>;
  onDone: (outcome: ConflictActionResult) => void;
}) {
  const ids = { title: useId(), holder: useId(), reason: useId() };
  const [holderId, setHolderId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    const form = new FormData();
    form.set("conflictId", view.id);
    form.set("assigneeId", holderId);
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await assign(form);
      if (outcome.ok) {
        setReason("");
        onDone(outcome);
      } else setError(outcome.error);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-panel border border-line bg-card px-4 py-4">
      <h2 id={ids.title} className="text-body-sm font-medium text-ink">
        {t("admin.conflict.assign.title")}
      </h2>
      <p className="max-w-prose text-caption text-body">
        {t("admin.conflict.assign.body")}{" "}
        {view.assignee ? t("admin.conflict.assign.current", { name: view.assignee }) : t("admin.conflict.assign.nobody")}
      </p>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.holder} requirement="required" requirementLabel={t("field.required")}>
            {t("admin.conflict.assign.holder")}
          </Label>
          <Select
            id={ids.holder}
            value={holderId}
            placeholder={t("admin.conflict.assign.holder")}
            options={view.holders.map((holder) => ({ value: holder.id, label: holder.name }))}
            onChange={(event) => setHolderId(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.reason} requirement="required" requirementLabel={t("field.required")} hint={t("admin.queue.dialog.reason_hint")}>
            {t("admin.conflict.assign.reason")}
          </Label>
          <Textarea id={ids.reason} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
      </div>
      <div>
        <Button loading={pending} disabled={pending || holderId === "" || reason.trim().length < MIN_NOTE} onClick={send}>
          {t("admin.conflict.assign.confirm")}
        </Button>
      </div>
      {error && (
        <Alert tone="bad" live="assertive" fix={t("admin.conflict.error.fix")}>
          {error}
        </Alert>
      )}
    </div>
  );
}
