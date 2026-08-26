/**
 * The section renderers.
 *
 * One per `SectionType`, and the catalogue of record is
 * `lib/storefront/section-types.ts` rather than this file or the component
 * inventory. Two lists of fourteen things is one list too many — which is the
 * failure the inventory's own note on `Thread` describes.
 *
 * `/admin/storefront-templates/specimens` is the gallery for these, the way
 * `/dev/gallery` is for the design system.
 */
export { Header } from "./Header";
export { Hero } from "./Hero";
export { TrustStrip } from "./TrustStrip";
export { FeaturedProducts } from "./FeaturedProducts";
export { CatalogueGrid } from "./CatalogueGrid";
export { Brands } from "./Brands";
export { Certifications } from "./Certifications";
export { Branches } from "./Branches";
export { Reviews } from "./Reviews";
export { EnquiryForm } from "./EnquiryForm";
export { Team } from "./Team";
export { OfferBanner } from "./OfferBanner";
export { SpecComparison } from "./SpecComparison";
export { Downloads } from "./Downloads";
export { Services } from "./Services";
export { PageBlocks, type PageBlocksProps } from "./PageBlocks";
export { SECTION_RENDERERS, renderSection } from "./registry";
