import { applyOverlay, countFilled, primarySize, toSpecRows, type TemplateField } from "@/lib/spec";
import type { SpecRow } from "@/components/domain";

/**
 * The spec table a buyer reads, composed once.
 *
 * Board 3g renders a preview captioned "spec table as buyers see it", and the
 * only way that caption stays true is if the preview and the page are the same
 * code rather than two implementations of the same intention. `DN100 · 4 inch`
 * is a unit conversion; a second copy of it here would drift from the page it
 * claims to preview, and the drift would be invisible until a buyer and a
 * seller compared screens.
 *
 * ## No server-only marker, deliberately
 *
 * The editor recomputes these rows in the browser as the seller types, so this
 * module has to be importable from a client component. Everything it touches —
 * lib/spec.ts, lib/format, components/domain — is already client-safe. The
 * queries that feed it live in ./buyer-preview.ts, which is `server-only`, and
 * the split is the whole point: one file holding both would pull Prisma into
 * the browser bundle, which typecheck and lint allow and only `next build`
 * catches.
 *
 * ## Empty rows stay
 *
 * One row per template field, filled or not. Board 3g's §5 asks for empties to
 * be omitted; CLAUDE.md's interface-honesty rule says the opposite in so many
 * words — "unfilled spec rows render grey reading 'Not provided', never hidden
 * … the seller sees the same grey rows in their editor" — and board 1g's own
 * acceptance criterion agrees, as does every test pinning it. The project rule
 * wins. What the handoff was actually complaining about was the tone those rows
 * were rendered in, and that is fixed where it lives, in `SpecTable`.
 */
export interface PreviewRows {
  /** One per template field, in the seller's order, empties included. */
  rows: SpecRow[];
  /** Fields carrying a value. Not a row count — every field is a row. */
  filled: number;
  total: number;
  /** The size token for a card, where the template has a size field. */
  primary: string | undefined;
  /** The overlaid fields, for callers that need more than the rows. */
  fields: TemplateField[];
}

export function previewRows(
  fields: readonly TemplateField[],
  overlay: Record<string, { label?: string; sortOrder?: number }> | null | undefined,
  specValues: unknown,
): PreviewRows {
  const overlaid = applyOverlay(fields, overlay);
  return {
    rows: toSpecRows(overlaid, specValues),
    filled: countFilled(overlaid, specValues),
    total: overlaid.length,
    primary: primarySize(overlaid, specValues),
    fields: overlaid,
  };
}
