"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/display";
import { Toggle } from "@/components/primitives";
import { t, type MessageKey } from "@/lib/i18n";
import type { CategoryEditor } from "@/lib/taxonomy/board";
import type { VisibilityField } from "@/lib/taxonomy/write";
import { switchAction } from "./actions";
import { TaxonomyDialog } from "./TaxonomyDialog";

/**
 * Board 4d — where a category shows, and what it asks of a seller.
 *
 * **B3: one boolean per public surface.** The home grid and the category index
 * are different pages with different rules, and conflating them is what drew
 * the duplicate fan-out toggle on the first export.
 *
 * The home grid is a row with no switch. `6h` made that rail compute — every
 * sector with listings, by listing count — and the owner's call on this board
 * was that the editor says what the rail decided rather than offering a control
 * that argues with it. The answer is read from the rail's own reader.
 *
 * The other three are toggles, and a toggle applies immediately (§02). A staff
 * state change carries a written reason, so flipping one opens the reason at
 * the moment of the flip, and the switch shows pending until the server agrees.
 */

const FIELDS: readonly VisibilityField[] = ["showInIndex", "acceptsRfq", "requiresExtraCheck"];

/** The line under a switch, where the switch alone does not tell the whole truth. */
function noteFor(editor: CategoryEditor, field: VisibilityField): string | null {
  if (field === "showInIndex") {
    if (editor.index === "no_listings") return t("taxonomy.visibility.note.no_listings");
    if (editor.index === "sector_hidden") return t("taxonomy.visibility.note.sector_hidden", { sector: editor.parent?.name ?? "" });
    return null;
  }
  if (field === "requiresExtraCheck" && editor.parent?.requiresExtraCheck && !editor.requiresExtraCheck) {
    return t("taxonomy.visibility.note.extra_by_sector", { sector: editor.parent.name });
  }
  return null;
}

export function VisibilityPanel({
  editor,
  canWrite,
  sectorAcceptsRfq,
  landmark = true,
}: {
  editor: CategoryEditor;
  canWrite: boolean;
  /** Null on a sector. */
  sectorAcceptsRfq: boolean | null;
  /** Off in the gallery, where several specimens would each claim a region. */
  landmark?: boolean;
}) {
  const Frame = landmark ? "section" : "div";
  const router = useRouter();
  const [asking, setAsking] = useState<{ field: VisibilityField; value: boolean } | null>(null);
  const [pending, setPending] = useState<{ field: VisibilityField; value: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  /*
     The switch holds its new position until the refreshed record agrees, so it
     does not snap back for the moment between the save and the re-render.
  */
  if (pending && editor[pending.field] === pending.value) setPending(null);

  const valueOf = (field: VisibilityField) =>
    pending?.field === field ? pending.value : editor[field];

  const homeLine =
    editor.onHomeGrid === null
      ? t("taxonomy.visibility.home.subcategory")
      : editor.onHomeGrid
        ? t("taxonomy.visibility.home.on")
        : t("taxonomy.visibility.home.off");

  return (
    <Frame aria-labelledby={landmark ? `visibility-${editor.id}` : undefined} className="rounded-panel border border-line bg-card p-5">
      <h3 id={`visibility-${editor.id}`} className="font-mono text-eyebrow uppercase text-muted">
        {t("taxonomy.visibility.title")}
      </h3>

      <ul className="mt-3 flex flex-col divide-y divide-line">
        <li className="flex items-start justify-between gap-4 py-3">
          <div className="min-w-0">
            <p className="text-body-sm text-ink">{t("taxonomy.visibility.home.label")}</p>
            <p className="mt-0.5 text-caption text-body">{t("taxonomy.visibility.home.note")}</p>
          </div>
          <span className="shrink-0 text-body-sm text-ink">{homeLine}</span>
        </li>

        {FIELDS.map((field) => {
          const note =
            field === "acceptsRfq" && sectorAcceptsRfq === false
              ? t("taxonomy.visibility.note.rfq_by_sector", { sector: editor.parent?.name ?? "" })
              : noteFor(editor, field);
          return (
            <li key={field} className="py-3">
              <Toggle
                checked={valueOf(field)}
                disabled={!canWrite || pending !== null}
                pending={pending?.field === field}
                label={t(`taxonomy.visibility.${field}.label` as MessageKey)}
                {...(note ? { description: note } : {})}
                onChange={(value) => {
                  setMessage(null);
                  setAsking({ field, value });
                }}
              />
            </li>
          );
        })}
      </ul>

      {!canWrite ? <p className="mt-2 text-caption text-body">{t("taxonomy.visibility.read_only")}</p> : null}
      {message ? (
        <div className="mt-3">
          <Alert tone="ok" live="polite">
            {message}
          </Alert>
        </div>
      ) : null}

      {asking ? (
        <TaxonomyDialog
          open
          onClose={() => setAsking(null)}
          title={t(`taxonomy.visibility.${asking.field}.${asking.value ? "on" : "off"}.title` as MessageKey, { name: editor.name })}
          description={t(`taxonomy.visibility.${asking.field}.${asking.value ? "on" : "off"}.body` as MessageKey, {
            count: editor.demand.listings,
          })}
          confirmLabel={t(`taxonomy.visibility.${asking.field}.${asking.value ? "on" : "off"}.confirm` as MessageKey)}
          size="sm"
          onSubmit={async (reason) => {
            const form = new FormData();
            form.set("categoryId", editor.id);
            form.set("field", asking.field);
            form.set("value", asking.value ? "on" : "off");
            form.set("reason", reason);
            setPending(asking);
            const outcome = await switchAction(form);
            if (!outcome.ok) setPending(null);
            return outcome;
          }}
          onDone={(text) => {
            setAsking(null);
            setMessage(text);
            router.refresh();
          }}
        />
      ) : null}
    </Frame>
  );
}
