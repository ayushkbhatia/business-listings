import { describe, expect, it } from "vitest";
import {
  applyDraft,
  diffDraft,
  isEmptyDraft,
  readDraft,
  EMPTY_DRAFT,
  type LiveField,
  type TemplateDraft,
} from "./changes";

/**
 * Board 4e's draft diff.
 *
 * The assertion that matters most is the one that is absent from `ChangeKind`:
 * there is no change kind that requires a field, because publishing a version
 * cannot put an existing product in violation of its template. Requiring is a
 * separate action with its own review, and the test that guards it is the one
 * asserting no published change ever carries the `flag` radius.
 */

function field(id: string, over: Partial<LiveField> = {}): LiveField {
  return {
    id,
    key: id,
    label: id,
    unit: null,
    options: [],
    isFilterable: false,
    variesByVariant: false,
    sortOrder: 0,
    ...over,
  };
}

const draft = (over: Partial<TemplateDraft> = {}): TemplateDraft => ({
  ...EMPTY_DRAFT,
  added: [],
  removed: [],
  edited: {},
  ...over,
});

describe("diffDraft", () => {
  const live = [
    field("bore", { label: "Bore", sortOrder: 0, isFilterable: true }),
    field("pressure", { label: "Pressure rating", sortOrder: 1, unit: "bar" }),
  ];

  it("reports nothing for an empty draft", () => {
    expect(diffDraft(live, draft())).toEqual([]);
  });

  it("never produces a change that flags a product", () => {
    const every = diffDraft(live, {
      added: [
        {
          key: "cv",
          label: "Flow coefficient",
          type: "number",
          isFilterable: true,
          variesByVariant: true,
        },
      ],
      removed: ["pressure"],
      edited: {
        bore: {
          label: "Nominal bore",
          sortOrder: 3,
          isFilterable: false,
          variesByVariant: true,
          options: ["DN50"],
          unit: "mm",
        },
      },
    });

    expect(every.length).toBeGreaterThan(0);
    expect(every.every((change) => change.blast !== "flag")).toBe(true);
  });

  it("calls a platform relabel display-only, because no clone changes", () => {
    const changes = diffDraft(live, draft({ edited: { bore: { label: "Nominal bore" } } }));
    expect(changes).toEqual([
      {
        kind: "relabelled",
        fieldId: "bore",
        label: "Nominal bore",
        from: "Bore",
        blast: "display_only",
      },
    ]);
  });

  it("says nothing when an edit restates the live value", () => {
    const changes = diffDraft(
      live,
      draft({ edited: { bore: { label: "Bore", sortOrder: 0, isFilterable: true } } }),
    );
    expect(changes).toEqual([]);
  });

  it("separates turning a facet on from turning one off", () => {
    const on = diffDraft(live, draft({ edited: { pressure: { isFilterable: true } } }));
    const off = diffDraft(live, draft({ edited: { bore: { isFilterable: false } } }));
    expect(on[0]?.kind).toBe("facet_on");
    expect(off[0]?.kind).toBe("facet_off");
    expect(on[0]?.blast).toBe("republish");
  });

  it("reports varies_by_variant, which board 3g reads", () => {
    const changes = diffDraft(live, draft({ edited: { bore: { variesByVariant: true } } }));
    expect(changes[0]).toMatchObject({ kind: "varies_on", fieldId: "bore", blast: "republish" });
  });

  it("ignores an edit against a field the template no longer carries", () => {
    expect(diffDraft(live, draft({ edited: { gone: { label: "Ghost" } } }))).toEqual([]);
  });

  it("ignores a removal of a field that is not there", () => {
    expect(diffDraft(live, draft({ removed: ["gone"] }))).toEqual([]);
  });

  it("names an addition by its staged key, which has no id yet", () => {
    const changes = diffDraft(
      live,
      draft({
        added: [
          { key: "cv", label: "Flow coefficient", type: "number", isFilterable: false, variesByVariant: false },
        ],
      }),
    );
    expect(changes).toEqual([
      { kind: "field_added", fieldId: "cv", label: "Flow coefficient", blast: "republish" },
    ]);
  });

  it("is stable between renders", () => {
    const d = draft({
      edited: { pressure: { label: "Pressure" }, bore: { label: "Bore size" } },
      removed: ["pressure"],
    });
    expect(diffDraft(live, d)).toEqual(diffDraft(live, d));
  });
});

describe("readDraft", () => {
  it("returns an empty draft for anything that is not one", () => {
    for (const raw of [null, undefined, 4, "draft", [], { added: 7 }]) {
      expect(isEmptyDraft(readDraft(raw))).toBe(true);
    }
  });

  it("drops an addition with no key or label", () => {
    const parsed = readDraft({ added: [{ label: "No key" }, { key: "cv", label: "Cv" }] });
    expect(parsed.added.map((f) => f.key)).toEqual(["cv"]);
  });

  it("falls back to text for a type it does not recognise", () => {
    const parsed = readDraft({ added: [{ key: "cv", label: "Cv", type: "colour" }] });
    expect(parsed.added[0]?.type).toBe("text");
  });

  it("keeps a null unit distinct from an absent one", () => {
    const cleared = readDraft({ edited: { bore: { unit: null } } });
    const untouched = readDraft({ edited: { bore: { label: "Bore" } } });
    expect(cleared.edited["bore"]).toEqual({ unit: null });
    expect(untouched.edited["bore"]).not.toHaveProperty("unit");
  });

  it("drops an edit that says nothing", () => {
    expect(readDraft({ edited: { bore: { colour: "red" } } }).edited).toEqual({});
  });
});

describe("applyDraft", () => {
  const live = [
    field("bore", { label: "Bore", sortOrder: 0 }),
    field("pressure", { label: "Pressure rating", sortOrder: 1 }),
  ];

  it("puts an added field after the last one", () => {
    const next = applyDraft(
      live,
      draft({
        added: [
          { key: "cv", label: "Cv", type: "number", isFilterable: false, variesByVariant: false },
        ],
      }),
    );
    expect(next.map((f) => f.key)).toEqual(["bore", "pressure", "cv"]);
  });

  it("keeps the id of every field it carries forward", () => {
    const next = applyDraft(live, draft({ edited: { bore: { label: "Nominal bore" } } }));
    expect(next.find((f) => f.key === "bore")?.id).toBe("bore");
  });

  it("drops a removed field from the platform set", () => {
    const next = applyDraft(live, draft({ removed: ["pressure"] }));
    expect(next.map((f) => f.key)).toEqual(["bore"]);
  });

  it("starts at zero when a draft removes everything and adds one", () => {
    const next = applyDraft(
      live,
      draft({
        removed: ["bore", "pressure"],
        added: [
          { key: "cv", label: "Cv", type: "number", isFilterable: false, variesByVariant: false },
        ],
      }),
    );
    expect(next).toHaveLength(1);
    expect(next[0]?.sortOrder).toBe(0);
  });
});
