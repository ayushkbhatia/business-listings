import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../axe";
import { ListingCard, type ListingCardBusiness, type ListingContext } from "@/components/domain/ListingCard";
import { t } from "@/lib/i18n";

/**
 * Build plan 4.6 — the unclaimed card, read off the business.
 *
 * It existed and production never rendered it: the state was a fifth `context`
 * word only the gallery passed, so every layout a buyer could reach drew a
 * licence import as if somebody stood behind it. The caller now says which
 * layout, and `claimStatus` says which state — in all four layouts.
 */

const NOW = new Date("2026-10-01T09:00:00+04:00");
const LAYOUTS: ListingContext[] = ["search", "map", "grid", "ranked"];

const CLAIMED: ListingCardBusiness = {
  slug: "al-marwan-trading",
  displayName: "Al Marwan Trading",
  claimStatus: "claimed",
  categoryName: "Valves & fittings",
  categoryCode: "VF",
  areaName: "Al Quoz Industrial 1",
  emirateName: "Dubai",
  verificationTier: 2,
  verifiedAt: "2026-03-14T00:00:00+04:00",
  productCount: 92,
  reviewCount: 4,
  ratingOverall: 4.6,
  responseTimeMedianMs: 8_040_000,
  responseDurationLabel: "2 h 14 min",
  establishedYear: 2011,
  branchCount: 3,
  description: "Gate, globe and check valves for MEP contractors.",
  liveFact: "92 products in catalogue",
  rank: 3,
};

const UNCLAIMED: ListingCardBusiness = {
  slug: "deira-bearing-house",
  displayName: "Deira Bearing House",
  claimStatus: "unclaimed",
  licenceNumber: "DED-118904",
  licenceExpiry: "2027-01-31T00:00:00+04:00",
  categoryName: "Bearings & power transmission",
  categoryCode: "BP",
  areaName: "Deira",
  emirateName: "Dubai",
  verificationTier: 0,
  rank: 9,
};

function renderCard(business: ListingCardBusiness, context: ListingContext) {
  return render(
    <ListingCard
      business={business}
      context={context}
      now={NOW}
      enquireHref="/rfq/new?to=example"
      contactAction={<button type="button">WhatsApp</button>}
    />,
  );
}

describe("the caller picks the layout, the business picks the state", () => {
  for (const context of LAYOUTS) {
    it(`${context}: an unclaimed listing says so, and offers no enquiry or contact`, () => {
      const { container } = renderCard(UNCLAIMED, context);
      expect(screen.getByText(t("listing.unclaimed_title"))).toBeInTheDocument();
      expect(screen.queryByText(t("listing.enquire"))).toBeNull();
      expect(screen.queryByText("WhatsApp")).toBeNull();
      // No reply band, no unmeasured placeholder, no rating, no count.
      expect(container.textContent).not.toMatch(/replies|enquiries to measure|review|product/i);
    });

    it(`${context}: a claimed listing is drawn as one`, () => {
      renderCard(CLAIMED, context);
      expect(screen.queryByText(t("listing.unclaimed_title"))).toBeNull();
      // The grid tile has never carried actions; the three rows keep theirs.
      if (context !== "grid") {
        expect(screen.getAllByText(t("listing.enquire")).length).toBeGreaterThan(0);
      }
    });
  }

  it("reads a disputed listing as unclaimed, whatever it is handed — board 4c B10", () => {
    const { container } = renderCard(
      { ...CLAIMED, claimStatus: "disputed", licenceNumber: "DED-552190", licenceExpiry: "2027-03-14T00:00:00+04:00" },
      "search",
    );
    expect(screen.getByText(t("listing.unclaimed_title"))).toBeInTheDocument();
    // The rating, the counts, the description and the reply a claimant's seat
    // could have put there are all in the props, and none reaches the card.
    expect(container.textContent).not.toContain("4.6");
    expect(container.textContent).not.toContain("Gate, globe");
    expect(container.textContent).not.toMatch(/Trading since|92 products|3 branches|replies/);
    expect(screen.queryByText(t("listing.enquire"))).toBeNull();
  });
});

describe("the roomy layouts carry the panel as designed", () => {
  for (const context of ["search", "grid"] as const) {
    it(`${context}: claim prefilled with the licence, and the report`, () => {
      renderCard(UNCLAIMED, context);
      const claim = screen.getByRole("link", { name: t("listing.claim_cta") });
      expect(claim).toHaveAttribute("href", "/onboarding/claim?licence=DED-118904");
      expect(claim).toHaveAttribute("rel", expect.stringMatching(/nofollow/));
      // 13c's report, by the address that works with no modal behind it.
      expect(screen.getByRole("link", { name: t("listing.report") })).toHaveAttribute(
        "href",
        "/report/deira-bearing-house",
      );
      expect(screen.getByText(t("listing.unclaimed_body"))).toBeInTheDocument();
    });
  }

  it("withholds the claim on a lapsed licence, as the listing page does — 10g B4", () => {
    renderCard({ ...UNCLAIMED, licenceExpiry: "2026-09-30T00:00:00+04:00" }, "grid");
    expect(screen.queryByRole("link", { name: t("listing.claim_cta") })).toBeNull();
    expect(screen.getByRole("link", { name: t("listing.report") })).toBeInTheDocument();
  });
});

describe("the dense rows say it in a line and go to the listing", () => {
  for (const context of ["map", "ranked"] as const) {
    it(`${context}: View listing, and the rank the pin pairs with`, () => {
      const { container } = renderCard(UNCLAIMED, context);
      expect(screen.getByRole("link", { name: t("listing.view_listing") })).toHaveAttribute(
        "href",
        "/b/deira-bearing-house",
      );
      expect(screen.queryByRole("link", { name: t("listing.claim_cta") })).toBeNull();
      expect(container.textContent).toContain("9");
    });
  }

  it("search: the decision column goes to the listing, not a storefront", () => {
    renderCard(UNCLAIMED, "search");
    expect(screen.getByRole("link", { name: t("listing.view_listing") })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: t("listing.view_storefront") })).toBeNull();
  });
});

describe("accessibility", () => {
  for (const context of LAYOUTS) {
    it(`${context}: the unclaimed state is axe clean`, async () => {
      const { container } = renderCard(UNCLAIMED, context);
      await expectNoAxeViolations(container);
    });
  }
});
