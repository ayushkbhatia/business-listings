import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../axe";
import { OwnListingNote } from "@/app/(public)/b/[slug]/_own";
import { ProductCard } from "@/components/domain/ProductCard";
import { ServiceSummaryCard } from "@/components/domain/ServicesStorefront";
import { Hero } from "@/components/storefront/Hero";
import type { SectionProps } from "@/lib/storefront/render-data";
import { t } from "@/lib/i18n";

/**
 * No business enquires to itself, so a storefront offers its own team no
 * composer and nothing that opens one (`app/(public)/b/[slug]/_own.tsx`).
 *
 * The shared pieces the storefront draws say "none" with null and keep their
 * old default for undefined, so every other screen that carries them renders
 * exactly as it did. Each is asserted both ways.
 */

const PRODUCT = {
  slug: "pvc-conduit",
  businessSlug: "copperfield-industrial-supplies-llc",
  name: "PVC conduit, heavy gauge, 3 m 25 mm",
  availability: "in_stock" as const,
};

const enquire = () => screen.queryAllByText(t("listing.enquire"));

describe("ProductCard — the enquiry affordance", () => {
  it("links where there is somewhere to send the buyer", () => {
    render(<ProductCard product={PRODUCT} enquireHref="/b/copperfield-industrial-supplies-llc/products" />);
    expect(screen.getByRole("link", { name: t("listing.enquire") })).toHaveAttribute(
      "href",
      "/b/copperfield-industrial-supplies-llc/products",
    );
  });

  it("stays disabled with no href, as before", () => {
    render(<ProductCard product={PRODUCT} />);
    expect(screen.getByRole("button", { name: t("listing.enquire") })).toBeDisabled();
  });

  it("draws none for the seller's own team — not a disabled promise of one", () => {
    render(<ProductCard product={PRODUCT} enquireHref={null} />);
    expect(enquire()).toHaveLength(0);
  });
});

describe("ServiceSummaryCard — the enquire control", () => {
  const service = { slug: "statutory-audit", name: "Statutory audit", chips: ["Annual"], deliverable: null };

  it("defaults to the storefront's composer anchor", () => {
    render(<ServiceSummaryCard service={service} businessSlug="meridian-chartered-accountants" />);
    expect(enquire()).toHaveLength(1);
  });

  it("draws none for the firm's own team, and keeps the link to the scope", () => {
    render(<ServiceSummaryCard service={service} businessSlug="meridian-chartered-accountants" enquire={null} />);
    expect(enquire()).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Statutory audit" })).toBeInTheDocument();
  });
});

describe("Hero — the call to action", () => {
  const data = {
    heroImageUrl: null,
    business: { displayName: "Copperfield Industrial Supplies", description: null },
    copy: { "section.hero.enquire": "Send an enquiry" },
  } as unknown as SectionProps["data"];

  it("falls back to the catalogue link where no composer is slotted in", () => {
    render(<Hero data={data} enquireHref="/b/copperfield-industrial-supplies-llc/products" />);
    expect(screen.getByRole("link", { name: "Send an enquiry" })).toBeInTheDocument();
  });

  it("offers nothing for the seller's own team — the fallback would be an enquiry verb over nothing", () => {
    render(<Hero data={data} enquireHref="/b/copperfield-industrial-supplies-llc/products" enquireSlot={null} />);
    expect(screen.queryByRole("link", { name: "Send an enquiry" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Copperfield Industrial Supplies" })).toBeInTheDocument();
  });
});

describe("OwnListingNote — what sits where the composer would", () => {
  it("says whose listing it is, why there is no form, and where the enquiries arrive", async () => {
    const { container } = render(<OwnListingNote />);
    expect(screen.getByText(t("storefront.own.title"))).toBeInTheDocument();
    expect(screen.getByText(t("storefront.own.body"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t("storefront.own.leads") })).toHaveAttribute("href", "/dashboard/leads");
    // Static on arrival: announcing it would be noise.
    expect(container.querySelector("[role=alert], [role=status]")).toBeNull();
    await expectNoAxeViolations(container);
  });
});
