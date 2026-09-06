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
  { id: "free", name: "Free", monthlyPriceAed: 0, enquiriesPerMonth: 3, productLimit: 10, locationLimit: 1, photoLimit: 30, storageMb: 1024, teamSeats: 2, categoryLimit: 1, rankingMultiplier: 1.0, customDomain: false, sortOrder: 0, annualMonthsCharged: null },
  { id: "basic", name: "Basic", monthlyPriceAed: 349, enquiriesPerMonth: 40, productLimit: 150, locationLimit: 3, photoLimit: 40, storageMb: 5120, teamSeats: 3, categoryLimit: 3, rankingMultiplier: 1.15, customDomain: false, sortOrder: 1, annualMonthsCharged: 10 },
  { id: "pro", name: "Pro", monthlyPriceAed: 899, enquiriesPerMonth: null, productLimit: null, locationLimit: 10, photoLimit: 200, storageMb: 10240, teamSeats: 10, categoryLimit: null, rankingMultiplier: 1.35, customDomain: true, sortOrder: 2, annualMonthsCharged: 10 },
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
