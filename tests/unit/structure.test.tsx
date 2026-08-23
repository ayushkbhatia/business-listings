import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import {
  AppSidebar,
  Breadcrumb,
  DataTable,
  Pagination,
  Panel,
  TableToolbar,
  Tabs,
  type Column,
} from "@/components/structure";
import type { Actor } from "@/lib/auth/roles";

interface Row {
  id: string;
  name: string;
  count: number;
}

const ROWS: Row[] = [
  { id: "1", name: "Al Marwan Trading", count: 41 },
  { id: "2", name: "Gulf Line Industrial", count: 18 },
  { id: "3", name: "Emirates Crest", count: 96 },
];

const COLUMNS: Column<Row>[] = [
  { key: "name", header: "supplier", sortable: true, render: (r) => r.name },
  { key: "count", header: "enquiries", numeric: true, sortable: true, render: (r) => r.count },
];

describe("DataTable — the rules that are not preferences", () => {
  it("is real table markup: table, thead, and a scope on every head", () => {
    const { container } = render(
      <DataTable caption="Businesses" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />,
    );
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.querySelector("thead")).not.toBeNull();
    const heads = table!.querySelectorAll("th");
    expect(heads.length).toBeGreaterThan(0);
    expect(table!.querySelectorAll("th[scope]").length).toBe(heads.length);
  });

  it("has a caption, so the table has a name without sight of it", () => {
    render(<DataTable caption="Businesses and their enquiry counts" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    expect(screen.getByRole("table", { name: /businesses and their enquiry counts/i })).toBeInTheDocument();
  });

  it("reports the sort direction through aria-sort, not colour", () => {
    render(
      <DataTable
        caption="Businesses"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        sort={{ key: "count", direction: "desc" }}
        onSortChange={() => {}}
        sortLabel={(c, d) => `Sort by ${c}, ${d}`}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /enquiries/i })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("flips direction on the sorted column and starts ascending on another", async () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        caption="Businesses"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        sort={{ key: "count", direction: "asc" }}
        onSortChange={onSortChange}
        sortLabel={(c, d) => `Sort by ${c}, ${d}`}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /sort by enquiries/i }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "count", direction: "desc" });

    await userEvent.click(screen.getByRole("button", { name: /sort by supplier/i }));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: "name", direction: "asc" });
  });

  it("select-all goes indeterminate when only some rows are selected", () => {
    render(
      <DataTable
        caption="Businesses"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        selectable
        selected={["1"]}
        onSelectedChange={() => {}}
        selectAllLabel="Select all rows"
        selectRowLabel={(r) => `Select ${r.name}`}
      />,
    );
    const all = screen.getByRole("checkbox", { name: "Select all rows" }) as HTMLInputElement;
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);
  });

  it("select-all picks up every row, and clears when all are already selected", async () => {
    function Harness() {
      const [selected, setSelected] = useState<string[]>([]);
      return (
        <DataTable
          caption="Businesses"
          columns={COLUMNS}
          rows={ROWS}
          rowKey={(r) => r.id}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          selectAllLabel="Select all rows"
          selectRowLabel={(r) => `Select ${r.name}`}
        />
      );
    }
    render(<Harness />);
    const all = screen.getByRole("checkbox", { name: "Select all rows" });
    await userEvent.click(all);
    expect(screen.getByRole("checkbox", { name: "Select Emirates Crest" })).toBeChecked();
    await userEvent.click(all);
    expect(screen.getByRole("checkbox", { name: "Select Emirates Crest" })).not.toBeChecked();
  });

  it("names each row menu after the row it acts on", () => {
    render(
      <DataTable
        caption="Businesses"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        rowMenu={() => [{ key: "a", label: "Assign", onSelect: () => {} }]}
        rowMenuLabel={(r) => `More actions for ${r.name}`}
        actionsHeader="Row actions"
      />,
    );
    expect(screen.getByLabelText("More actions for Al Marwan Trading")).toBeInTheDocument();
    expect(screen.getByLabelText("More actions for Gulf Line Industrial")).toBeInTheDocument();
  });

  it("does not claim to be a menu widget it has not implemented", () => {
    const { container } = render(
      <DataTable
        caption="Businesses"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        rowMenu={() => [{ key: "a", label: "Assign", onSelect: () => {} }]}
        rowMenuLabel={(r) => `More actions for ${r.name}`}
      />,
    );
    expect(container.querySelectorAll('[role="menu"], [role="menuitem"]')).toHaveLength(0);
  });

  it("keeps one visible action per row and the rest behind the disclosure", () => {
    render(
      <DataTable
        caption="Businesses"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        rowAction={() => ({ label: "View", onSelect: () => {} })}
        rowMenu={() => [
          { key: "a", label: "Assign", onSelect: () => {} },
          { key: "s", label: "Suspend", onSelect: () => {}, destructive: true },
        ]}
        rowMenuLabel={(r) => `More actions for ${r.name}`}
      />,
    );
    expect(screen.getAllByRole("button", { name: "View" })).toHaveLength(3);
  });

  it("shows the empty state rather than an empty body", () => {
    render(
      <DataTable
        caption="Businesses"
        columns={COLUMNS}
        rows={[]}
        rowKey={(r) => r.id}
        empty={<p>No results for these filters</p>}
      />,
    );
    expect(screen.getByText("No results for these filters")).toBeInTheDocument();
  });
});

describe("Pagination", () => {
  const props = {
    pageSize: 50,
    onPageChange: vi.fn(),
    rangeLabel: (from: number, to: number, total: number) => `${from}–${to} of ${total}`,
    previousLabel: "Previous page",
    nextLabel: "Next page",
    pageLabel: (p: number) => `Page ${p}`,
  };

  it("renders nothing at or below the threshold", () => {
    const { container } = render(<Pagination {...props} page={1} total={50} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("appears above it, and marks the current page", () => {
    render(<Pagination {...props} page={2} total={218} />);
    expect(screen.getByText("51–100 of 218")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  });

  it("disables the ends rather than wrapping", () => {
    const { rerender } = render(<Pagination {...props} page={1} total={218} />);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    rerender(<Pagination {...props} page={5} total={218} />);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });
});

describe("TableToolbar", () => {
  it("is replaced by the selection bar rather than stacking with it", () => {
    const selection = {
      count: 0,
      countLabel: (n: number) => `${n} selected`,
      actions: [{ key: "e", label: "Export", onSelect: () => {} }],
      onClear: () => {},
      clearLabel: "Clear selection",
    };
    const { rerender } = render(
      <TableToolbar selection={selection}>
        <button type="button">Filter</button>
      </TableToolbar>,
    );
    expect(screen.getByRole("button", { name: "Filter" })).toBeInTheDocument();

    rerender(
      <TableToolbar selection={{ ...selection, count: 24 }}>
        <button type="button">Filter</button>
      </TableToolbar>,
    );
    expect(screen.queryByRole("button", { name: "Filter" })).not.toBeInTheDocument();
    expect(screen.getByText("24 selected")).toBeInTheDocument();
  });
});

describe("AppSidebar", () => {
  const groups = [
    {
      key: "g",
      labelKey: "Group",
      items: [
        { key: "leads", labelKey: "Leads", href: "/dashboard/leads", capability: "enquiry.respond" as const },
        { key: "billing", labelKey: "Billing", href: "/dashboard/billing", capability: "billing.manage" as const },
        { key: "later", labelKey: "Attributes", href: "/admin/attributes", later: true },
      ],
    },
  ];
  const base = {
    groups,
    activeHref: "/dashboard/leads",
    translate: (k: string) => k,
    label: "Seller navigation",
    lockedLabel: "locked",
    laterLabel: "soon",
  };

  it("locks what the actor cannot reach rather than hiding it", () => {
    const sales: Actor = { id: "u", roles: ["seller_sales"] };
    render(<AppSidebar {...base} actor={sales} />);
    // Visible, so the seller knows it exists and can ask for it.
    expect(screen.getByText("Billing")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Billing/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Leads/ })).toBeInTheDocument();
  });

  it("marks the current page", () => {
    const owner: Actor = { id: "u", roles: ["seller_owner"] };
    render(<AppSidebar {...base} actor={owner} />);
    expect(screen.getByRole("link", { name: /Leads/ })).toHaveAttribute("aria-current", "page");
  });

  it("names a later route without linking to it — no dead links", () => {
    const owner: Actor = { id: "u", roles: ["seller_owner"] };
    render(<AppSidebar {...base} actor={owner} />);
    expect(screen.getByText("Attributes")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Attributes/ })).not.toBeInTheDocument();
  });
});

describe("Tabs", () => {
  it("is one tab stop with arrow keys inside it", async () => {
    function Harness() {
      const [active, setActive] = useState("a");
      return (
        <Tabs
          label="Sections"
          active={active}
          onChange={setActive}
          items={[
            { key: "a", label: "Overview" },
            { key: "b", label: "Products" },
          ]}
        />
      );
    }
    render(<Harness />);
    await userEvent.tab();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Products" })).toHaveAttribute("aria-selected", "true");
  });

  it("renders real links when the tabs are routes", () => {
    render(
      <Tabs
        as="a"
        label="Sections"
        active="a"
        items={[
          { key: "a", label: "Overview", href: "/b/x" },
          { key: "b", label: "Products", href: "/b/x/products" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Products" })).toHaveAttribute("href", "/b/x/products");
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  });
});

describe("Breadcrumb", () => {
  it("does not link the page you are already on", () => {
    render(
      <Breadcrumb
        label="Breadcrumb"
        items={[
          { label: "Directory", href: "/" },
          { label: "Valves", href: "/c/valves" },
          { label: "Al Marwan Trading" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "Valves" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Al Marwan Trading" })).not.toBeInTheDocument();
    expect(screen.getByText("Al Marwan Trading")).toHaveAttribute("aria-current", "page");
  });
});

describe("Panel", () => {
  it("dims a locked panel and names what unlocks it, rather than hiding the feature", () => {
    render(
      <Panel title="Sponsored placement" locked={{ label: "Sponsored placement is on the Pro plan." }}>
        <p>One slot per category.</p>
      </Panel>,
    );
    // The feature stays on screen — a seller cannot want what they cannot see.
    expect(screen.getByText("One slot per category.")).toBeInTheDocument();
    expect(screen.getByText("Sponsored placement is on the Pro plan.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sponsored placement" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
