/**
 * Board 6a — the area landing page, as one module.
 *
 * §1: *"One template, one controller, one scope object."* Both public routes
 * import from here; nothing imports the files individually except the services
 * in `lib/seo/area.ts` and `lib/seo/emirate.ts`, which own publishing.
 */
export * from "./limits";
export * from "./scope";
export * from "./resolve-by-id";
export * from "./freshness";
export * from "./links";
export * from "./stats";
export * from "./quote-range";
export * from "./faq";
export * from "./metadata";
export * from "./read-next";
export * from "./slug-namespace";
export * from "./content";
