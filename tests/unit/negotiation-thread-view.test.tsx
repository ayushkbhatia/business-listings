import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { expectNoAxeViolations } from "../axe";
import { Thread } from "@/components/domain";
import { buildNegotiationView } from "@/app/(public)/enquiry/[id]/thread/[seller]/_build";
import { NegotiationLayout } from "@/app/(public)/enquiry/[id]/thread/[seller]/_view";
import {
  NEGOTIATION_NOW,
  acceptedElsewhereNegotiation,
  boardNegotiation,
  closedNegotiation,
  expiredNegotiation,
  noReplyNegotiation,
  partialNegotiation,
  thirdRevisionNegotiation,
} from "@/app/dev/gallery/_sections/negotiation-fixture";
import { amountWords, deltaWords, relativeWords, threadLabels, validityWords } from "@/lib/messaging/negotiation-words";
import { revisionPdf } from "@/lib/quote/revision-pdf";
import { compareRevision, revisionPairs } from "@/lib/messaging/negotiation";

/**
 * Board `10h` as rendered, from the board's own rows.
 *
 * What the model's tests cannot see: that the figures reach the screen as the
 * corrected ones, that the table carries every line its total sums (`B3`), that
 * a preview is the message's own words (`B4`), that silence is a row (`B9`),
 * that each state the spec lists renders its control or its absence, and that
 * the whole of it passes axe.
 */

function renderNegotiation(negotiation = boardNegotiation(), now = NEGOTIATION_NOW) {
  const view = buildNegotiationView(negotiation, { now, token: "tok", acceptError: null });
  const labels = threadLabels({ logLabel: "Messages", formLabel: "Reply" }, "buyer");
  const result = render(
    <NegotiationLayout {...view.layout}>
      <Thread fill messages={view.thread.messages} labels={labels} readOnly={view.thread.readOnly} />
    </NegotiationLayout>,
  );
  return { view, ...result };
}

describe("the words", () => {
  it("formats whole dirhams as the board does, and fils when there are any", () => {
    expect(amountWords(1_460_000n)).toBe("AED 14,600");
    expect(amountWords(1_460_050n)).toBe("AED 14,600.50");
    expect(deltaWords(-28_000n)).toEqual({ label: "−AED 280", direction: "down" });
    expect(deltaWords(0n).direction).toBe("same");
  });

  it("reads time on the Dubai calendar, coarsely", () => {
    const now = new Date("2026-08-21T05:26:00.000Z");
    expect(relativeWords(new Date("2026-08-21T05:14:00.000Z"), now)).toBe("12 min ago");
    expect(relativeWords(new Date("2026-08-21T03:26:00.000Z"), now)).toBe("2 h ago");
    expect(relativeWords(new Date("2026-08-20T10:00:00.000Z"), now)).toBe("yesterday");
  });

  it("states a revision's window, or that it has none (B8)", () => {
    const now = new Date("2026-08-21T05:26:00.000Z");
    expect(validityWords({ validityDays: 14, expiresAt: new Date("2026-09-04T05:14:00.000Z"), status: "sent" }, now).label).toBe(
      "Valid 14 days · until 4 Sep",
    );
    expect(validityWords({ validityDays: 14, expiresAt: null, status: "sent" }, now).label).toBe("No validity stated");
    expect(validityWords({ validityDays: 14, expiresAt: new Date("2026-08-20T00:00:00.000Z"), status: "sent" }, now)).toEqual({
      label: "Expired 20 Aug",
      expired: true,
    });
  });
});

describe("as drawn", () => {
  it("renders the rail as the board lists it", () => {
    renderNegotiation();
    const rail = screen.getByRole("navigation", { name: "Threads on ENQ-8841" });
    const rows = within(rail).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Al Waha Industrial SuppliesOne drop makes it easier…Revised quote · r2 · 12 min ago",
      "Emirates Valve & Fitting1 unreadGasket line is not something we stock…2 of 3 lines quoted · 2 h ago",
      "Northern Gulf TradingQuote attached, valid 14 daysQuoted · yesterday",
      "Technopump TradingNo reply yet",
    ]);
    expect(within(rail).getByRole("link", { current: "page" })).toHaveTextContent("Al Waha Industrial Supplies");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Al Waha Industrial Supplies");
    expect(screen.getByText("Rajesh Nair, Sales · replies in about 2 h")).toBeInTheDocument();
  });

  it("prints r2 with every line, 198 struck through, and a total the rows add up to", () => {
    renderNegotiation();
    const table = screen.getAllByRole("table").at(-1)!;
    const rows = within(table).getAllByRole("row");
    const body = rows.slice(1, -1).map((row) => row.textContent);
    expect(body).toEqual([
      "Butterfly valve DN100 × 40was 198.00198.00191.007,640.00",
      "Rigid coupling × 12046.005,520.00",
      "Grooved gasket × 12012.001,440.00",
    ]);
    expect(rows.at(-1)).toHaveTextContent("Total excl. VATAED 14,600");
    expect(screen.getByText("−AED 280")).toBeInTheDocument();
    // r1, on the record above it at its corrected total.
    expect(screen.getByText("AED 14,880 · Valid 14 days · until 2 Sep")).toBeInTheDocument();
    expect(screen.getByText("17:41 · Read")).toBeInTheDocument();
  });

  it("offers the accept at 14,600 and states it before it is pressed", () => {
    const { view } = renderNegotiation();
    expect(view.thread.accept).toMatchObject({
      kind: "offer",
      buttonLabel: "Accept r2 — AED 14,600",
      footnote: expect.stringContaining("politely declines the other three"),
    });
    if (view.thread.accept.kind !== "offer") throw new Error("no offer");
    expect(view.thread.accept.dialog.facts).toContain("AED 14,600 excl. VAT, across 3 lines");
    expect(view.thread.accept.dialog.facts.join(" ")).toContain(
      "Emirates Valve & Fitting, Northern Gulf Trading, and Technopump Trading are told you chose another supplier",
    );
    expect(view.thread.accept.dialog.warning).toBeNull();
  });

  it("passes axe", async () => {
    const { container } = renderNegotiation();
    await expectNoAxeViolations(container);
  });

  it("gives the PDF of r2 the table's own figures", () => {
    const board = boardNegotiation();
    const pair = revisionPairs(board.record.quotes).at(-1)!;
    const comparison = compareRevision(pair.quote, pair.previous, board.record.requirement);
    const pdf = revisionPdf({ supplierName: "Al Waha Industrial Supplies", enquiryRef: "ENQ-8841", quote: pair.quote, comparison, now: NEGOTIATION_NOW });
    expect(pdf.filename).toBe("QT-8841-ALWR2.pdf");
    expect(pdf.bytes.toString("latin1")).toContain("14,600.00");
  });
});

describe("the states the spec lists", () => {
  it("an unpublished supplier keeps the thread and loses the storefront link", () => {
    const board = boardNegotiation();
    renderNegotiation({ ...board, supplier: { ...board.supplier, published: false } });
    expect(screen.queryByRole("link", { name: "View storefront" })).toBeNull();
    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);
  });

  it("no reply: the row stays, the thread says so, and nothing is offered", () => {
    const { view } = renderNegotiation(noReplyNegotiation());
    expect(view.thread.accept.kind).toBe("none");
    expect(view.thread.readOnly).toBe(false);
    expect(view.thread.notice?.text).toContain("Technopump Trading has not replied yet");
  });

  it("a declined line is grey, not quoted, and the dialog says so before accepting", () => {
    const { view } = renderNegotiation(partialNegotiation());
    const table = screen.getAllByRole("table").at(-1)!;
    expect(within(table).getByRole("row", { name: /Grooved gasket × 120 Not quoted/ })).toBeInTheDocument();
    if (view.thread.accept.kind !== "offer") throw new Error("no offer");
    expect(view.thread.accept.dialog.warning).toBe("1 line of your requirement is not quoted in this revision.");
  });

  it("multiple revisions: r3 is struck against r2, and the accept names r3", () => {
    const { view } = renderNegotiation(thirdRevisionNegotiation());
    expect(view.thread.accept).toMatchObject({ buttonLabel: "Accept r3 — AED 14,440" });
    expect(screen.getByText("−AED 160")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open AW butterfly valve DN100 datasheet.pdf" })).toHaveAttribute(
      "href",
      expect.stringContaining("/files/gd-ds-valve"),
    );
  });

  it("expired mid-thread: the accept is disabled with the date, and a chip asks again", () => {
    const { view } = renderNegotiation(expiredNegotiation());
    expect(view.thread.accept).toMatchObject({ kind: "expired", buttonLabel: "Accept r2" });
    expect(view.thread.leadingChips?.map((chip) => chip.label)).toEqual(["Ask for a new revision"]);
  });

  it("accepted elsewhere: read-only, and it says who and when", () => {
    const { view } = renderNegotiation(acceptedElsewhereNegotiation());
    expect(view.thread.readOnly).toBe(true);
    expect(view.thread.accept.kind).toBe("none");
    expect(view.thread.notice?.text).toBe(
      "You accepted the quote from Northern Gulf Trading on 21 Aug 2026. Al Waha Industrial Supplies was told you chose another supplier, and this thread is now read-only.",
    );
  });

  it("closed unactioned: read-only, and re-send is the enquiry inbox's path", () => {
    const { view } = renderNegotiation(closedNegotiation());
    expect(view.thread.readOnly).toBe(true);
    expect(view.thread.notice?.action?.href).toBe("/rfq/new?resend=ENQ-8847&t=tok");
  });

  it("an account that may not accept: no accept of any kind, the reason said, the thread still open", () => {
    // Build plan 9.4: `acceptQuote` asks `quote.accept` before it reads the quote.
    const refused = (negotiation: ReturnType<typeof boardNegotiation>) =>
      buildNegotiationView(negotiation, { now: NEGOTIATION_NOW, token: "tok", acceptError: null, mayAccept: false });

    const offer = refused(boardNegotiation());
    expect(offer.thread.accept.kind).toBe("none");
    expect(offer.thread.notice?.text).toBe(
      "This account cannot accept quotes, so none is offered here. A quote is accepted from a buyer or a supplier account.",
    );
    // Writing to the supplier is not accepting; the composer stays.
    expect(offer.thread.readOnly).toBe(false);

    // Asking for a fresh revision is not accepting either.
    const expired = refused(expiredNegotiation());
    expect(expired.thread.accept.kind).toBe("none");
    expect(expired.thread.leadingChips?.map((chip) => chip.label)).toEqual(["Ask for a new revision"]);
  });
});
