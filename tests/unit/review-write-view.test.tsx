import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoAxeViolations } from "../axe";

vi.mock("@/app/(public)/review/actions", () => ({
  saveReviewDraftAction: vi.fn(async () => ({ ok: true, savedAt: new Date().toISOString() })),
  signReviewPhotoAction: vi.fn(),
  addReviewPhotoAction: vi.fn(),
  postReviewAction: vi.fn(async () => ({ ok: false, error: "refused in test" })),
  editReviewAction: vi.fn(),
}));

import { RatedOnCard } from "@/app/(public)/b/[slug]/reviews/_summary";
import {
  ChooseBody,
  NoticeBody,
  OthersPanel,
  ReviewBand,
  ReviewedBody,
  ReviewHeader,
  RulesPanel,
  StepsPanel,
} from "@/app/(public)/review/new/_parts";
import { ReviewWriteForm } from "@/app/(public)/review/new/ReviewWriteForm";
import {
  REVIEW_WRITE_NOW,
  chooseSupplier,
  drawnReview,
  emptyReview,
  anonymousReview,
  notEligible,
  reviewedHeld,
  reviewedReplied,
  windowClosed,
} from "@/app/dev/gallery/_sections/review-write-fixture";
import { buildReviewWrite, type ReviewWriteData } from "@/lib/reviews/write-view";

/**
 * Board 10f as rendered, from the board's own facts through the route's builder.
 *
 * What the pure tests cannot see: that the corrected figures reach the screen,
 * that Post is disabled on exactly what is missing and says so, that the preview
 * is 1m's row and moves with the form, that the form and the listing's RATED ON
 * card name the four dimensions identically (the handoff's standing check —
 * diff the field names, not the layout), that a closed window has no form at
 * all, and that the whole of it passes axe.
 */

function renderPage(data: ReviewWriteData, flash: "posted" | "saved" | null = null) {
  const view = buildReviewWrite(data, { now: REVIEW_WRITE_NOW, token: "tok", flash });
  const rules = <RulesPanel rules={view.rules} />;
  const bottom = (
    <>
      {view.steps ? <StepsPanel steps={view.steps} /> : null}
      <OthersPanel others={view.others} />
    </>
  );
  const result = render(
    <main>
      <ReviewBand view={view} />
      {data.kind === "form" ? (
        <ReviewWriteForm
          mode={data.mode}
          enquiryId={data.enquiry.id}
          businessId={data.supplier.id}
          reviewId={data.reviewId}
          token="tok"
          initial={data.fields}
          photoUrls={data.photoUrls}
          company={data.company}
          supplierName={data.supplier.displayName}
          supplierListed={data.supplier.listed}
          provenance={data.provenance}
          postedAt={REVIEW_WRITE_NOW.toISOString()}
          draftSavedAt={null}
          cancelHref={null}
          header={<ReviewHeader view={view} />}
          railTop={rules}
          railBottom={bottom}
        />
      ) : (
        <>
          <div>
            <ReviewHeader view={view} />
            {view.body.kind === "notice" ? <NoticeBody body={view.body} /> : null}
            {view.body.kind === "choose" ? <ChooseBody body={view.body} /> : null}
            {view.body.kind === "reviewed" && data.kind === "reviewed" ? (
              <ReviewedBody
                body={view.body}
                copy={{
                  fields: data.review.fields,
                  photoUrls: data.review.photoUrls,
                  company: data.company,
                  supplierName: data.supplier.displayName,
                  provenance: data.provenance,
                  postedAt: data.review.createdAt,
                  sellerReply: data.review.sellerReply,
                  replyRemoved: data.review.replyRemoved,
                }}
              />
            ) : null}
          </div>
          <aside aria-label="About reviews">
            {rules}
            {bottom}
          </aside>
        </>
      )}
    </main>,
  );
  return { view, ...result };
}

describe("the board as drawn — a draft in progress", () => {
  it("names the job before any question, with the corrected figure and the accepted-quote badge", () => {
    renderPage(drawnReview());
    expect(screen.getByRole("heading", { level: 1, name: "Review Sparkle Facilities Services" })).toBeTruthy();
    expect(screen.getByText("Open until 31 Oct 2026 — 90 days after acceptance")).toBeTruthy();
    expect(
      screen.getByText("ENQ-8802 · Accepted 2 Aug 2026 · Deep clean AMC, 3 retail units · Sharjah · AED 9,600"),
    ).toBeTruthy();
    // 1m's ladder: an accepted quote is the green rung, and the board's
    // "Verified enquiry" on it was the wrong one.
    expect(screen.getAllByText("Accepted quote").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("Verified enquiry")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Verified (buyer|purchase|customer|order)/);
  });

  it("asks the four dimensions under 1m's labels, in 1m's order — the same names RATED ON prints", () => {
    const { unmount } = renderPage(drawnReview());
    const asked = ["Quoted accurately", "Delivered on time", "Product as described", "Responsiveness"].filter((name) =>
      screen.queryByRole("group", { name }),
    );
    unmount();
    render(
      <RatedOnCard
        summary={{
          count: 5,
          average: 4.2,
          distribution: [],
          dimensions: [
            { key: "quotedAccurate", average: 4.5 },
            { key: "onTime", average: 3.8 },
            { key: "asDescribed", average: null },
            { key: "responsiveness", average: 4.9 },
          ],
        }}
      />,
    );
    const printed = screen.getAllByRole("term").map((term) => term.textContent);
    expect(asked).toEqual(printed);
    // A dimension nobody scored is said, never drawn as 0.0.
    expect(screen.getByText("Not scored yet")).toBeTruthy();
  });

  it("previews 1m's row, signed as chosen, and moves with the form", async () => {
    renderPage(drawnReview());
    const user = userEvent.setup();
    const preview = screen.getByText("How it will appear").parentElement!;
    expect(within(preview).getByText("Marina Facilities LLC")).toBeTruthy();
    expect(within(preview).getByRole("img", { name: "Rated 4 out of 5" })).toBeTruthy();

    await user.click(screen.getByText("Buyer, name withheld", { selector: "span" }));
    expect(within(preview).getByText("Buyer, name withheld")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Skip Delivered on time" }));
    const onTime = within(preview).getByText("Delivered on time").nextElementSibling!;
    expect(onTime.textContent).toBe("Skipped");
  });

  it("enables Post on a complete review, and refuses contact details as they are typed", async () => {
    renderPage(drawnReview());
    const user = userEvent.setup();
    const post = screen.getByRole("button", { name: "Post review" });
    expect((post as HTMLButtonElement).disabled).toBe(false);

    const body = screen.getByLabelText("What should another buyer know?");
    await user.type(body, " Ring 050 641 2288.");
    expect(screen.getByText("Take out the phone number. A review cannot carry contact details.")).toBeTruthy();
    expect((post as HTMLButtonElement).disabled).toBe(true);
  });

  it("states the steps without an invented latency or a withdrawal route that has no ground", () => {
    renderPage(drawnReview());
    expect(document.body.textContent).not.toMatch(/under an hour|three times as often|4\.2 to 4\.3|ask support to withdraw/);
    expect(screen.getByText("They get one public reply, within 28 days. They cannot edit or remove what you wrote.")).toBeTruthy();
  });

  it("draws the gate: one enquiry that qualifies beside one that does not, with the reason", () => {
    renderPage(drawnReview());
    const rail = screen.getByText("Your other enquiries").parentElement!;
    expect(within(rail).getByText("Open until 19 Nov")).toBeTruthy();
    expect(within(rail).getByText("Not eligible")).toBeTruthy();
    expect(within(rail).getByText("ENQ-8744 · No supplier replied")).toBeTruthy();
  });

  it("is axe clean", async () => {
    const { container } = renderPage(drawnReview());
    await expectNoAxeViolations(container);
  });
});

describe("the other states", () => {
  it("disables Post on an empty form and says what is missing (B5)", () => {
    renderPage(emptyReview());
    expect((screen.getByRole("button", { name: "Post review" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("To post: choose an overall score, and write at least 40 characters.")).toBeTruthy();
    expect(screen.getByText("Choose an overall score and the review appears here as the listing will show it.")).toBeTruthy();
  });

  it("offers one way to sign when the account has no company", () => {
    renderPage(anonymousReview());
    expect(screen.getAllByRole("radio", { name: /name withheld/i })).toHaveLength(1);
    expect(screen.queryByText("Marina Facilities LLC")).toBeNull();
    expect(screen.getByText("There is no company on your account, so the review is signed this way.")).toBeTruthy();
    expect(screen.getAllByText("Verified enquiry").length).toBeGreaterThanOrEqual(1);
  });

  it("closed: the form is absent, not disabled, and the day and the rule are stated", async () => {
    const { container } = renderPage(windowClosed());
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText("Reviews closed on 16 Aug 2026")).toBeTruthy();
    expect(screen.getByText(/A review stays open for 90 days after the quote is accepted/)).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it("not eligible: the reason and a link to the enquiry, never a form (B1)", () => {
    renderPage(notEligible());
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to ENQ-8744" }).getAttribute("href")).toBe("/enquiry/ENQ-8744?t=tok");
  });

  it("a fan-out: asks which supplier, and links each with its subject", () => {
    renderPage(chooseSupplier());
    const hrefs = screen.getAllByRole("link", { name: /Review this supplier/ }).map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([
      "/review/new?enq=ENQ-8790&about=biz-alwaha&t=tok",
      "/review/new?enq=ENQ-8790&about=biz-gulf&t=tok",
    ]);
  });

  it("seller replied: read-only, the reply shown, no Edit, no counter-reply", async () => {
    const { container } = renderPage(reviewedReplied());
    expect(screen.queryByRole("link", { name: "Edit review" })).toBeNull();
    expect(screen.getByText(/There is no counter-reply/)).toBeTruthy();
    expect(screen.getByText(/standby van now covers early slots/)).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it("held: the buyer's own copy with the hold said, and no link to a listing it is off", () => {
    renderPage(reviewedHeld());
    expect(screen.getByText("Held for a check")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /See it on the listing/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Edit review" })).toBeNull();
  });
});
