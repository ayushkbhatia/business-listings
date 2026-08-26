import type { SectionProps } from "@/lib/storefront/render-data";
import { Brands } from "./Brands";
import { Branches } from "./Branches";
import { CatalogueGrid } from "./CatalogueGrid";
import { Certifications } from "./Certifications";
import { Downloads } from "./Downloads";
import { EnquiryForm } from "./EnquiryForm";
import { FeaturedProducts } from "./FeaturedProducts";
import { Header } from "./Header";
import { Hero } from "./Hero";
import { OfferBanner } from "./OfferBanner";
import { Reviews } from "./Reviews";
import { Services } from "./Services";
import { SpecComparison } from "./SpecComparison";
import { Team } from "./Team";
import { TrustStrip } from "./TrustStrip";

/**
 * Section type key to renderer.
 *
 * The one place the catalogue and the components meet. A type in
 * `section-types.ts` with no entry here is a type that would silently render
 * nothing on every storefront in its sector, so a test asserts the two lists
 * are the same set — which is the check that makes one catalogue safe rather
 * than two lists that drift.
 */
export const SECTION_RENDERERS: Record<string, (props: SectionProps) => React.ReactNode> = {
  header: Header,
  hero: Hero,
  trust_strip: TrustStrip,
  featured_products: FeaturedProducts,
  catalogue_grid: CatalogueGrid,
  brands: Brands,
  certifications: Certifications,
  branches: Branches,
  reviews: Reviews,
  enquiry_form: EnquiryForm,
  team: Team,
  offer_banner: OfferBanner,
  spec_comparison: SpecComparison,
  downloads: Downloads,
  services: Services,
};

export function renderSection(props: SectionProps): React.ReactNode {
  const Renderer = SECTION_RENDERERS[props.section.type];
  // A type with no renderer renders nothing rather than throwing. A deploy that
  // made every storefront in a sector 500 is worse than one that dropped a
  // section until somebody noticed — the same call `resolveSections` makes.
  return Renderer ? <Renderer {...props} /> : null;
}
