import { sectionType } from "./section-types";
import type { SectionRow } from "./sections";

/**
 * What has changed since the last publish, in words.
 *
 * Board 5e asks for the unpublished-changes list as sentences — *"theme changed
 * to Industrial", "hero headline rewritten", "certifications section added"* —
 * and not as a field dump. The reason is criterion 1: publishing requires a
 * confirm naming the affected store count, and a confirm that says "1,842
 * stores will change" without saying **how** is a number somebody clicks past.
 *
 * Pure. It takes the snapshot and the current rows and returns changes; it does
 * not read the database and it does not localise. Each change carries a key and
 * the values, and the screen turns those into a sentence through `t()` — so the
 * wording is translatable and the logic is testable without a DOM.
 */

export type ChangeKind =
  | "section_added"
  | "section_removed"
  | "section_enabled"
  | "section_disabled"
  | "section_moved"
  | "section_fields_changed"
  | "section_mobile_changed"
  | "theme_changed"
  | "setting_changed";

export interface TemplateChange {
  kind: ChangeKind;
  /** Catalogue key for the sentence. */
  labelKey: string;
  /** Interpolations for it. Already strings. */
  values: Record<string, string>;
  /**
   * True where the change removes something a seller may have filled in.
   *
   * The confirm leads with these. Turning a section off is not the same
   * decision as reordering two, and a list that presents them identically is a
   * list that gets skimmed.
   */
  destructive: boolean;
}

export interface TemplateSnapshot {
  name?: string;
  sections: SectionRow[];
  theme?: {
    defaultTheme?: string;
    offeredThemes?: string[];
    allowCustomHex?: boolean;
    typePairing?: string;
    cornerRadius?: number;
    density?: string;
    darkHeader?: boolean;
    badgeRemovable?: boolean;
  };
}

export interface TemplateNow {
  name: string;
  sections: SectionRow[];
  defaultTheme: string;
  offeredThemes: string[];
  allowCustomHex: boolean;
  typePairing: string;
  cornerRadius: number;
  density: string;
  darkHeader: boolean;
  badgeRemovable: boolean;
}

/** The type's own name, so a sentence says "Hero banner" and not "hero". */
function nameOf(typeKey: string): string {
  return sectionType(typeKey)?.labelKey ?? typeKey;
}

function ordered(sections: readonly SectionRow[]): SectionRow[] {
  return [...sections].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

/**
 * Changes between a published snapshot and the template as it stands.
 *
 * Ordered so the destructive ones come first, then additions, then the rest.
 * Somebody reading a list of eleven changes reads the first three.
 */
export function diffTemplate(
  snapshot: TemplateSnapshot | null,
  now: TemplateNow,
): TemplateChange[] {
  const changes: TemplateChange[] = [];

  /*
   * Never published. Everything is new, and saying so in one line is more use
   * than nineteen lines saying each section was added.
   */
  if (!snapshot) {
    return [
      {
        kind: "section_added",
        labelKey: "diff.first_publish",
        values: { count: String(now.sections.filter((section) => section.enabled).length) },
        destructive: false,
      },
    ];
  }

  const before = new Map(snapshot.sections.map((section) => [section.id, section]));
  const after = new Map(now.sections.map((section) => [section.id, section]));

  for (const [id, section] of after) {
    if (!before.has(id)) {
      changes.push({
        kind: "section_added",
        labelKey: "diff.section_added",
        values: { section: nameOf(section.type) },
        destructive: false,
      });
    }
  }

  for (const [id, section] of before) {
    if (!after.has(id)) {
      changes.push({
        kind: "section_removed",
        labelKey: "diff.section_removed",
        values: { section: nameOf(section.type) },
        // Removing a section orphans whatever sellers filled into it.
        destructive: true,
      });
    }
  }

  for (const [id, section] of after) {
    const was = before.get(id);
    if (!was) continue;

    if (was.enabled !== section.enabled) {
      changes.push({
        kind: section.enabled ? "section_enabled" : "section_disabled",
        labelKey: section.enabled ? "diff.section_enabled" : "diff.section_disabled",
        values: { section: nameOf(section.type) },
        destructive: !section.enabled,
      });
    }

    if (was.showOnMobile !== section.showOnMobile) {
      changes.push({
        kind: "section_mobile_changed",
        labelKey: section.showOnMobile ? "diff.mobile_shown" : "diff.mobile_hidden",
        values: { section: nameOf(section.type) },
        destructive: !section.showOnMobile,
      });
    }

    const gained = section.sellerEditableFields.filter(
      (field) => !was.sellerEditableFields.includes(field),
    );
    const lost = was.sellerEditableFields.filter(
      (field) => !section.sellerEditableFields.includes(field),
    );
    if (gained.length > 0 || lost.length > 0) {
      changes.push({
        kind: "section_fields_changed",
        labelKey: "diff.fields_changed",
        values: {
          section: nameOf(section.type),
          gained: String(gained.length),
          lost: String(lost.length),
        },
        // Closing a field a seller had open leaves what they wrote unreachable.
        destructive: lost.length > 0,
      });
    }
  }

  /*
   * Order, as one change and not one per section.
   *
   * Moving the hero above the trust strip shifts every sortOrder below it, and
   * a list saying five sections moved when a person dragged one is a list that
   * misrepresents what they did.
   */
  const beforeOrder = ordered(snapshot.sections)
    .filter((section) => after.has(section.id))
    .map((section) => section.id);
  const afterOrder = ordered(now.sections)
    .filter((section) => before.has(section.id))
    .map((section) => section.id);
  if (beforeOrder.join() !== afterOrder.join()) {
    changes.push({
      kind: "section_moved",
      labelKey: "diff.order_changed",
      values: {},
      destructive: false,
    });
  }

  const theme = snapshot.theme ?? {};

  if (theme.defaultTheme !== undefined && theme.defaultTheme !== now.defaultTheme) {
    changes.push({
      kind: "theme_changed",
      labelKey: "diff.theme_changed",
      values: { theme: now.defaultTheme },
      destructive: false,
    });
  }

  if (
    theme.offeredThemes !== undefined &&
    theme.offeredThemes.join() !== now.offeredThemes.join()
  ) {
    changes.push({
      kind: "theme_changed",
      labelKey: "diff.offered_changed",
      values: { count: String(now.offeredThemes.length) },
      /*
       * Narrowing the offered set can strand a seller on a theme they picked
       * and can no longer choose. Widening it cannot.
       */
      destructive: now.offeredThemes.length < theme.offeredThemes.length,
    });
  }

  const settings: [keyof TemplateNow, string | undefined, string][] = [
    ["typePairing", theme.typePairing, "diff.type_pairing"],
    ["density", theme.density, "diff.density"],
  ];
  for (const [key, was, labelKey] of settings) {
    if (was !== undefined && was !== String(now[key])) {
      changes.push({
        kind: "setting_changed",
        labelKey,
        values: { value: String(now[key]) },
        destructive: false,
      });
    }
  }

  const flags: [keyof TemplateNow, boolean | undefined, string, string][] = [
    ["darkHeader", theme.darkHeader, "diff.dark_header_on", "diff.dark_header_off"],
    ["allowCustomHex", theme.allowCustomHex, "diff.custom_hex_on", "diff.custom_hex_off"],
    ["badgeRemovable", theme.badgeRemovable, "diff.badge_removable_on", "diff.badge_removable_off"],
  ];
  for (const [key, was, onKey, offKey] of flags) {
    const value = Boolean(now[key]);
    if (was !== undefined && was !== value) {
      changes.push({
        kind: "setting_changed",
        labelKey: value ? onKey : offKey,
        values: {},
        destructive: false,
      });
    }
  }

  if (theme.cornerRadius !== undefined && theme.cornerRadius !== now.cornerRadius) {
    changes.push({
      kind: "setting_changed",
      labelKey: "diff.corner_radius",
      values: { value: String(now.cornerRadius) },
      destructive: false,
    });
  }

  if (snapshot.name !== undefined && snapshot.name !== now.name) {
    changes.push({
      kind: "setting_changed",
      labelKey: "diff.renamed",
      values: { name: now.name },
      destructive: false,
    });
  }

  // Destructive first. Somebody reading eleven changes reads the first three.
  return changes.sort((a, b) => Number(b.destructive) - Number(a.destructive));
}

/** Nothing to publish. The button says so rather than writing an empty version. */
export function hasChanges(changes: readonly TemplateChange[]): boolean {
  return changes.length > 0;
}
