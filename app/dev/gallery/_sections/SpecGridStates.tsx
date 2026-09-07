"use client";

import { useState } from "react";
import { SpecGrid, type Scope } from "@/app/(dashboard)/dashboard/products/[id]/SpecGrid";
import type { EditorField } from "@/app/(dashboard)/dashboard/products/[id]/fields";

/**
 * Board 3g's field grid, in the states it is documented to have.
 *
 * One fixture rather than one specimen per state, because the states are not
 * independent: the scope chips reorder which of them are visible, and the
 * interesting thing to look at is a gap sitting in template order beside a
 * filled field rather than sorted to the top.
 *
 * States on screen: filled · empty and filterable (a gap, with its reason) ·
 * empty and not a facet · required and empty · a field the seller invented ·
 * one detached from its platform mapping. The loading and cold-start states
 * belong to the page, not this component — a template with one field is here
 * because the grid is what decides not to draw a two-column hole for it.
 */

const FIELDS: EditorField[] = [
  {
    fieldId: "f1",
    label: "Bore size",
    platformLabel: "Nominal diameter",
    unit: "DN",
    type: "select",
    options: ["DN50", "DN100", "DN150"],
    facet: "platform",
    own: false,
    detached: false,
    requiredNow: true,
    value: "DN100",
  },
  {
    fieldId: "f2",
    label: "Working pressure",
    platformLabel: "Pressure rating",
    unit: null,
    type: "select",
    options: ["PN16", "PN25"],
    facet: "platform",
    own: false,
    detached: false,
    requiredNow: true,
    value: "",
  },
  {
    fieldId: "f3",
    label: "End connection",
    platformLabel: "End connection",
    unit: null,
    type: "select",
    options: ["Flanged", "Threaded", "Grooved, AWWA C606"],
    facet: "not_a_facet",
    own: false,
    detached: false,
    requiredNow: false,
    value: "",
  },
  {
    fieldId: "f4",
    label: "Certification",
    platformLabel: "Certification",
    unit: null,
    type: "multiselect",
    options: ["WRAS", "UL listed", "EN 1074"],
    facet: "platform",
    own: false,
    detached: false,
    requiredNow: false,
    value: "WRAS|UL listed",
  },
  {
    fieldId: "f5",
    label: "Size",
    platformLabel: "Nominal diameter",
    unit: null,
    type: "text",
    options: [],
    facet: "yours_only",
    own: false,
    detached: true,
    requiredNow: false,
    value: "Half inch",
  },
  {
    fieldId: "f6",
    label: "Warranty",
    platformLabel: null,
    unit: "months",
    type: "number",
    options: [],
    facet: "yours_only",
    own: true,
    detached: false,
    requiredNow: false,
    value: "",
  },
];

function Grid({
  fields,
  prefix,
  label,
}: {
  fields: EditorField[];
  prefix: string;
  /**
   * Names the <form> landmark. Distinct per instance: this section renders the
   * grid twice, and two unnamed forms are two identical entries in a screen
   * reader's landmark list — which tests/e2e/landmarks.spec.ts fails on.
   */
  label: string;
}) {
  const [scope, setScope] = useState<Scope>("all");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.fieldId, field.value])),
  );

  return (
    <form aria-label={label} onSubmit={(event) => event.preventDefault()}>
      <SpecGrid
        fields={fields}
        values={values}
        onChange={(fieldId, value) => setValues((current) => ({ ...current, [fieldId]: value }))}
        scope={scope}
        onScope={setScope}
        fieldDomId={(fieldId) => `${prefix}-${fieldId}`}
      />
    </form>
  );
}

export function SpecGridStates() {
  return (
    <div className="flex flex-col gap-8">
      <Grid fields={FIELDS} prefix="gallery-spec" label="Specification fields — the whole template" />
      <div className="flex flex-col gap-2 border-t border-line pt-6">
        <p className="font-mono text-eyebrow uppercase text-faint">a template with one field</p>
        {/*
          One column, not a two-column grid with a hole. The rule is a
          `min-[1440px]:` class on the grid, so the single field simply takes
          the row rather than being paired with an empty cell.
        */}
        <Grid
          fields={[FIELDS[0]!]}
          prefix="gallery-solo"
          label="Specification fields — a template with one field"
        />
      </div>
    </div>
  );
}
