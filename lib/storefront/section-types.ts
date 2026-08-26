/**
 * The section catalogue — board 5c.
 *
 * Fourteen types, plus one that is deliberately visible and disabled. This is
 * code and not a table, and the spec is explicit about why: *"Adding a new type
 * is a code change, not a config change."* A staff member composes a template
 * out of these; nobody types a new one into a form.
 *
 * Each type declares three things that the rest of step 6 reads:
 *
 *   - **where its content comes from**, which is always data the seller already
 *     has. That is the point of the whole model: enabling a section is a click
 *     for staff and no content work for the seller.
 *   - **which fields a seller may fill**, which bounds what
 *     `TemplateSection.sellerEditableFields` can contain and what
 *     `StorefrontContent` will accept at write time.
 *   - **whether it is a singleton**, which is denormalised onto the row so a
 *     partial unique index can enforce it rather than a service remembering to.
 *
 * ## What is not here
 *
 * No price field on any type. Non-negotiable 1 — a public surface shows
 * availability and an enquiry action where a price would sit — and a section
 * catalogue is the natural place for somebody to add one by accident.
 *
 * The offer banner's `reference` is the near miss. The spec called it `code`,
 * which reads as a redeemable discount code and would be a price mechanism on a
 * public surface. It is a marketing string a buyer quotes inside an enquiry —
 * "mention RAMADAN26" — so it is renamed, never validated, and never stored
 * against a value.
 */

export type SectionGroup = "sell" | "prove" | "contact";

export type SellerFieldType = "line" | "text" | "image" | "date" | "picks";

export interface SellerField {
  key: string;
  /** Catalogue key for the label. */
  labelKey: string;
  type: SellerFieldType;
  /** Longest a seller may write. Lines are headlines; text is a paragraph. */
  maxLength?: number;
  /** For `picks`: how many they must choose. */
  min?: number;
  max?: number;
}

export interface SectionType {
  key: string;
  labelKey: string;
  /** What it reads. Shown on the section library card and the specimens page. */
  sourceKey: string;
  group: SectionGroup;
  /** Two of these in one template is a mistake the database refuses. */
  singleton: boolean;
  /**
   * Cannot be moved, disabled or removed. Criterion 6.
   *
   * Only the header. The footer is platform chrome rather than a section — it
   * carries the attribution badge and there is no row for it to be a row of,
   * which is a stronger guarantee than a flag.
   */
  fixed: boolean;
  /** Visible in the library, refused by the builder. Criterion 10. */
  comingSoon: boolean;
  sellerFields: SellerField[];
}

const line = (key: string, maxLength: number): SellerField => ({
  key,
  labelKey: `section.field.${key}`,
  type: "line",
  maxLength,
});

export const SECTION_TYPES: readonly SectionType[] = [
  {
    key: "header",
    labelKey: "section.header",
    sourceKey: "section.source.header",
    group: "contact",
    singleton: true,
    fixed: true,
    comingSoon: false,
    sellerFields: [],
  },
  {
    key: "hero",
    labelKey: "section.hero",
    sourceKey: "section.source.hero",
    group: "sell",
    singleton: true,
    fixed: false,
    comingSoon: false,
    sellerFields: [
      line("eyebrow", 40),
      line("headline", 90),
      line("buttonLabel", 30),
      { key: "image", labelKey: "section.field.image", type: "image" },
    ],
  },
  {
    key: "trust_strip",
    labelKey: "section.trust_strip",
    sourceKey: "section.source.trust_strip",
    group: "prove",
    singleton: true,
    fixed: false,
    comingSoon: false,
    // Nothing. Every figure on it is derived, and a seller-editable trust
    // signal is not a trust signal — non-negotiable 6 says the same thing
    // about response time.
    sellerFields: [],
  },
  {
    key: "featured_products",
    labelKey: "section.featured_products",
    sourceKey: "section.source.featured_products",
    group: "sell",
    singleton: false,
    fixed: false,
    comingSoon: false,
    sellerFields: [
      { key: "products", labelKey: "section.field.products", type: "picks", min: 4, max: 8 },
    ],
  },
  {
    key: "catalogue_grid",
    labelKey: "section.catalogue_grid",
    sourceKey: "section.source.catalogue_grid",
    group: "sell",
    singleton: true,
    fixed: false,
    comingSoon: false,
    sellerFields: [
      { key: "categories", labelKey: "section.field.categories", type: "picks", max: 12 },
    ],
  },
  {
    key: "brands",
    labelKey: "section.brands",
    sourceKey: "section.source.brands",
    group: "prove",
    singleton: false,
    fixed: false,
    comingSoon: false,
    sellerFields: [{ key: "logos", labelKey: "section.field.logos", type: "picks", max: 24 }],
  },
  {
    key: "certifications",
    labelKey: "section.certifications",
    sourceKey: "section.source.certifications",
    group: "prove",
    singleton: false,
    fixed: false,
    comingSoon: false,
    /*
     * `documents`, and the kinds are fenced at the service layer.
     *
     * `Document` holds trade licences and VAT certificates in the same private
     * bucket, separated from a certificate by one seller-chosen enum value —
     * and the seller was promised, in as many words, that those files are never
     * on their public listing. `PUBLISHABLE_DOCUMENT_KINDS` is that fence.
     */
    sellerFields: [{ key: "documents", labelKey: "section.field.documents", type: "picks", max: 12 }],
  },
  {
    key: "branches",
    labelKey: "section.branches",
    sourceKey: "section.source.branches",
    group: "contact",
    singleton: true,
    fixed: false,
    comingSoon: false,
    sellerFields: [],
  },
  {
    key: "reviews",
    labelKey: "section.reviews",
    sourceKey: "section.source.reviews",
    group: "prove",
    singleton: true,
    fixed: false,
    comingSoon: false,
    sellerFields: [],
  },
  {
    key: "enquiry_form",
    labelKey: "section.enquiry_form",
    sourceKey: "section.source.enquiry_form",
    group: "contact",
    singleton: true,
    fixed: false,
    comingSoon: false,
    sellerFields: [line("intro", 140)],
  },
  {
    key: "team",
    labelKey: "section.team",
    sourceKey: "section.source.team",
    group: "contact",
    singleton: false,
    fixed: false,
    comingSoon: false,
    /*
     * Picks from `TeamMember`, not free text.
     *
     * The spec says "names, roles, numbers", which is a personal phone number
     * on a public page. It gets a row with a consent timestamp that cannot be
     * null, and the number defaults to the branch line rather than anybody's
     * mobile — in the same handoff that builds the PDPL erasure path.
     */
    sellerFields: [{ key: "members", labelKey: "section.field.members", type: "picks", max: 12 }],
  },
  {
    key: "offer_banner",
    labelKey: "section.offer_banner",
    sourceKey: "section.source.offer_banner",
    group: "sell",
    singleton: false,
    fixed: false,
    comingSoon: false,
    sellerFields: [
      line("headline", 70),
      { key: "body", labelKey: "section.field.body", type: "text", maxLength: 200 },
      // Not a discount code. A string a buyer quotes inside an enquiry, never
      // validated and never stored against a value.
      line("reference", 24),
      { key: "endsOn", labelKey: "section.field.endsOn", type: "date" },
    ],
  },
  {
    key: "spec_comparison",
    labelKey: "section.spec_comparison",
    sourceKey: "section.source.spec_comparison",
    group: "sell",
    singleton: false,
    fixed: false,
    comingSoon: false,
    sellerFields: [
      { key: "attributes", labelKey: "section.field.attributes", type: "picks", max: 8 },
    ],
  },
  {
    key: "downloads",
    labelKey: "section.downloads",
    sourceKey: "section.source.downloads",
    group: "prove",
    singleton: false,
    fixed: false,
    comingSoon: false,
    sellerFields: [{ key: "documents", labelKey: "section.field.documents", type: "picks", max: 24 }],
  },
  {
    key: "services",
    labelKey: "section.services",
    sourceKey: "section.source.services",
    group: "sell",
    singleton: true,
    fixed: false,
    /*
     * Visible and disabled, on purpose.
     *
     * The services model is not built. Leaving the card in the library with the
     * gap legible is better than hiding it and having somebody rediscover the
     * absence when a seller asks for it.
     */
    comingSoon: true,
    sellerFields: [],
  },
];

/** The fourteen that can actually be added. */
export const BUILDABLE_SECTION_TYPES = SECTION_TYPES.filter((type) => !type.comingSoon);

const BY_KEY = new Map(SECTION_TYPES.map((type) => [type.key, type]));

export function sectionType(key: string): SectionType | undefined {
  return BY_KEY.get(key);
}

/**
 * Document kinds a public section may show.
 *
 * `trade_licence` and `vat_certificate` are absent and that is the whole point.
 * They live in the same private bucket as everything else in `Document`, and
 * `verify_listing.documents_hint` promises the seller they are never on their
 * public listing. Building Certifications and Downloads without this fence
 * would break a promise the product already makes, in writing, on the screen
 * where the file is uploaded.
 */
export const PUBLISHABLE_DOCUMENT_KINDS = ["certificate", "catalogue", "datasheet"] as const;

export type PublishableDocumentKind = (typeof PUBLISHABLE_DOCUMENT_KINDS)[number];

export function isPublishableDocumentKind(kind: string): kind is PublishableDocumentKind {
  return (PUBLISHABLE_DOCUMENT_KINDS as readonly string[]).includes(kind);
}

/** Field keys a seller may be given for one type. Bounds `sellerEditableFields`. */
export function sellerFieldKeys(typeKey: string): string[] {
  return sectionType(typeKey)?.sellerFields.map((field) => field.key) ?? [];
}
