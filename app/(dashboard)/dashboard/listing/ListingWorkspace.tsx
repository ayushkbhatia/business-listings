"use client";

import { useMemo, useState, useTransition } from "react";
import { Button, Input, Select, Textarea } from "@/components/primitives";
import { Alert, StatusBadge } from "@/components/display";
import { Panel, Tabs } from "@/components/structure";
import { DESCRIPTION_LIMIT } from "@/lib/listing/constants";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ActionResult, SaveActionResult } from "./actions";
import { ListingRail } from "./ListingRail";
import { PhotoPicker } from "./PhotoPicker";

/**
 * Board 3b — the editor, and the save model it exists to make legible.
 *
 * ## One button, two behaviours, said out loud
 *
 * Criterion 3. `Save changes` writes the fields a seller owns and queues the
 * ones a person has to look at, in one action. The screen then says which was
 * which in three places, none of which is a paragraph the seller reads once:
 *
 *   · the header pill counts **held edits only** — saving a description alone
 *     produces no pill at all (criterion 1)
 *   · a held field is marked **where it is edited**, in amber, with the same
 *     word everywhere (criterion 2)
 *   · the rail's moderation card states the live half as well as the held half,
 *     because a panel listing only what is stuck reads as though nothing shipped
 *
 * ## Metadata is `text-body`, not `text-muted`
 *
 * Criterion 10 asks that no metadata on this screen sit lighter than the value
 * the handoff names. `--text-muted` is lighter than it; `--text-body` is
 * darker. So metadata here takes `--text-body`, which satisfies the criterion
 * with a token that already exists rather than redefining `--text-muted` for
 * all ninety-five screens — the canvas decision the handoff records, and not
 * this board's to take.
 */

const TEAM_SIZES = ["b1_10", "b11_50", "b51_200", "b201_500", "b500_plus"] as const;
const LANGUAGES = ["English", "Arabic", "Hindi", "Urdu", "Malayalam", "Tagalog", "Tamil", "Bengali"];

export interface HeldEditView {
  id: string;
  field: string;
  value: string;
  label: string;
  submittedAt: string;
}

export interface CategoryView {
  id: string;
  name: string;
  parentName: string | null;
}

export interface ListingWorkspaceProps {
  view: {
    displayName: string;
    tradeName: string;
    slug: string;
    description: string;
    paymentTerms: string | null;
    establishedYear: number | null;
    teamSize: string | null;
    languages: string[];
    primary: CategoryView;
    additional: CategoryView[];
    choices: CategoryView[];
    held: HeldEditView[];
    photos: {
      picked: { id: string; url: string; alt: string | null; isCover: boolean; sortOrder: number }[];
      libraryCount: number;
    };
    revisions: { id: string; field: string; itemCount: number | null; author: string; at: string }[];
    categoryAllowance: { remaining: number | null; cap: number | null; used: number };
    planName: string;
    place: string | null;
    ratingOverall: number | null;
    reviewCount: number;
    lastSavedAt: string | null;
  };
  library: { id: string; url: string; alt: string | null }[];
  editable: boolean;
  saveAction: (formData: FormData) => Promise<SaveActionResult>;
  withdrawAction: (formData: FormData) => Promise<ActionResult>;
  unpickAction: (formData: FormData) => Promise<ActionResult>;
  pickAction: (formData: FormData) => Promise<ActionResult>;
  coverAction: (formData: FormData) => Promise<ActionResult>;
}

const TABS = ["basics", "services", "media", "seo"] as const;
type TabKey = (typeof TABS)[number];

export function ListingWorkspace(props: ListingWorkspaceProps) {
  const { view, editable } = props;

  const [tab, setTab] = useState<TabKey>("basics");
  const [description, setDescription] = useState(view.description);
  const [paymentTerms, setPaymentTerms] = useState(view.paymentTerms ?? "");
  const [primaryId, setPrimaryId] = useState(view.primary.id);
  const [year, setYear] = useState(view.establishedYear?.toString() ?? "");
  const [teamSize, setTeamSize] = useState(view.teamSize ?? "");
  const [languages, setLanguages] = useState<string[]>(view.languages);
  /** Category ids asked for in this sitting, before the save posts them. */
  const [adding, setAdding] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const overLimit = description.length > DESCRIPTION_LIMIT;

  /*
     Held ids, so a chip can mark itself.

     Criterion 2 is that the mark sits where the field is edited. The pill in
     the header says how many; this is what lets the chip say which.
  */
  const heldCategoryIds = useMemo(
    () =>
      new Set(
        view.held
          .filter((row) => row.field === "additional_category")
          .map((row) => row.value),
      ),
    [view.held],
  );
  const heldPrimary = view.held.find((row) => row.field === "primary_category") ?? null;

  const dirty =
    description !== view.description ||
    paymentTerms !== (view.paymentTerms ?? "") ||
    primaryId !== view.primary.id ||
    year !== (view.establishedYear?.toString() ?? "") ||
    teamSize !== (view.teamSize ?? "") ||
    languages.join("|") !== view.languages.join("|") ||
    adding.length > 0 ||
    removing.length > 0;

  const byId = useMemo(() => new Map(view.choices.map((row) => [row.id, row])), [view.choices]);

  /**
   * Every chip the seller should see: live, held, and picked-not-yet-saved.
   *
   * The held ones matter most and are the easiest to lose. A category waiting
   * for review is on none of the lists the form reads — it is not on the join
   * yet and it is not a local pick — so building the row from those two alone
   * made an approved-pending chip **disappear** the moment it was submitted,
   * which is criterion 2 exactly backwards: the mark has to be where the field
   * is edited, and a chip that is not drawn cannot carry one.
   */
  const chips = useMemo(() => {
    const kept = view.additional.filter((row) => !removing.includes(row.id));
    const held = view.held
      .filter((row) => row.field === "additional_category")
      .map((row) => byId.get(row.value))
      .filter((row): row is CategoryView => row !== undefined);
    const asked = adding
      .map((id) => byId.get(id))
      .filter((row): row is CategoryView => row !== undefined);
    return [...kept, ...held, ...asked];
  }, [view.additional, view.held, removing, adding, byId]);

  const capReached =
    view.categoryAllowance.remaining !== null &&
    chips.length >= view.categoryAllowance.used + view.categoryAllowance.remaining;

  function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await props.saveAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAdding([]);
      setRemoving([]);
      /*
         The confirmation names both halves, for the same reason the rail card
         does: "Saved" over a screen where one chip is now queued tells the
         seller nothing about the chip.
      */
      setNotice(
        result.held.length > 0
          ? t("listing.saved_with_review", {
              count: result.held.length,
              formatted: formatCount(result.held.length),
            })
          : t("listing.saved"),
      );
      if (result.refused.length > 0) setError(result.refused.join(" "));
    });
  }

  function discard() {
    /*
       Criterion 9. It names how many tabs it throws away, because the edits it
       discards are not all on the tab the seller is looking at.
    */
    if (!window.confirm(t("listing.discard_confirm", { count: TABS.length, formatted: formatCount(TABS.length) }))) {
      return;
    }
    setDescription(view.description);
    setPaymentTerms(view.paymentTerms ?? "");
    setPrimaryId(view.primary.id);
    setYear(view.establishedYear?.toString() ?? "");
    setTeamSize(view.teamSize ?? "");
    setLanguages(view.languages);
    setAdding([]);
    setRemoving([]);
    setError(null);
    setNotice(null);
  }

  return (
    <form onSubmit={onSave} className="flex flex-col gap-[var(--gutter)]">
      {/* ── Header row: the held count, and the two buttons ─────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/*
             Criterion 1: held edits only. A description saved on its own puts
             nothing here — the pill answers "what is someone looking at", and
             the answer to that is often none.
          */}
          {view.held.length > 0 && (
            <StatusBadge tone="warn">
              {t("listing.in_review_count", {
                count: view.held.length,
                formatted: formatCount(view.held.length),
              })}
            </StatusBadge>
          )}
          {!editable && (
            <span className="text-caption text-body">{t("listing.read_only")}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" onClick={discard} disabled={!dirty || pending || !editable}>
            {t("listing.discard")}
          </Button>
          <Button type="submit" disabled={overLimit || pending || !editable || !dirty}>
            {t("listing.save_changes")}
          </Button>
        </div>
      </div>

      {error && <Alert tone="bad" live="assertive">{error}</Alert>}
      {notice && <Alert tone="ok" live="polite">{notice}</Alert>}

      <Tabs
        label={t("listing.tabs")}
        active={tab}
        onChange={(key) => setTab(key as TabKey)}
        items={TABS.map((key) => ({ key, label: t(`listing.tab.${key}` as "listing.tab.basics") }))}
      />

      <div className="flex flex-col gap-[var(--gutter)] xl:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-[17px]">
          {tab === "basics" ? (
            <Basics
              {...props}
              description={description}
              setDescription={setDescription}
              paymentTerms={paymentTerms}
              setPaymentTerms={setPaymentTerms}
              primaryId={primaryId}
              setPrimaryId={setPrimaryId}
              heldPrimary={heldPrimary}
              year={year}
              setYear={setYear}
              teamSize={teamSize}
              setTeamSize={setTeamSize}
              languages={languages}
              setLanguages={setLanguages}
              chips={chips}
              heldCategoryIds={heldCategoryIds}
              adding={adding}
              setAdding={setAdding}
              removing={removing}
              setRemoving={setRemoving}
              capReached={capReached}
              overLimit={overLimit}
            />
          ) : (
            /*
               The other three tabs are routes and shells on this board; their
               contents are separate work. An empty panel that says so is the
               honest version — a tab that silently shows the Basics form would
               be worse, and hiding them would lose the shape of the screen.
            */
            <Panel title={t(`listing.tab.${tab}` as "listing.tab.services")}>
              <p className="max-w-prose text-body-sm text-body">{t("listing.tab_empty")}</p>
            </Panel>
          )}
        </div>

        <ListingRail
          view={view}
          description={description}
          withdrawAction={props.withdrawAction}
          editable={editable}
        />
      </div>
    </form>
  );
}

/* ── Basics ──────────────────────────────────────────────────────────────── */

interface BasicsProps extends ListingWorkspaceProps {
  description: string;
  setDescription: (value: string) => void;
  paymentTerms: string;
  setPaymentTerms: (value: string) => void;
  primaryId: string;
  setPrimaryId: (value: string) => void;
  heldPrimary: HeldEditView | null;
  year: string;
  setYear: (value: string) => void;
  teamSize: string;
  setTeamSize: (value: string) => void;
  languages: string[];
  setLanguages: (value: string[]) => void;
  chips: CategoryView[];
  heldCategoryIds: Set<string>;
  adding: string[];
  setAdding: (value: string[]) => void;
  removing: string[];
  setRemoving: (value: string[]) => void;
  capReached: boolean;
  overLimit: boolean;
}

function Basics(props: BasicsProps) {
  const { view, editable } = props;
  const [picking, setPicking] = useState(false);

  const available = view.choices.filter(
    (row) =>
      row.id !== props.primaryId &&
      !props.chips.some((chip) => chip.id === row.id) &&
      !props.heldCategoryIds.has(row.id),
  );

  return (
    <div className="flex flex-col gap-[17px]">
      {/* Trade name and public URL, neither of them this screen's to change. */}
      <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-ink">
            {t("listing.trade_name")}{" "}
            <span className="text-caption text-body">{t("listing.licence_locked")}</span>
          </span>
          {/* The one field here that is not the display name. Disabled, because
              it changes with the licence, on 3e. */}
          <Input value={view.tradeName /* licence-locked */} disabled readOnly />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-ink">{t("listing.public_url")}</span>
          {/*
             Read-only here, and deliberately.

             The spec puts slug editing on the `SEO & slug` tab and puts that
             tab's contents out of scope for this board, and docs/routes.md
             holds a slug immutable once published. A writable field with no
             redirect behind it turns every bookmarked address into a 404, so
             this states where it changes rather than offering a control that
             would either refuse or break something.
          */}
          <Input value={`/b/${view.slug}`} disabled readOnly />
          <span className="text-caption text-body">{t("listing.public_url_hint")}</span>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-body-sm text-ink">{t("listing.description")}</span>
          <span
            className={`font-mono text-caption tabular-nums ${props.overLimit ? "text-warn-ink" : "text-body"}`}
          >
            {t("listing.counter", {
              used: formatCount(props.description.length),
              limit: formatCount(DESCRIPTION_LIMIT),
            })}
          </span>
        </span>
        <Textarea
          name="description"
          rows={5}
          value={props.description}
          disabled={!editable}
          onChange={(event) => props.setDescription(event.target.value)}
        />
        {props.overLimit && (
          <span className="text-caption text-warn-ink">
            {t("listing.over_limit", { limit: formatCount(DESCRIPTION_LIMIT) })}
          </span>
        )}
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-body-sm text-ink">{t("listing.primary_category")}</span>
            {props.heldPrimary && (
              <span className="rounded-chip bg-warn-wash px-1.5 py-px font-mono text-eyebrow uppercase tracking-eyebrow text-warn-ink">
                {t("listing.in_review")}
              </span>
            )}
          </span>
          <Select
            name="primaryCategoryId"
            value={props.primaryId}
            disabled={!editable}
            onChange={(event) => props.setPrimaryId(event.target.value)}
            options={view.choices.map((row) => ({
              value: row.id,
              label: row.parentName ? `${row.parentName} → ${row.name}` : row.name,
            }))}
          />
          <span className="text-caption text-body">{t("listing.primary_reviewed")}</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-ink">{t("listing.payment_terms")}</span>
          <Input
            name="paymentTerms"
            value={props.paymentTerms}
            disabled={!editable}
            maxLength={160}
            onChange={(event) => props.setPaymentTerms(event.target.value)}
          />
          <span className="text-caption text-body">{t("listing.payment_terms_hint")}</span>
        </label>
      </div>

      {/* ── Additional categories ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="text-body-sm text-ink">{t("listing.also_list_under")}</span>
          <span className="text-caption text-body">
            {t("listing.also_list_meta", {
              count: props.chips.length,
              formatted: formatCount(props.chips.length),
            })}
          </span>
        </span>

        <div className="flex flex-wrap items-center gap-2">
          {props.chips.map((chip) => {
            /*
               Three states, not two, and the difference is whether anybody is
               actually looking at it.

               `IN REVIEW` is amber and means a request exists in the queue.
               A chip the seller has just picked is **not** in review — nothing
               has been submitted yet — so it says so in neutral and changes to
               amber when the save goes through. Marking an unsaved pick as "in
               review" would be the same class of untruth as the header count
               this board exists to fix.
            */
            const held = props.heldCategoryIds.has(chip.id);
            const unsaved = props.adding.includes(chip.id);
            return (
              <span
                key={chip.id}
                className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-caption ${
                  held
                    ? "border-warn-line bg-warn-wash text-warn-ink"
                    : unsaved
                      ? "border-line-strong border-dashed bg-card text-body"
                      : "border-line bg-fill text-ink"
                }`}
              >
                {chip.name}
                {(held || unsaved) && (
                  <span className="font-mono text-eyebrow uppercase tracking-eyebrow">
                    {held ? t("listing.in_review") : t("listing.not_saved")}
                  </span>
                )}
                {editable && (
                  <button
                    type="button"
                    aria-label={t("listing.remove_category", { name: chip.name })}
                    className="rounded-pill px-1 text-body hover:text-ink focus-visible:outline-none focus-visible:shadow-focus"
                    onClick={() => {
                      if (unsaved) {
                        props.setAdding(props.adding.filter((id) => id !== chip.id));
                      } else {
                        props.setRemoving([...props.removing, chip.id]);
                      }
                    }}
                  >
                    ×
                  </button>
                )}
              </span>
            );
          })}

          {editable && !props.capReached && available.length > 0 && (
            <Select
              aria-label={t("listing.add_category")}
              value=""
              onChange={(event) => {
                if (event.target.value) props.setAdding([...props.adding, event.target.value]);
              }}
              options={[
                { value: "", label: t("listing.add_category") },
                ...available.map((row) => ({ value: row.id, label: row.name })),
              ]}
            />
          )}
        </div>

        {props.capReached && (
          <span className="text-caption text-body">
            {t("listing.category_cap", {
              cap: formatCount(view.categoryAllowance.cap ?? 0),
              plan: view.planName,
            })}
          </span>
        )}

        {/* The form posts intent, not state: what to ask for and what to drop. */}
        {props.adding.map((id) => (
          <input key={`add-${id}`} type="hidden" name="addCategory" value={id} />
        ))}
        {props.removing.map((id) => (
          <input key={`remove-${id}`} type="hidden" name="removeCategory" value={id} />
        ))}
      </div>

      <PhotoPicker
        picked={view.photos.picked}
        libraryCount={view.photos.libraryCount}
        library={props.library}
        editable={editable}
        open={picking}
        setOpen={setPicking}
        unpickAction={props.unpickAction}
        pickAction={props.pickAction}
        coverAction={props.coverAction}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-ink">{t("listing.established")}</span>
          <Input
            name="establishedYear"
            inputMode="numeric"
            value={props.year}
            disabled={!editable}
            onChange={(event) => props.setYear(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-body-sm text-ink">{t("listing.team_size")}</span>
          <Select
            name="teamSize"
            value={props.teamSize}
            disabled={!editable}
            onChange={(event) => props.setTeamSize(event.target.value)}
            options={[
              { value: "", label: t("listing.team_size_none") },
              ...TEAM_SIZES.map((band) => ({
                value: band,
                label: t(`listing.team.${band}` as "listing.team.b1_10"),
              })),
            ]}
          />
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-body-sm text-ink">{t("listing.languages")}</legend>
          <div className="flex flex-wrap gap-1.5">
            {LANGUAGES.map((language) => {
              const on = props.languages.includes(language);
              return (
                <label
                  key={language}
                  className={`cursor-pointer rounded-pill border px-2 py-0.5 text-caption ${
                    on ? "border-moss bg-moss-wash text-moss-deep" : "border-line bg-card text-body"
                  }`}
                >
                  <input
                    type="checkbox"
                    name="language"
                    value={language}
                    checked={on}
                    disabled={!editable}
                    className="sr-only"
                    onChange={(event) =>
                      props.setLanguages(
                        event.target.checked
                          ? [...props.languages, language]
                          : props.languages.filter((value) => value !== language),
                      )
                    }
                  />
                  {language}
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>
    </div>
  );
}
