import { t } from "@/lib/i18n";
import { Actions } from "./_sections/Actions";
import { Choice } from "./_sections/Choice";
import { Numeric } from "./_sections/Numeric";
import { TextEntry } from "./_sections/TextEntry";
import { Tokens } from "./_sections/Tokens";
import { Upload } from "./_sections/Upload";

/**
 * The acceptance surface for handoff 0. Every tier 1 and tier 2 component, in
 * every documented state, per handoffs/handoff-0-foundation/README.md §1.
 *
 * Hover and focus are pinned with data-force rather than imitated — see the
 * custom variants at the top of globals.css. A gallery that hand-copies a
 * hover style is a gallery that lies the first time the variant changes.
 */
export const metadata = { title: "Gallery — Business Listings" };

const TIER_1 = [
  "button",
  "icon-button",
  "split-button",
  "segmented-control",
  "input",
  "textarea",
  "select",
  "multi-select",
  "search-field",
  "checkbox",
  "radio",
  "toggle",
  "range-slider",
  "stepper",
  "time-pair",
  "file-drop",
  "label",
  "field-error",
] as const;

export default function Gallery() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <p className="font-mono text-eyebrow uppercase text-faint">component gallery</p>
      <h1 className="mt-2 font-serif text-h1-serif text-ink">Business Listings</h1>

      <div className="mt-6 rounded-card border border-line bg-card p-4">
        <table className="w-full border-collapse">
          <caption className="sr-only">{t("gallery.build_state")}</caption>
          <thead>
            <tr className="bg-paper-sunk">
              <th scope="col" className="px-3 py-1.5 text-left font-mono text-colhead uppercase text-muted">
                tier
              </th>
              <th scope="col" className="px-3 py-1.5 text-right font-mono text-colhead uppercase text-muted">
                built
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line">
              <td className="px-3 py-1.5 font-mono text-body-sm text-body">tier-1-primitives</td>
              <td className="px-3 py-1.5 text-right font-mono text-body-sm text-ok-ink">
                {TIER_1.length}/18
              </td>
            </tr>
            <tr className="border-t border-line">
              <td className="px-3 py-1.5 font-mono text-body-sm text-body">tier-2-structure</td>
              <td className="px-3 py-1.5 text-right font-mono text-body-sm text-muted">0/17</td>
            </tr>
            <tr className="border-t border-line">
              <td className="px-3 py-1.5 font-mono text-body-sm text-body">shells</td>
              <td className="px-3 py-1.5 text-right font-mono text-body-sm text-muted">0/4</td>
            </tr>
          </tbody>
        </table>

        <nav aria-label={t("gallery.jump_to")} className="mt-4 flex flex-wrap gap-1.5">
          {TIER_1.map((id) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-chip border border-line bg-paper-sunk px-2 py-0.5 font-mono text-eyebrow text-muted transition-colors duration-120 ease-out hover:border-moss hover:text-moss focus-visible:outline-none focus-visible:shadow-focus"
            >
              {id}
            </a>
          ))}
        </nav>
      </div>

      <Actions />
      <TextEntry />
      <Choice />
      <Numeric />
      <Upload />
      <Tokens />
    </main>
  );
}
