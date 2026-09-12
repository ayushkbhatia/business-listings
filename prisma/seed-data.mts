// Reference data for the seed. Every business, person, licence number and phone
// number below is fictional. The shapes are real: Al Quoz addresses, DED and
// SAIF licence formats, Sharjah Industrial Area sectors, split trading hours.

export const PLANS = [
  // `annualMonthsCharged` is months charged for a year — ten, so two are free.
  // Null on Free, because a discount on nothing is nothing, and null is what
  // `offersAnnual` reads to keep the year off a card that cannot sell one.
  // `categoryLimit` counts the primary category, so the extras a seller may add
  // on board 2c are this minus one: Free gets none, Basic two, Pro as many as it
  // likes. It is the cap that decides which RFQs reach a listing, which is what
  // makes the ladder mean something rather than being a paywall detail.
  { id: "free", name: "Free", monthlyPriceAed: 0, enquiriesPerMonth: 3, productLimit: 10, serviceLimit: 3, locationLimit: 1, photoLimit: 30, publicPhotoLimit: 3, storageMb: 50, teamSeats: 1, categoryLimit: 1, rankingMultiplier: 1.0, customDomain: false, analytics: false, csvImport: false, sponsoredEligible: false, sortOrder: 0, annualMonthsCharged: null },
  { id: "basic", name: "Basic", monthlyPriceAed: 349, enquiriesPerMonth: 40, productLimit: 150, serviceLimit: 15, locationLimit: 3, photoLimit: 40, publicPhotoLimit: null, storageMb: 300, teamSeats: 3, categoryLimit: 3, rankingMultiplier: 1.15, customDomain: false, analytics: true, csvImport: true, sponsoredEligible: false, sortOrder: 1, annualMonthsCharged: 10 },
  { id: "pro", name: "Pro", monthlyPriceAed: 899, enquiriesPerMonth: null, productLimit: null, serviceLimit: null, locationLimit: 10, photoLimit: 200, publicPhotoLimit: null, storageMb: 500, teamSeats: 10, categoryLimit: null, rankingMultiplier: 1.35, customDomain: true, analytics: true, csvImport: true, sponsoredEligible: true, sortOrder: 2, annualMonthsCharged: 10 },
] as const;

export const AREAS = [
  // Dubai
  { emirate: "dubai", name: "Al Quoz Industrial 1", slug: "al-quoz-industrial-1", nameAr: "القوز الصناعية 1", isFreeZone: false, lat: 25.1412, lng: 55.2311 },
  { emirate: "dubai", name: "Al Quoz Industrial 3", slug: "al-quoz-industrial-3", nameAr: "القوز الصناعية 3", isFreeZone: false, lat: 25.1268, lng: 55.2404 },
  { emirate: "dubai", name: "Deira", slug: "deira", nameAr: "ديرة", isFreeZone: false, lat: 25.2697, lng: 55.3095 },
  { emirate: "dubai", name: "Ras Al Khor Industrial 2", slug: "ras-al-khor-industrial-2", nameAr: "رأس الخور الصناعية 2", isFreeZone: false, lat: 25.1783, lng: 55.3486 },
  { emirate: "dubai", name: "Jebel Ali Free Zone", slug: "jebel-ali-free-zone", nameAr: "المنطقة الحرة بجبل علي", isFreeZone: true, lat: 25.0110, lng: 55.0618 },
  { emirate: "dubai", name: "Dubai Investments Park 2", slug: "dubai-investments-park-2", nameAr: "مجمع دبي للاستثمار 2", isFreeZone: false, lat: 24.9770, lng: 55.1731 },
  { emirate: "dubai", name: "Al Qusais Industrial 4", slug: "al-qusais-industrial-4", nameAr: "القصيص الصناعية 4", isFreeZone: false, lat: 25.2843, lng: 55.3925 },
  // Sharjah
  { emirate: "sharjah", name: "Industrial Area 4", slug: "sharjah-industrial-area-4", nameAr: "المنطقة الصناعية 4", isFreeZone: false, lat: 25.3197, lng: 55.4083 },
  { emirate: "sharjah", name: "Industrial Area 12", slug: "sharjah-industrial-area-12", nameAr: "المنطقة الصناعية 12", isFreeZone: false, lat: 25.3312, lng: 55.4471 },
  { emirate: "sharjah", name: "SAIF Zone", slug: "saif-zone", nameAr: "المنطقة الحرة بمطار الشارقة", isFreeZone: true, lat: 25.3283, lng: 55.5172 },
  { emirate: "sharjah", name: "Al Sajaa Industrial", slug: "al-sajaa-industrial", nameAr: "السجعة الصناعية", isFreeZone: false, lat: 25.3868, lng: 55.6224 },
  // Abu Dhabi
  { emirate: "abu_dhabi", name: "Mussafah M-17", slug: "mussafah-m17", nameAr: "مصفح م-17", isFreeZone: false, lat: 24.3441, lng: 54.5089 },
  { emirate: "abu_dhabi", name: "Mussafah M-40", slug: "mussafah-m40", nameAr: "مصفح م-40", isFreeZone: false, lat: 24.3283, lng: 54.5312 },
  { emirate: "abu_dhabi", name: "ICAD I", slug: "icad-i", nameAr: "مدينة أبوظبي الصناعية 1", isFreeZone: false, lat: 24.3020, lng: 54.5601 },
  { emirate: "abu_dhabi", name: "KIZAD", slug: "kizad", nameAr: "كيزاد", isFreeZone: true, lat: 24.7511, lng: 54.6389 },
  // Ajman
  { emirate: "ajman", name: "New Industrial Area", slug: "ajman-new-industrial-area", nameAr: "المنطقة الصناعية الجديدة", isFreeZone: false, lat: 25.3891, lng: 55.4903 },
  { emirate: "ajman", name: "Ajman Free Zone", slug: "ajman-free-zone", nameAr: "المنطقة الحرة بعجمان", isFreeZone: true, lat: 25.4052, lng: 55.4438 },
  // ── Board `2d-s`: Al Ain, and the free zones a firm registers in ──────────
  //
  // Al Ain is not a free zone and not an emirate. It is the second city of Abu
  // Dhabi, 160 km from the capital, and buyers there search it as though it were
  // an emirate — which is exactly why coverage is a table of areas rather than
  // the seven-value `Emirate` enum. Khor Fakkan and Ruwais arrive the same way,
  // as rows.
  { emirate: "abu_dhabi", name: "Al Ain", slug: "al-ain", nameAr: null, isFreeZone: false, lat: null, lng: null, searchedAsEmirate: true },
  //
  // Then the free zones. The list held four, which is enough for a toggle that
  // filters a warehouse's address and nowhere near enough for a picker a firm
  // uses to say which zones it is approved to work in — `2d-s` needs the real
  // list, and the screen counts it rather than claiming a number.
  //
  // `nameAr`, `lat` and `lng` are null on every one of these, deliberately: an
  // Arabic name or a coordinate typed from memory is a fact this directory has
  // not got. The centre only seeds a new branch pin and the seller drags it, so
  // a missing one costs a drag and a wrong one costs a wrong address.
  // Dubai
  { emirate: "dubai", name: "DMCC", slug: "dmcc", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "DIFC", slug: "difc", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Dubai Airport Free Zone", slug: "dubai-airport-free-zone", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Dubai Silicon Oasis", slug: "dubai-silicon-oasis", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Dubai Internet City", slug: "dubai-internet-city", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Dubai Media City", slug: "dubai-media-city", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Dubai Studio City", slug: "dubai-studio-city", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Dubai Production City", slug: "dubai-production-city", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Dubai Knowledge Park", slug: "dubai-knowledge-park", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Dubai Science Park", slug: "dubai-science-park", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Dubai Design District", slug: "dubai-design-district", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Dubai Healthcare City", slug: "dubai-healthcare-city", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Dubai Outsource City", slug: "dubai-outsource-city", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Dubai World Trade Centre Free Zone", slug: "dwtc-free-zone", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Dubai South Free Zone", slug: "dubai-south-free-zone", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Dubai Maritime City", slug: "dubai-maritime-city", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Dubai Gold and Diamond Park", slug: "dubai-gold-and-diamond-park", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Dubai CommerCity", slug: "dubai-commercity", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "International Humanitarian City", slug: "international-humanitarian-city", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Meydan Free Zone", slug: "meydan-free-zone", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "IFZA", slug: "ifza", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "Dubai Auto Zone", slug: "dubai-auto-zone", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "dubai", name: "National Industries Park", slug: "national-industries-park", nameAr: null, isFreeZone: true, lat: null, lng: null },
  // Abu Dhabi
  { emirate: "abu_dhabi", name: "ADGM", slug: "adgm", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "abu_dhabi", name: "Masdar City Free Zone", slug: "masdar-city-free-zone", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "abu_dhabi", name: "Abu Dhabi Airport Free Zone", slug: "abu-dhabi-airport-free-zone", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "abu_dhabi", name: "twofour54", slug: "twofour54", nameAr: null, isFreeZone: true, lat: null, lng: null },
  // Sharjah
  { emirate: "sharjah", name: "Hamriyah Free Zone", slug: "hamriyah-free-zone", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "sharjah", name: "Sharjah Media City", slug: "sharjah-media-city", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "sharjah", name: "Sharjah Publishing City", slug: "sharjah-publishing-city", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "sharjah", name: "Sharjah Research Technology and Innovation Park", slug: "srtip", nameAr: null, isFreeZone: true, lat: null, lng: null },
  // Ajman
  { emirate: "ajman", name: "Ajman Media City Free Zone", slug: "ajman-media-city-free-zone", nameAr: null, isFreeZone: true, lat: null, lng: null },
  // Ras Al Khaimah
  { emirate: "ras_al_khaimah", name: "RAKEZ", slug: "rakez", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "ras_al_khaimah", name: "RAK Maritime City Free Zone", slug: "rak-maritime-city-free-zone", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "ras_al_khaimah", name: "RAK Digital Assets Oasis", slug: "rak-digital-assets-oasis", nameAr: null, isFreeZone: true, lat: null, lng: null },
  // Fujairah
  { emirate: "fujairah", name: "Fujairah Free Zone", slug: "fujairah-free-zone", nameAr: null, isFreeZone: true, lat: null, lng: null },
  { emirate: "fujairah", name: "Creative City Fujairah", slug: "creative-city-fujairah", nameAr: null, isFreeZone: true, lat: null, lng: null },
  // Umm Al Quwain
  { emirate: "umm_al_quwain", name: "Umm Al Quwain Free Trade Zone", slug: "uaq-free-trade-zone", nameAr: null, isFreeZone: true, lat: null, lng: null },
] as const;

export const CATEGORIES = [
  { slug: "valves-and-fittings", code: "VF", name: "Valves & fittings", nameAr: "صمامات وتجهيزات", synonyms: ["valve", "valves", "صمامات", "gate valve", "ball valve", "butterfly valve", "check valve", "fittings"], showOnHome: true },
  { slug: "pipes-and-tubing", code: "PT", name: "Pipes & tubing", nameAr: "أنابيب ومواسير", synonyms: ["pipe", "pipes", "أنابيب", "مواسير", "tube", "tubing", "gi pipe", "hdpe", "seamless"], showOnHome: true },
  { slug: "hvac-and-ventilation", code: "HV", name: "HVAC & ventilation", nameAr: "تكييف وتهوية", synonyms: ["hvac", "تكييف", "air conditioning", "chiller", "ahu", "fcu", "duct", "ventilation"], showOnHome: true },
  { slug: "electrical-and-cable", code: "EC", name: "Electrical & cable", nameAr: "كهرباء وكابلات", synonyms: ["cable", "كابلات", "كهرباء", "switchgear", "busbar", "conduit", "lv panel"], showOnHome: true },
  { slug: "safety-and-ppe", code: "SP", name: "Safety & PPE", nameAr: "السلامة ومعدات الوقاية", synonyms: ["ppe", "سلامة", "safety", "helmet", "harness", "fire extinguisher", "coverall"], showOnHome: true },
  { slug: "packaging-and-materials", code: "PK", name: "Packaging & materials", nameAr: "تغليف ومواد", synonyms: ["packaging", "تغليف", "carton", "stretch film", "pallet", "strapping"], showOnHome: true },
] as const;

export const SUBCATEGORIES = [
  { parent: "valves-and-fittings", slug: "gate-valves", code: "GV", name: "Gate valves", nameAr: "صمامات بوابة", synonyms: ["gate valve", "wedge gate", "صمام بوابة"] },
  { parent: "valves-and-fittings", slug: "butterfly-valves", code: "BV", name: "Butterfly valves", nameAr: "صمامات فراشية", synonyms: ["butterfly valve", "wafer valve", "صمام فراشي"] },
  { parent: "pipes-and-tubing", slug: "gi-pipes", code: "GI", name: "GI pipes", nameAr: "أنابيب مجلفنة", synonyms: ["gi pipe", "galvanised", "galvanized", "أنابيب مجلفنة"] },
  { parent: "hvac-and-ventilation", slug: "ducting", code: "DU", name: "Ducting", nameAr: "مجاري هواء", synonyms: ["duct", "ducting", "مجاري هواء"] },
] as const;

/// The one platform spec template the seed exercises, with three filterable
/// fields. Changing isFilterable here changes the filter rail with no code
/// change — handoff 1 acceptance criterion 4.
export interface TemplateFieldSeed {
  key: string;
  label: string;
  labelAr: string;
  type: "select" | "multiselect" | "number" | "number_range" | "text" | "boolean";
  unit?: string;
  required: boolean;
  isFilterable: boolean;
  options: readonly string[];
}

export const VALVE_TEMPLATE_FIELDS: readonly TemplateFieldSeed[] = [
  { key: "nominal_diameter", label: "Nominal diameter", labelAr: "القطر الاسمي", type: "select", unit: "DN", required: true, isFilterable: true, options: ["DN15", "DN20", "DN25", "DN32", "DN40", "DN50", "DN65", "DN80", "DN100", "DN125", "DN150", "DN200", "DN250", "DN300"] },
  { key: "pressure_rating", label: "Pressure rating", labelAr: "درجة الضغط", type: "select", required: true, isFilterable: true, options: ["PN10", "PN16", "PN25", "PN40", "Class 150", "Class 300"] },
  { key: "body_material", label: "Body material", labelAr: "مادة الجسم", type: "select", required: true, isFilterable: true, options: ["Cast iron", "Ductile iron", "Carbon steel", "Stainless steel 316", "Brass", "Bronze"] },
  { key: "end_connection", label: "End connection", labelAr: "نوع الوصلة", type: "select", required: false, isFilterable: false, options: ["Flanged", "Threaded", "Butt weld", "Socket weld", "Wafer"] },
  { key: "operation", label: "Operation", labelAr: "طريقة التشغيل", type: "select", required: false, isFilterable: false, options: ["Handwheel", "Lever", "Gear operated", "Electric actuator", "Pneumatic actuator"] },
  { key: "certification", label: "Certification", labelAr: "الشهادات", type: "multiselect", required: false, isFilterable: true, options: ["WRAS", "FM approved", "UL listed", "API 6D", "ISO 9001", "EN 1074"] },
  { key: "temperature_max", label: "Maximum temperature", labelAr: "أقصى درجة حرارة", type: "number", unit: "°C", required: false, isFilterable: false, options: [] },
];

/// Fictional trade names, built the way UAE trading names actually are.
export const NAME_PREFIX = [
  "Al Marwan", "Gulf Line", "Emirates Crest", "Al Sahra", "Northbay", "Al Wadi",
  "Desert Anchor", "Falcon Reach", "Al Bariq", "Silver Dune", "Al Hikma", "Bluewater",
  "Al Manara", "Redstone", "Al Firdaus", "Harbour Point", "Al Mizan", "Sandline",
  "Al Rukn", "Coastline", "Al Nakheel", "Ironbridge", "Al Safwa", "Meridian Gulf",
  "Al Basma", "Stonegate", "Al Tayseer", "Copperfield", "Al Mahara", "Westhaven",
  "Al Jazeera Point", "Kestrel", "Al Waha", "Brightwork", "Al Qimma", "Southbank",
  "Al Areen", "Trueline", "Al Nasr Peak", "Eastward",
] as const;

export const NAME_SUFFIX = [
  "Trading LLC", "General Trading LLC", "Industrial Supplies LLC", "Trading Co LLC",
  "Technical Services LLC", "Building Materials LLC", "Equipment Trading LLC", "FZE",
] as const;

export const AUTHORITY_BY_EMIRATE = {
  dubai: ["DED", "DED", "DED", "JAFZA", "DMCC"],
  sharjah: ["SHJ", "SHJ", "SHJ", "SAIF", "HFZA"],
  abu_dhabi: ["ADDED", "ADDED", "ADDED", "KIZAD"],
  ajman: ["AJM", "AJM", "AFZ"],
} as const;
