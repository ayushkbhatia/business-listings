/**
 * Which half of the directory each trade belongs to — board `4d-s`'s column,
 * filled in, and `4e-s` B5's assignments that follow from it.
 *
 * `4d-s` shipped `Category.tradeKind`, the ancestor walk that resolves it, and
 * six classifications. Everything else resolved to `goods` by default, which
 * put 401 subcategories on the wrong side of a directory that is roughly half
 * services — and left every downstream board (`8c-s`'s matching badges,
 * `4e-s`'s family assignments, `10c-s`'s kind-scoped facets) correct against a
 * taxonomy that was not.
 *
 * ## The rule
 *
 * A trade is **services** when what a buyer receives is *work performed* rather
 * than *an item delivered*: no SKU, no stock level, no spec sheet, and priced
 * by time, output, visit or retainer rather than by unit.
 *
 * Two consequences are worth stating, because both are judgement calls
 * somebody will want to revisit:
 *
 * - **Software is services.** A licence has no stock and is delivered as an
 *   engagement; the scope sheet's fields — engagement type, turnaround, fee
 *   basis, deliverable — describe it far better than a spec table does.
 * - **Made-to-order manufacture is goods.** Steel fabrication, joinery, a
 *   printed brochure and a switchgear panel are all built to a drawing, and
 *   every one has a specification a buyer compares on. "Made to order" is the
 *   buyer's own process, which `CLAUDE.md` § Vocabulary already says is not a
 *   platform concept.
 *
 * ## Set at the highest level that is true
 *
 * The walk means a sector set once covers every child that does not disagree,
 * so this is thirteen sector defaults and seventy exceptions rather than 440
 * rows. That is the shape `Category.tradeKind`'s own docblock asks for, and it
 * keeps the list reviewable: a reader checks a sector in one line, then reads
 * only what argues with it.
 *
 * ## Where it is applied
 *
 * The **seed**, because CI builds its database from it and a fixture with one
 * kind tests nothing. And **`20261009090000_classify_trade_kinds`**, once,
 * against production's existing rows. Production's taxonomy stays ops' to
 * maintain through the admin screens, where each write is audited with a
 * reason; a taxonomy decision must not cost a deploy.
 */

export type Kind = "goods" | "services";

export interface SectorKinds {
  /** The sector's own slug. */
  slug: string;
  /** What its children are, unless they say otherwise. */
  kind: Kind;
  /** The children that disagree, by name. Absent where the sector is uniform. */
  except?: readonly string[];
}

export const TRADE_KINDS: readonly SectorKinds[] = [
  {
    // Materials are sold by the tonne and the sheet; the work that puts them in
    // place is an engagement with a programme and a contract sum.
    slug: "construction-and-building-materials",
    kind: "goods",
    except: [
      "Architectural & engineering design",
      "Asphalt & road works",
      "Civil contracting",
      "Demolition & dismantling",
      "Heavy equipment rental",
      "Interior fit-out",
      "MEP contracting",
      "Piling & foundations",
      "Project management",
      "Quantity surveying",
      "Shoring & excavation support",
      "Soil & material testing",
      "Surveying & setting out",
      "Swimming pool construction",
      "Waterproofing",
    ],
  },
  {
    slug: "electrical-and-cable",
    kind: "goods",
    except: ["Cable jointing & termination", "Electrical testing"],
  },
  {
    // The one sector that is services almost end to end. Only the furniture is
    // a thing you take delivery of.
    slug: "facilities-management-and-cleaning",
    kind: "services",
    except: ["Office furniture"],
  },
  {
    slug: "hvac-and-ventilation",
    kind: "goods",
    except: [
      "District cooling services",
      "Duct cleaning",
      "Energy audits & retrofit",
      "HVAC maintenance AMC",
      "HVAC water treatment",
      "Testing & commissioning",
    ],
  },
  {
    // The most mixed sector on the directory, and close to an even split: the
    // hardware has a spec sheet and the software and the support do not.
    slug: "it-telecom-and-software",
    kind: "goods",
    except: [
      "AI & automation services",
      "Backup & disaster recovery",
      "Cloud & hosting",
      "CRM software",
      "Cybersecurity",
      "Data analytics & BI",
      "Digital transformation consulting",
      "E-commerce platforms",
      "ERP & accounting software",
      "HR & payroll software",
      "IT relocation & installation",
      "IT staffing & outsourcing",
      "IT support & AMC",
      "Mobile app development",
      "Software development",
      "Software licensing",
      "Structured cabling",
      "Telecom services",
      "Web design & development",
    ],
  },
  // Uniform, and the one whole sector `4d-s` classified before this pass.
  { slug: "legal-audit-and-business-setup", kind: "services" },
  {
    slug: "logistics-and-freight",
    kind: "services",
    except: ["Container sales & leasing", "Material handling equipment"],
  },
  { slug: "packaging-and-materials", kind: "goods" },
  {
    slug: "pipes-and-tubing",
    kind: "goods",
    except: ["Pipe coating & lining", "Pipe testing & inspection", "Pipe threading & cutting"],
  },
  {
    // Print is made to order and has a specification — size, stock, finish — so
    // it stays goods. What is sold as a day, a crew or a campaign does not.
    slug: "printing-signage-and-events",
    kind: "goods",
    except: [
      "3D printing & prototyping",
      "AV, staging & lighting",
      "Binding & finishing",
      "Catering equipment rental",
      "Copywriting & translation",
      "Digital marketing",
      "Engraving & laser cutting",
      "Event furniture rental",
      "Event management",
      "Event staffing",
      "Exhibition stands",
      "Graphic design & branding",
      "Photography & video",
      "PR & communications",
      "Shop fitting & retail displays",
      "Tents & marquees",
      "Vehicle branding & wraps",
      "Video & film production",
    ],
  },
  // A sector with no children of its own, classified as the leaf it is.
  { slug: "pumps-and-motors", kind: "goods" },
  {
    slug: "safety-and-ppe",
    kind: "goods",
    except: ["Extinguisher refilling", "HSE consultancy", "Safety training", "Traffic management"],
  },
  { slug: "valves-and-fittings", kind: "goods" },
];

/** The goods leaf `4d-s` set inside a goods sector, kept as its own fixture. */
export const LEAF_OVERRIDES: readonly { slug: string; kind: Kind }[] = [
  { slug: "servers-and-storage", kind: "goods" },
];

/* ── Which scope sheet each services trade answers to ─────────────────────── */

/**
 * Board `4e-s` B5, for the 169 services subcategories classifying produced.
 *
 * `4e-s` assigned the 39 that existed when it shipped. Classifying the rest
 * turned 39 into 169, and a subcategory with no family falls back to the
 * generic sheet — usable, and noticeably worse, which B6 makes the pressure to
 * do this rather than a reason not to.
 *
 * ## Assigned by how the work is charged, not by which sector it sits in
 *
 * A family is a fee-basis set and a row order, so the question for each trade
 * is which of the five sets a seller would actually pick from:
 *
 * - **Professional services** — per return, per filing, retainer, per hour,
 *   fixed fee. Advice, compliance, and anything sold as a subscription.
 * - **On-site maintenance** — per month, per visit, per sq ft/yr, per job, on
 *   assessment. Recurring work at the client's premises.
 * - **Inspection & certification** — per visit, per certificate, per asset,
 *   fixed fee. Anything whose deliverable is a finding.
 * - **Logistics & clearance** — per container, per shipment, per declaration,
 *   per kg. Moving and clearing goods.
 * - **Project & advisory** — fixed fee, per phase, a percentage of the value,
 *   on assessment. Defined pieces of work with a start and an end.
 *
 * That is why a few land somewhere their sector would not suggest: cargo
 * inspection is an inspection before it is logistics, an office move is a move
 * before it is facilities, and a crane hired by the day is priced like a job
 * rather than like a container.
 */
export interface SectorFamilies {
  slug: string;
  /** The family every services leaf in this sector takes, unless named below. */
  family: string;
  except?: Readonly<Record<string, string>>;
}

export const SCOPE_FAMILIES: readonly SectorFamilies[] = [
  {
    slug: "construction-and-building-materials",
    family: "project-advisory",
    except: {
      "Heavy equipment rental": "on-site-maintenance",
      "Soil & material testing": "inspection-certification",
      "Surveying & setting out": "inspection-certification",
    },
  },
  {
    slug: "electrical-and-cable",
    family: "on-site-maintenance",
    except: { "Electrical testing": "inspection-certification" },
  },
  {
    slug: "facilities-management-and-cleaning",
    family: "on-site-maintenance",
    except: {
      "Building inspection & snagging": "inspection-certification",
      "Office moving": "logistics-clearance",
    },
  },
  {
    slug: "hvac-and-ventilation",
    family: "on-site-maintenance",
    except: {
      "Energy audits & retrofit": "project-advisory",
      "Testing & commissioning": "inspection-certification",
    },
  },
  {
    // Built things are projects; licences, support and advice are charged on a
    // retainer or by the hour.
    slug: "it-telecom-and-software",
    family: "project-advisory",
    except: {
      "Backup & disaster recovery": "professional-services",
      "CRM software": "professional-services",
      "Cloud & hosting": "professional-services",
      "ERP & accounting software": "professional-services",
      "HR & payroll software": "professional-services",
      "IT staffing & outsourcing": "professional-services",
      "IT support & AMC": "on-site-maintenance",
      "Software licensing": "professional-services",
      "Telecom services": "professional-services",
    },
  },
  { slug: "legal-audit-and-business-setup", family: "professional-services" },
  {
    slug: "logistics-and-freight",
    family: "logistics-clearance",
    except: {
      "Cargo inspection & survey": "inspection-certification",
      "Cargo insurance": "professional-services",
      "Crane hire & rigging": "project-advisory",
      "Fleet management": "on-site-maintenance",
      "Supply chain consultancy": "project-advisory",
      "Warehouse management systems": "project-advisory",
    },
  },
  {
    slug: "pipes-and-tubing",
    family: "project-advisory",
    except: { "Pipe testing & inspection": "inspection-certification" },
  },
  {
    slug: "printing-signage-and-events",
    family: "project-advisory",
    except: {
      "Copywriting & translation": "professional-services",
      "Digital marketing": "professional-services",
      "Event staffing": "professional-services",
      "PR & communications": "professional-services",
    },
  },
  {
    slug: "safety-and-ppe",
    family: "on-site-maintenance",
    except: {
      "HSE consultancy": "professional-services",
      "Safety training": "professional-services",
    },
  },
];
