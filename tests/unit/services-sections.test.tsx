import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../axe";
import { renderSection } from "@/components/storefront";
import type { SectionData } from "@/lib/storefront/render-data";
import { sectionType } from "@/lib/storefront/section-types";
import type { ResolvedSection } from "@/lib/storefront/sections";
import { SPECIMEN_DATA, SPECIMEN_WORK_DATA } from "@/lib/storefront/specimen-data";

/**
 * Board `5c-s` — the services sections, rendered.
 *
 * Criteria 5, 6, 7 and 8 are statements about markup, so they are asserted on
 * markup: the scope grid reads gaps as *Not stated* in a real table, coverage is
 * rows with no map, and the shared sections speak by kind.
 */

const sectionOf = (type: string, settings: unknown = {}): ResolvedSection => {
  const definition = sectionType(type)!;
  return {
    id: `test-${type}`,
    type,
    sortOrder: 0,
    enabled: true,
    fixed: definition.fixed,
    singleton: definition.singleton,
    sellerEditableFields: definition.sellerFields.map((field) => field.key),
    showOnMobile: true,
    settings,
    definition,
  };
};

const draw = (type: string, data: SectionData, options: { settings?: unknown; preview?: boolean; content?: Record<string, unknown> } = {}) =>
  render(
    <>
      {renderSection({
        section: sectionOf(type, options.settings),
        data,
        content: options.content ?? {},
        enquireHref: "#enquire",
        preview: options.preview ?? false,
      })}
    </>,
  );

const EMPTY_WORK: SectionData = {
  ...SPECIMEN_WORK_DATA,
  work: { ...SPECIMEN_WORK_DATA.work!, services: [], credentials: [], coverage: [], sectors: [] },
};

describe("the scope grid — criterion 5", () => {
  it("renders the firm's services as rows of a real table, gaps reading Not stated (B6)", async () => {
    const { container } = draw("scope_grid", SPECIMEN_WORK_DATA);
    const table = screen.getByRole("table", { name: "Services from Meridian Chartered Accountants" });
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Service",
      "Fee basis",
      "Turnaround",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    // One row per service, column headers retained.
    expect(rows).toHaveLength(4);
    const tax = rows.find((row) => row.textContent?.includes("Corporate tax registration"))!;
    expect(within(tax).getAllByRole("cell")[0]!.textContent).toBe("Not stated");
    expect(container.querySelector('th[scope="row"]')).not.toBeNull();
    await expectNoAxeViolations(container);
  });

  it("uses the template's columns, in the template's order", () => {
    draw("scope_grid", SPECIMEN_WORK_DATA, { settings: { columns: ["delivered", "engagement"] } });
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Service",
      "Delivered",
      "Engagement",
    ]);
  });

  it("narrows to the seller's picks without reordering them", () => {
    draw("scope_grid", SPECIMEN_WORK_DATA, { content: { services: ["s4", "s1"] } });
    const names = screen.getAllByRole("rowheader").map((th) => th.querySelector("a")!.textContent);
    expect(names).toEqual(["Statutory audit", "Monthly bookkeeping"]);
  });

  it("says why it is empty rather than hiding — the seller's reason in a preview, the buyer's on a page", () => {
    const { unmount } = draw("scope_grid", EMPTY_WORK, { preview: true });
    expect(screen.getByText(/No services published yet/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    unmount();
    draw("scope_grid", EMPTY_WORK);
    expect(screen.getByText(/has not published a service yet/)).toBeTruthy();
  });

  it("prints no fee amount anywhere (B4)", () => {
    const { container } = draw("scope_grid", SPECIMEN_WORK_DATA, {
      settings: { columns: ["engagement", "turnaround", "fee_basis", "delivered"] },
    });
    expect(container.textContent).not.toMatch(/AED\s*[\d,]/);
  });
});

describe("the credential wall", () => {
  it("is the shared credential table, narrowed to checked rows when configured", () => {
    const { unmount } = draw("credential_wall", SPECIMEN_WORK_DATA);
    expect(screen.getAllByRole("row").length).toBeGreaterThan(3);
    unmount();
    draw("credential_wall", SPECIMEN_WORK_DATA, { settings: { show: "verified" } });
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row").filter((row) => row.closest("tbody"))).toHaveLength(1);
  });

  it("is absent on a storefront with none, and says so in a preview", () => {
    const { container, unmount } = draw("credential_wall", EMPTY_WORK);
    expect(container.textContent).toBe("");
    unmount();
    draw("credential_wall", EMPTY_WORK, { preview: true });
    expect(screen.getByText(/No credentials added yet/)).toBeTruthy();
  });
});

describe("coverage — criterion 6", () => {
  it("renders one row per service, and no map or pin (B7)", () => {
    const { container } = draw("coverage", SPECIMEN_WORK_DATA);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("rowheader")).toHaveLength(4);
    expect(container.querySelector("canvas, [data-map], .maplibregl-map")).toBeNull();
    expect(container.textContent).not.toMatch(/\bmap\b/i);
  });

  it("renders the union as a sentence when configured", () => {
    draw("coverage", SPECIMEN_WORK_DATA, { settings: { rows: "union" } });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/Abu Dhabi, Dubai(,)? and Sharjah/)).toBeTruthy();
  });
});

describe("shared sections speak by kind — criteria 7 and 8", () => {
  it("heads the enquiry section with the service composer's words for a firm that sells work", () => {
    const { unmount } = draw("enquiry_form", SPECIMEN_DATA);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Send an enquiry");
    unmount();
    draw("enquiry_form", SPECIMEN_WORK_DATA);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Enquire about your situation");
  });

  it("reads reviews as clients, not buyers, for a firm that sells work", () => {
    const { unmount } = draw("reviews", SPECIMEN_DATA);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("What buyers said");
    unmount();
    draw("reviews", SPECIMEN_WORK_DATA);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("What clients said");
  });
});

describe("sectors served and process steps", () => {
  it("shows declared sectors, and nothing on a storefront with none", () => {
    const { unmount } = draw("sectors_served", SPECIMEN_WORK_DATA);
    expect(screen.getByText("Contracting")).toBeTruthy();
    unmount();
    const { container } = draw("sectors_served", EMPTY_WORK);
    expect(container.textContent).toBe("");
  });

  it("renders process steps as the held card naming the decision", () => {
    draw("process_steps", SPECIMEN_WORK_DATA);
    expect(screen.getByText(/Held for a decision/)).toBeTruthy();
  });
});
