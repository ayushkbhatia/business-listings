import { describe, expect, it } from "vitest";
import { diffOverlay, newlyRequired } from "./template-changes";

/**
 * Board 3h §8 — what applying a change costs, stated per change.
 *
 * The board had one button. These are the three answers it was hiding: a
 * repaint, a flag, and nothing at all.
 */

const naming = [
  { fieldId: "f1", base: "Size", basePosition: 0 },
  { fieldId: "f2", base: "Body material", basePosition: 1 },
];

const empty = { mappings: {}, ownFields: [] };

describe("diffing an overlay", () => {
  it("calls a rename a republish and names both labels", () => {
    const changes = diffOverlay(empty, { mappings: { f1: { label: "Nominal size" } }, ownFields: [] }, naming);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "renamed",
      from: "Size",
      label: "Nominal size",
      blast: "republish",
    });
  });

  it("calls a reorder display-only, because that is all it is", () => {
    const changes = diffOverlay(empty, { mappings: { f1: { sortOrder: 3 } }, ownFields: [] }, naming);
    expect(changes[0]).toMatchObject({ kind: "reordered", blast: "display_only" });
  });

  it("reports no move when the field ends up where it already was", () => {
    /*
       Dropping a redundant override — a `sortOrder: 0` on a field the platform
       already puts first — moves nothing. Comparing whether an override exists
       rather than where the field lands put a phantom "Moved" in front of a
       seller beside their one real change.
    */
    const changes = diffOverlay(
      { mappings: { f1: { sortOrder: 0 } }, ownFields: [] },
      { mappings: {}, ownFields: [] },
      naming,
    );
    expect(changes).toEqual([]);
  });

  it("calls a new requirement a flag, never a delist", () => {
    /*
       §5's whole argument in one property. A requirement flags the gap and
       blocks the next save; it never takes a product down, so the radius is the
       count missing the field rather than the count that would come down.
    */
    const changes = diffOverlay(empty, { mappings: { f2: { required: true } }, ownFields: [] }, naming);
    expect(changes[0]).toMatchObject({ kind: "required_on", blast: "flag" });
    expect(newlyRequired(changes)).toEqual(["f2"]);
  });

  it("says nothing about a requirement being lifted", () => {
    // The one edit here that can only make a catalogue more valid. It removes
    // flags and blocks nothing, so there is no consequence to warn about.
    const changes = diffOverlay(
      { mappings: { f2: { required: true } }, ownFields: [] },
      { mappings: {}, ownFields: [] },
      naming,
    );
    expect(changes).toEqual([]);
  });

  it("treats detaching as its own change, not as a rename", () => {
    const changes = diffOverlay(
      empty,
      { mappings: { f1: { label: "Bore", detached: true } }, ownFields: [] },
      naming,
    );
    expect(changes.map((c) => c.kind).sort()).toEqual(["detached", "renamed"]);
  });

  it("ignores a mapping key for a field the template no longer carries", () => {
    // An orphan key from a platform field that has been removed. It is not on
    // screen, and applying changes nothing a seller can see.
    const changes = diffOverlay(empty, { mappings: { gone: { label: "X" } }, ownFields: [] }, naming);
    expect(changes).toEqual([]);
  });

  it("reports a seller's own field being added and removed", () => {
    const own = {
      id: "own1",
      label: "Warranty",
      type: "text",
      unit: "months",
      options: [],
      required: false,
      sortOrder: 9,
    };
    expect(diffOverlay(empty, { mappings: {}, ownFields: [own] }, naming)[0]).toMatchObject({
      kind: "field_added",
      label: "Warranty",
    });
    expect(diffOverlay({ mappings: {}, ownFields: [own] }, empty, naming)[0]).toMatchObject({
      kind: "field_removed",
      blast: "republish",
    });
  });

  it("is stable between renders, so a list does not reshuffle while it is read", () => {
    const draft = {
      mappings: { f2: { label: "Material" }, f1: { sortOrder: 1 } },
      ownFields: [],
    };
    const once = diffOverlay(empty, draft, naming).map((c) => `${c.fieldId}:${c.kind}`);
    const twice = diffOverlay(empty, draft, naming).map((c) => `${c.fieldId}:${c.kind}`);
    expect(once).toEqual(twice);
    expect(once).toEqual(["f1:reordered", "f2:renamed"]);
  });

  it("finds nothing between two identical overlays", () => {
    const overlay = { mappings: { f1: { label: "Size" } }, ownFields: [] };
    expect(diffOverlay(overlay, overlay, naming)).toEqual([]);
  });
});
