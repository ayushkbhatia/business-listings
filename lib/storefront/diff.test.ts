import { describe, expect, it } from "vitest";
import { diffTemplate, hasChanges, type TemplateNow, type TemplateSnapshot } from "./diff";
import type { SectionRow } from "./sections";

/**
 * Board 5e's unpublished-changes list, and the half of criterion 1 that a count
 * alone does not satisfy.
 *
 * A confirm that says "1,842 stores will change" without saying how is a number
 * somebody clicks past. These are the sentences that go beside it.
 */

const section = (over: Partial<SectionRow> & { id: string; type: string }): SectionRow => ({
  sortOrder: 0,
  enabled: true,
  fixed: false,
  singleton: false,
  sellerEditableFields: [],
  showOnMobile: true,
  settings: {},
  ...over,
});

const base: TemplateNow = {
  name: "Industrial",
  sections: [
    section({ id: "h", type: "header", sortOrder: 0, fixed: true, singleton: true }),
    section({ id: "hero", type: "hero", sortOrder: 1, sellerEditableFields: ["headline"] }),
    section({ id: "rev", type: "reviews", sortOrder: 2 }),
  ],
  defaultTheme: "industrial",
  offeredThemes: ["industrial", "mono"],
  allowCustomHex: false,
  typePairing: "clean",
  cornerRadius: 6,
  density: "comfortable",
  darkHeader: false,
  badgeRemovable: false,
};

const snapshotOf = (over: Partial<TemplateSnapshot> = {}): TemplateSnapshot => ({
  name: base.name,
  sections: base.sections.map((s) => ({ ...s })),
  theme: {
    defaultTheme: base.defaultTheme,
    offeredThemes: [...base.offeredThemes],
    allowCustomHex: base.allowCustomHex,
    typePairing: base.typePairing,
    cornerRadius: base.cornerRadius,
    density: base.density,
    darkHeader: base.darkHeader,
    badgeRemovable: base.badgeRemovable,
  },
  ...over,
});

describe("nothing to say", () => {
  it("finds no changes when nothing changed", () => {
    expect(diffTemplate(snapshotOf(), base)).toEqual([]);
    expect(hasChanges([])).toBe(false);
  });

  it("says it in one line for a template that has never been published", () => {
    // Nineteen lines saying each section was added is not a summary.
    const changes = diffTemplate(null, base);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.labelKey).toBe("diff.first_publish");
    expect(changes[0]!.values.count).toBe("3");
  });
});

describe("sections", () => {
  it("names an added section by its type, not its key", () => {
    const now = {
      ...base,
      sections: [...base.sections, section({ id: "cert", type: "certifications", sortOrder: 3 })],
    };
    const [change] = diffTemplate(snapshotOf(), now);
    expect(change!.labelKey).toBe("diff.section_added");
    expect(change!.values.section).toBe("section.certifications");
    expect(change!.destructive).toBe(false);
  });

  it("calls a removal destructive, because seller content hangs off it", () => {
    const now = { ...base, sections: base.sections.filter((s) => s.id !== "rev") };
    const [change] = diffTemplate(snapshotOf(), now);
    expect(change!.kind).toBe("section_removed");
    expect(change!.destructive).toBe(true);
  });

  it("calls disabling destructive and enabling not", () => {
    const off = {
      ...base,
      sections: base.sections.map((s) => (s.id === "rev" ? { ...s, enabled: false } : s)),
    };
    const [disabled] = diffTemplate(snapshotOf(), off);
    expect(disabled).toMatchObject({ kind: "section_disabled", destructive: true });

    const on = diffTemplate(snapshotOf({ sections: off.sections }), base);
    expect(on[0]).toMatchObject({ kind: "section_enabled", destructive: false });
  });

  it("reports a reorder once, not once per section that shifted", () => {
    /*
     * Dragging the hero below reviews moves both sortOrders. A list saying two
     * sections moved when a person dragged one misrepresents what they did.
     */
    const now = {
      ...base,
      sections: [
        section({ id: "h", type: "header", sortOrder: 0, fixed: true, singleton: true }),
        section({ id: "rev", type: "reviews", sortOrder: 1 }),
        section({ id: "hero", type: "hero", sortOrder: 2, sellerEditableFields: ["headline"] }),
      ],
    };
    const changes = diffTemplate(snapshotOf(), now);
    expect(changes.filter((change) => change.kind === "section_moved")).toHaveLength(1);
    expect(changes).toHaveLength(1);
  });

  it("does not call it a reorder when a section was only added at the end", () => {
    const now = {
      ...base,
      sections: [...base.sections, section({ id: "new", type: "downloads", sortOrder: 3 })],
    };
    const changes = diffTemplate(snapshotOf(), now);
    expect(changes.map((change) => change.kind)).toEqual(["section_added"]);
  });

  it("calls closing a seller field destructive and opening one not", () => {
    const closed = {
      ...base,
      sections: base.sections.map((s) => (s.id === "hero" ? { ...s, sellerEditableFields: [] } : s)),
    };
    const [lost] = diffTemplate(snapshotOf(), closed);
    expect(lost).toMatchObject({ kind: "section_fields_changed", destructive: true });
    expect(lost!.values.lost).toBe("1");

    const opened = {
      ...base,
      sections: base.sections.map((s) =>
        s.id === "hero" ? { ...s, sellerEditableFields: ["headline", "eyebrow"] } : s,
      ),
    };
    const [gained] = diffTemplate(snapshotOf(), opened);
    expect(gained).toMatchObject({ destructive: false });
    expect(gained!.values.gained).toBe("1");
  });
});

describe("theme and settings", () => {
  it("names the theme it changed to", () => {
    const [change] = diffTemplate(snapshotOf(), { ...base, defaultTheme: "trade" });
    expect(change).toMatchObject({ labelKey: "diff.theme_changed" });
    expect(change!.values.theme).toBe("trade");
  });

  it("calls narrowing the offered set destructive and widening it not", () => {
    // Narrowing can strand a seller on a theme they picked and can no longer
    // choose. Widening cannot.
    const narrowed = diffTemplate(snapshotOf(), { ...base, offeredThemes: ["industrial"] });
    expect(narrowed[0]).toMatchObject({ labelKey: "diff.offered_changed", destructive: true });

    const widened = diffTemplate(snapshotOf(), {
      ...base,
      offeredThemes: ["industrial", "mono", "trade"],
    });
    expect(widened[0]).toMatchObject({ destructive: false });
  });

  it("picks the on and off sentence for each flag", () => {
    const [on] = diffTemplate(snapshotOf(), { ...base, darkHeader: true });
    expect(on!.labelKey).toBe("diff.dark_header_on");

    const [off] = diffTemplate(
      snapshotOf({ theme: { ...snapshotOf().theme, badgeRemovable: true } }),
      base,
    );
    expect(off!.labelKey).toBe("diff.badge_removable_off");
  });

  it("notices a rename", () => {
    const [change] = diffTemplate(snapshotOf(), { ...base, name: "Industrial 2026" });
    expect(change).toMatchObject({ labelKey: "diff.renamed" });
    expect(change!.values.name).toBe("Industrial 2026");
  });
});

describe("the order of the list", () => {
  it("puts the destructive changes first", () => {
    /*
     * Somebody reading eleven changes reads the first three. Turning a section
     * off and reordering two are not the same decision, and a list that
     * presents them identically is a list that gets skimmed.
     */
    const now = {
      ...base,
      defaultTheme: "trade",
      sections: [
        section({ id: "h", type: "header", sortOrder: 0, fixed: true, singleton: true }),
        section({ id: "hero", type: "hero", sortOrder: 1, sellerEditableFields: ["headline"] }),
        section({ id: "rev", type: "reviews", sortOrder: 2, enabled: false }),
        section({ id: "new", type: "downloads", sortOrder: 3 }),
      ],
    };
    const changes = diffTemplate(snapshotOf(), now);
    expect(changes[0]!.destructive).toBe(true);
    expect(changes.at(-1)!.destructive).toBe(false);
    expect(hasChanges(changes)).toBe(true);
  });
});
