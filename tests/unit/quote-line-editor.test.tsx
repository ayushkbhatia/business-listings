import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoAxeViolations } from "../axe";
import {
  QuoteLineEditor,
  type QuoteLineDraft,
  type QuoteLineEditorLabels,
} from "@/components/domain";
import { formatAED } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * The behaviour the README asks for in words: "unmatched lines flagged for
 * manual pricing and never silently blank".
 *
 * A screenshot cannot show that a quote refuses to send. These can.
 */

const LINES: QuoteLineDraft[] = [
  {
    key: "l1",
    description: "Brass ball valve",
    qty: 40,
    unit: "pcs",
    size: "DN25",
    targetUnitPriceAed: "65.00",
    suggested: {
      productId: "p1",
      name: "Brass ball valve DN25",
      sku: "ALM-1028",
      availabilityLabel: "In stock",
      stockLabel: "212 in stock",
      leadTimeDays: null,
      reasons: ["size", "wording"],
    },
    alternatives: [],
  },
  {
    key: "l2",
    description: "API 6D trunnion mounted ball valve",
    qty: 4,
    unit: "pcs",
    size: "DN600",
    targetUnitPriceAed: "18500.00",
    suggested: null,
    alternatives: [],
  },
];

const LABELS: QuoteLineEditorLabels = {
  formLabel: t("quote.editor.form"),
  caption: t("quote.editor.caption"),
  colLine: t("quote.col.line"),
  colProduct: t("quote.col.product"),
  colQty: t("quote.col.qty"),
  colUnitPrice: t("quote.col.unit_price"),
  colLeadTime: t("quote.col.lead_time"),
  colTotal: t("quote.col.total"),
  manualFlag: t("quote.manual_flag"),
  manualHelp: t("quote.manual_help"),
  matchedBy: () => t("quote.matched_by.size_and_wording"),
  priceByHand: t("quote.price_by_hand"),
  chooseProduct: t("quote.choose_product"),
  targetPrice: (amountAed) => t("quote.target_price", { amount: formatAED(amountAed) }),
  leadTimeSuffix: t("quote.lead_time_suffix"),
  unitPriceLabel: (line) => t("quote.unit_price_for", { line }),
  leadTimeLabel: (line) => t("quote.lead_time_for", { line }),
  productLabel: (line) => t("quote.product_for", { line }),
  includeLabel: (line) => t("quote.product_for", { line }),
  excluded: t("quote.excluded"),
  excludeAction: t("quote.exclude"),
  includeAction: t("quote.include"),
  totalLabel: t("quote.total"),
  currencyNote: t("quote.currency_note"),
  noteLabel: t("quote.note_label"),
  notePlaceholder: t("quote.note_placeholder"),
  validityLabel: t("quote.validity_label"),
  validityHelp: t("quote.validity_help"),
  validityDayOptions: [{ value: "14", label: "14 days" }],
  submit: t("quote.send"),
  submitting: t("quote.sending"),
  unpricedError: (lines) => t("quote.error.unpriced", { count: lines.length, lines: lines.join("; ") }),
  badPriceError: (line) => t("quote.error.bad_price", { line }),
  nothingIncludedError: t("quote.error.nothing_included"),
};

function renderEditor(props: Partial<React.ComponentProps<typeof QuoteLineEditor>> = {}) {
  const onSubmit = vi.fn();
  render(
    <QuoteLineEditor
      lines={LINES}
      labels={LABELS}
      formatTotal={(aed) => formatAED(aed, { style: "quote" })}
      onSubmit={onSubmit}
      {...props}
    />,
  );
  return { onSubmit };
}

describe("the unmatched line", () => {
  it("is flagged, and says why", () => {
    renderEditor();
    expect(screen.getByText("Price by hand")).toBeInTheDocument();
    expect(screen.getByText("Nothing in your catalogue matches this line.")).toBeInTheDocument();
  });

  it("names the flag to the price field, so it is not a colour alone", () => {
    renderEditor();
    const price = screen.getByLabelText("Unit price for API 6D trunnion mounted ball valve");
    const describedBy = price.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toContain("Price by hand");
  });

  it("starts empty, with no placeholder that could be mistaken for a price", () => {
    renderEditor();
    const price = screen.getByLabelText("Unit price for API 6D trunnion mounted ball valve");
    expect(price).toHaveValue("");
    expect(price).toHaveAttribute("placeholder", "");
  });

  it("offers no product picker when there is nothing to pick", () => {
    renderEditor();
    expect(
      screen.queryByLabelText("Catalogue product for API 6D trunnion mounted ball valve"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No catalogue match")).toBeInTheDocument();
  });
});

describe("the matched line", () => {
  it("shows the SKU and the stock position", () => {
    renderEditor();
    const picker = screen.getByLabelText("Catalogue product for Brass ball valve");
    expect(within(picker).getByRole("option", { name: /ALM-1028/ })).toBeInTheDocument();
    expect(screen.getByText(/212 in stock/)).toBeInTheDocument();
  });

  it("always offers the way out of the match", () => {
    renderEditor();
    const picker = screen.getByLabelText("Catalogue product for Brass ball valve");
    expect(within(picker).getByRole("option", { name: /price by hand/i })).toBeInTheDocument();
  });

  it("shows the buyer's target beside the line", () => {
    renderEditor();
    expect(screen.getByText("Buyer's target AED 65")).toBeInTheDocument();
  });
});

describe("sending", () => {
  it("refuses while a line has no price, and names the line", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderEditor();

    await user.type(screen.getByLabelText("Unit price for Brass ball valve"), "62.00");
    await user.click(screen.getByRole("button", { name: t("quote.send") }));

    expect(onSubmit).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("API 6D trunnion mounted ball valve");
    // Says what correct looks like, and does not blame the seller.
    expect(alert).toHaveTextContent("Every line you send needs a price");
  });

  it("refuses a price that is not an amount in dirhams", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderEditor();
    await user.type(screen.getByLabelText("Unit price for Brass ball valve"), "62.005");
    await user.type(screen.getByLabelText("Unit price for API 6D trunnion mounted ball valve"), "19750");
    await user.click(screen.getByRole("button", { name: t("quote.send") }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("398.00");
  });

  it("sends every priced line, with the product where one was matched", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderEditor();

    await user.type(screen.getByLabelText("Unit price for Brass ball valve"), "62.00");
    await user.type(screen.getByLabelText("Unit price for API 6D trunnion mounted ball valve"), "19750.00");
    await user.type(screen.getByLabelText("Lead time in days for API 6D trunnion mounted ball valve"), "84");
    await user.click(screen.getByRole("button", { name: t("quote.send") }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      validityDays: 14,
      lines: [
        { enquiryLineId: "l1", productId: "p1", qty: 40, unitPrice: "62.00" },
        { enquiryLineId: "l2", productId: null, qty: 4, unitPrice: "19750.00", leadTimeDays: 84 },
      ],
    });
  });

  it("drops a removed line from the quote rather than pricing it at zero", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderEditor();

    const rows = screen.getAllByRole("row");
    const trunnionRow = rows.find((r) => r.textContent?.includes("API 6D"))!;
    await user.click(within(trunnionRow).getByRole("button", { name: t("quote.exclude") }));

    await user.type(screen.getByLabelText("Unit price for Brass ball valve"), "62.00");
    await user.click(screen.getByRole("button", { name: t("quote.send") }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0].lines).toHaveLength(1);
  });

  it("refuses a quote with every line removed", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderEditor();
    for (const button of screen.getAllByRole("button", { name: t("quote.exclude") })) {
      await user.click(button);
    }
    await user.click(screen.getByRole("button", { name: t("quote.send") }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("needs at least one line");
  });
});

describe("the total", () => {
  it("adds in fils, so the displayed total is the one that was sent", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(screen.getByLabelText("Unit price for Brass ball valve"), "0.10");
    await user.type(screen.getByLabelText("Unit price for API 6D trunnion mounted ball valve"), "0.20");
    // 40 × 0.10 + 4 × 0.20 = 4.80. In float arithmetic that is 4.800000000000001.
    expect(screen.getByRole("table")).toHaveTextContent("4.80");
  });
});

describe("accessibility", () => {
  it("has no axe violations", async () => {
    const { container } = render(
      <QuoteLineEditor lines={LINES} labels={LABELS} formatTotal={(aed) => formatAED(aed, { style: "quote" })} />,
    );
    await expectNoAxeViolations(container);
  });

  it("is a real table with a caption and row headers", () => {
    renderEditor();
    const table = screen.getByRole("table", { name: t("quote.editor.caption") });
    expect(within(table).getAllByRole("rowheader")).toHaveLength(3); // 2 lines + the total
    expect(within(table).getAllByRole("columnheader")).toHaveLength(6);
  });
});
