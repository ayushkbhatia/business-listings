import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../axe";
import { SpecGrid, type Scope } from "@/app/(dashboard)/dashboard/products/[id]/SpecGrid";
import type { EditorField } from "@/app/(dashboard)/dashboard/products/[id]/fields";

/**
 * Board 3g's field grid, and the invariants a later change could break quietly.
 *
 * The one worth stating: the scope chips **hide** fields rather than unmounting
 * them, because `mergeSpecValues` clears a stored value only for a field that
 * posted its `spec.present` marker and came back empty. Unmount and the marker
 * goes with the field — safe against deletion, and silently discarding whatever
 * the seller typed under the previous chip.
 */

const field = (over: Partial<EditorField> = {}): EditorField => ({
  fieldId: "f1",
  label: "Bore size",
  platformLabel: "Nominal diameter",
  unit: "DN",
  type: "select",
  options: ["DN50", "DN100"],
  facet: "platform",
  own: false,
  detached: false,
  requiredNow: false,
  value: "",
  ...over,
});

const FIELDS: EditorField[] = [
  field({ fieldId: "f1", label: "Bore size", value: "DN100" }),
  field({ fieldId: "f2", label: "Working pressure", options: ["PN16"], value: "", requiredNow: true }),
  field({ fieldId: "f3", label: "End connection", facet: "not_a_facet", options: [], type: "text", value: "Flanged" }),
  field({ fieldId: "f4", label: "Warranty", facet: "yours_only", own: true, options: [], type: "text", value: "" }),
];

/** The grid with the state its parent owns, so a chip change re-renders it. */
function Harness({ fields = FIELDS }: { fields?: EditorField[] }) {
  const [scope, setScope] = useState<Scope>("all");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.fieldId, f.value])),
  );
  return (
    <form>
      <SpecGrid
        fields={fields}
        values={values}
        onChange={(id, value) => setValues((v) => ({ ...v, [id]: value }))}
        scope={scope}
        onScope={setScope}
        fieldDomId={(id) => `spec-${id}`}
      />
    </form>
  );
}

const markers = (container: HTMLElement) =>
  container.querySelectorAll('input[name="spec.present"]');
const wrappers = (container: HTMLElement) =>
  [...container.querySelectorAll("div")].filter((el) =>
    el.querySelector(':scope > input[name="spec.present"]'),
  );

describe("every field the template carries", () => {
  it("renders one control and one marker per field", () => {
    /*
       Criterion 1. The board this came from showed twelve fields while its
       completeness card counted twenty-two and named four missing: one gap
       visible, four claimed, and nothing saying ten more existed.
    */
    const { container } = render(<Harness />);
    expect(markers(container)).toHaveLength(FIELDS.length);
    expect(wrappers(container)).toHaveLength(FIELDS.length);
  });

  it("keeps the template's order", () => {
    // Criterion 2, and the reason the gaps are not floated to the top: the
    // preview rail beside this renders the same fields in the same order, and
    // that correspondence is what makes the preview worth its 400px.
    const { container } = render(<Harness />);
    const labels = [...container.querySelectorAll("label")].map(
      (el) => el.textContent?.split("·")[0]?.trim().replace(/(FILTER|VARIES|Required|Empty|Yours only).*/, "").trim(),
    );
    expect(labels.slice(0, 4)).toEqual(["Bore size", "Working pressure", "End connection", "Warranty"]);
  });
});

describe("the scope chips", () => {
  it("are a radiogroup, and label each option with its own count", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup");
    const options = within(group).getAllByRole("radio").map((r) => r.textContent?.trim());
    // 4 fields, 2 gaps (Working pressure, Warranty), 2 platform facets.
    expect(options).toEqual(["All 4", "Gaps 2", "Filterable 2"]);
  });

  it("hides the fields it scopes out and keeps every one mounted", () => {
    /*
       The data-safety invariant, stated as an assertion.

       A hidden field still posts its marker and its value, so an edit made
       under one chip survives a save made under another. This is the thing to
       check before "optimising" the `hidden` attribute into a filtered map.
    */
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Gaps 2" }));

    const all = wrappers(container);
    expect(all).toHaveLength(4);
    expect(all.filter((el) => el.hidden)).toHaveLength(2);
    expect(markers(container)).toHaveLength(4);
    expect(container.querySelectorAll('[name^="spec."]:not([name="spec.present"])')).toHaveLength(4);
  });

  it("does not lose an edit made under a different chip", () => {
    const { container } = render(<Harness />);
    const input = container.querySelector<HTMLInputElement>("#spec-f3")!;
    fireEvent.change(input, { target: { value: "Threaded" } });
    fireEvent.click(screen.getByRole("radio", { name: "Filterable 2" }));

    const hiddenValue = container.querySelector<HTMLInputElement>("#spec-f3")!;
    expect(hiddenValue.value).toBe("Threaded");
  });

  it("says so rather than rendering nothing when a group is empty", () => {
    const filled = FIELDS.map((f) => ({ ...f, value: "x" }));
    render(<Harness fields={filled} />);
    fireEvent.click(screen.getByRole("radio", { name: "Gaps 0" }));
    expect(screen.getByText("No field is in this group.")).toBeTruthy();
  });
});

describe("field state, and never by colour alone", () => {
  it("badges a facet FILTER and a seller's own field YOURS ONLY", () => {
    /*
       Criterion 3, in the shape a component can assert: the badge reads
       `facet`, not `isFilterable`. The two differ for a detached field, and a
       badge that cannot tell "the platform does not filter on this" from "this
       is yours alone" is how a board's badges come to disagree with the facet
       set they are supposed to be showing.
    */
    render(<Harness />);
    expect(screen.getAllByText("FILTER")).toHaveLength(2);
    expect(screen.getAllByText("Yours only")).toHaveLength(1);
  });

  it("gives every gap a word, not just a border", () => {
    // Criterion 15. Remove the colour and the state must survive.
    render(<Harness />);
    expect(screen.getAllByText("Empty")).toHaveLength(2);
  });

  it("puts the reason beneath the field and never in the placeholder", () => {
    /*
       Criterion 13. The board put its most important sentence inside the empty
       input, where it vanishes the moment the seller clicks the field it is
       arguing about — and rendered it in the least legible tone on the screen.
    */
    const { container } = render(<Harness />);
    const placeholders = [...container.querySelectorAll("[placeholder]")].map((el) =>
      el.getAttribute("placeholder"),
    );
    for (const placeholder of placeholders) {
      expect(placeholder ?? "").not.toMatch(/not in that filter|shows on your product page|spec table/i);
    }

    const control = container.querySelector("#spec-f2")!;
    const describedBy = control.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`#${CSS.escape(describedBy!)}`)?.textContent).toMatch(
      /not in that filter/i,
    );
  });

  it("gives a filterable gap a different reason from one nobody filters on", () => {
    const { container } = render(<Harness />);
    const facetReason = container.querySelector(
      `#${CSS.escape(container.querySelector("#spec-f2")!.getAttribute("aria-describedby")!)}`,
    )?.textContent;
    const ownReason = container.querySelector(
      `#${CSS.escape(container.querySelector("#spec-f4")!.getAttribute("aria-describedby")!)}`,
    )?.textContent;
    expect(facetReason).toMatch(/not in that filter/i);
    expect(ownReason).toMatch(/your own field/i);
    expect(facetReason).not.toBe(ownReason);
  });
});

describe("an empty field posts nothing", () => {
  it("does not post the first option of a select the seller never touched", () => {
    /*
       The defect this exists to stop coming back, and it was live.

       A `<select>` whose value matches no option falls back to index 0, so an
       unfilled field displayed "DN50" and its FormData entry was "DN50". A
       seller opening a product they had never described and pressing Save would
       have written a nominal size, a body material and an end connection they
       never chose — onto a public page, and into the facet index every buyer
       filters on. Invented specification data is the worst thing this screen
       could produce, and it looked entirely normal in a screenshot.

       The empty option is what makes an empty select actually empty.
    */
    const { container } = render(<Harness />);
    const form = container.querySelector("form")!;

    const posted = [...new FormData(form).entries()].filter(
      ([key]) => key.startsWith("spec.") && key !== "spec.present",
    );
    const byName = Object.fromEntries(posted);

    // f2 and f4 are the gaps in the fixture. Both must post nothing.
    expect(byName["spec.f2"]).toBe("");
    expect(byName["spec.f4"]).toBe("");

    // And every select shows its empty option rather than its first value.
    for (const select of container.querySelectorAll("select")) {
      if (select.value === "") {
        expect(select.options[select.selectedIndex]?.disabled).toBe(true);
      }
    }
  });

  it("posts what the seller chose, once they choose", () => {
    const { container } = render(<Harness />);
    const select = container.querySelector<HTMLSelectElement>("#spec-f2")!;
    fireEvent.change(select, { target: { value: "PN16" } });

    const byName = Object.fromEntries(new FormData(container.querySelector("form")!).entries());
    expect(byName["spec.f2"]).toBe("PN16");
  });
});

describe("a template with one field", () => {
  it("renders it, rather than a two-column grid with a hole", () => {
    const { container } = render(<Harness fields={[field()]} />);
    expect(markers(container)).toHaveLength(1);
    // The two-column rule is a `min-[1440px]:` class, so the single-column
    // default is what a narrower viewport and this test both get.
    expect(container.querySelector(".grid")?.className).toContain("grid-cols-1");
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    // `color-contrast` is disabled by the helper: jsdom has no layout, so the
    // ratios are measured by `pnpm check:contrast` and recorded in
    // docs/contrast.md instead.
    const { container } = render(<Harness />);
    await expectNoAxeViolations(container);
  });

  it("has no axe violations with a group scoped away", async () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "Gaps 2" }));
    await expectNoAxeViolations(container);
  });
});
