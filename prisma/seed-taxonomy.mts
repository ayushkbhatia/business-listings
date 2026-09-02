/**
 * The rest of the taxonomy — six more sectors and the subcategories under all
 * twelve.
 *
 * Board 1a draws twelve sector cards, each with a teaser of its four largest
 * subcategories, and a header link reading "All 12 sectors · N subcategories".
 * Both numbers are live, so the taxonomy has to actually be that size; a home
 * page that says twelve and renders six is the kind of small lie the whole
 * proposition rests on not telling.
 *
 * ## Why the original six are untouched
 *
 * `seed-data.mts` names six sectors — valves, pipes, HVAC, cable, PPE,
 * packaging — and the seed files all forty businesses against them by index.
 * Sixty assertions across twenty-nine files stand on that: the spec template
 * lives on `valves-and-fittings`, the area pages count listings per category,
 * `DEV_SELLER_SLUG` is a valves supplier, and the publish-threshold tests argue
 * from how thin each of the six is.
 *
 * So the six stay, in their order, carrying their businesses. The six added
 * here are the ones from the board that do not overlap them — construction,
 * logistics, facilities, print, IT and professional services are trades, not
 * finer cuts of the industrial supply the first six already cover.
 *
 * They have no listings yet, and the home page says so rather than padding:
 * sectors are ordered by listing count and an empty one sorts last with a real
 * zero on it. `showOnHome` is the ops lead's control over that, and
 * `/admin/content/home` already refuses to put a sector on the home page while
 * its own landing page is too thin to publish.
 *
 * ## Subcategories
 *
 * Real UAE trade nouns, the ones a buyer would type. Arabic on every row
 * because `Category.synonyms` routes queries and صمامات has to find valve
 * suppliers — the localisation layer is from day one, not a later project.
 *
 * Codes are the two-letter mono mark `CategoryMark` renders. They are unique
 * within a sector and repeat across sectors, which is fine: the mark stands
 * beside the name, never alone.
 */

export interface SubcategorySeed {
  parent: string;
  slug: string;
  code: string;
  name: string;
  nameAr: string;
  synonyms: readonly string[];
}

/**
 * The six sectors board 1a adds. Same shape as `CATEGORIES` in seed-data.
 *
 * `showOnHome` is false on all six. They have no listings, and the curator's
 * own rule is that a sector goes on the home page when its landing page can
 * publish — sixty listings and thirty per cent verified. Turning them on from
 * here would be the seed overruling the rule the admin screen enforces.
 */
export const EXTRA_CATEGORIES = [
  /*
     Pumps & motors, and the one sector here that carries listings.

     Board 1c's canonical URL is `/search?q=chilled+water+pumps`, and its first
     acceptance criterion is that those three words reach a supplier whose
     products carry `Application: chilled water` rather than only one who wrote
     the words about themselves. With no pumps sector that query demonstrated
     the zero-result state, which is a real state and not the one the board is
     about.

     Added here rather than to `CATEGORIES` deliberately. The seed files its
     forty businesses against `CATEGORIES` by index, and a seventh entry would
     redistribute them — moving suppliers out of `valves-and-fittings`, where
     the spec template lives and where sixty assertions expect to find them.
     This sector gets its own suppliers instead, built after the main run and
     touching nothing that already exists.

     `showOnHome` stays false like its neighbours: the curator's rule is that a
     sector reaches the home page when its landing page can publish, and a
     dozen listings is well under the sixty that takes.
  */
  {
    slug: "pumps-and-motors",
    code: "PM",
    name: "Pumps & motors",
    nameAr: "مضخات ومحركات",
    synonyms: ["pump", "pumps", "مضخات", "motor", "motors", "chilled water", "booster", "circulator", "end suction", "submersible"],
    showOnHome: false,
  },
  {
    slug: "construction-and-building-materials",
    code: "CN",
    name: "Construction & building materials",
    nameAr: "مواد البناء والإنشاءات",
    synonyms: ["construction", "building materials", "مواد بناء", "cement", "aggregate", "rebar", "blockwork", "formwork"],
    showOnHome: false,
  },
  {
    slug: "logistics-and-freight",
    code: "LG",
    name: "Logistics & freight forwarding",
    nameAr: "الخدمات اللوجستية والشحن",
    synonyms: ["logistics", "freight", "شحن", "نقل", "forwarding", "customs clearance", "warehousing", "courier"],
    showOnHome: false,
  },
  {
    slug: "facilities-management-and-cleaning",
    code: "FM",
    name: "Facilities management & cleaning",
    nameAr: "إدارة المرافق والتنظيف",
    synonyms: ["facilities management", "fm", "cleaning", "تنظيف", "صيانة", "pest control", "landscaping", "amc"],
    showOnHome: false,
  },
  {
    slug: "printing-signage-and-events",
    code: "PR",
    name: "Printing, signage & events",
    nameAr: "الطباعة واللافتات والفعاليات",
    synonyms: ["printing", "طباعة", "signage", "لافتات", "events", "exhibition", "branding", "large format"],
    showOnHome: false,
  },
  {
    slug: "it-telecom-and-software",
    code: "IT",
    name: "IT, telecom & software",
    nameAr: "تقنية المعلومات والاتصالات",
    synonyms: ["it", "software", "برمجيات", "telecom", "اتصالات", "networking", "cctv", "erp", "cloud"],
    showOnHome: false,
  },
  {
    slug: "legal-audit-and-business-setup",
    code: "LA",
    name: "Legal, audit & business setup",
    nameAr: "الخدمات القانونية والتدقيق وتأسيس الشركات",
    synonyms: ["legal", "قانوني", "audit", "تدقيق", "business setup", "تأسيس شركات", "vat", "pro services", "trademark"],
    showOnHome: false,
  },
] as const;

/**
 * Everything below the sector line.
 *
 * `seed-data.mts` already seeds four — gate valves, butterfly valves, GI pipes
 * and ducting — and they are named in tests, so they are not repeated here.
 */
export const EXTRA_SUBCATEGORIES: readonly SubcategorySeed[] = [
  // ── Valves & fittings ────────────────────────────────────────────────────
  { parent: "valves-and-fittings", slug: "ball-valves", code: "BA", name: "Ball valves", nameAr: "صمامات كروية", synonyms: ["ball valve", "صمام كروي", "floating ball"] },
  { parent: "valves-and-fittings", slug: "check-valves", code: "CK", name: "Check valves", nameAr: "صمامات عدم رجوع", synonyms: ["check valve", "non return valve", "nrv", "صمام عدم رجوع"] },
  { parent: "valves-and-fittings", slug: "globe-valves", code: "GL", name: "Globe valves", nameAr: "صمامات كروية قرصية", synonyms: ["globe valve", "صمام قرصي"] },
  { parent: "valves-and-fittings", slug: "pressure-reducing-valves", code: "PV", name: "Pressure reducing valves", nameAr: "صمامات خفض الضغط", synonyms: ["prv", "pressure reducing", "صمام خفض ضغط"] },
  { parent: "valves-and-fittings", slug: "safety-relief-valves", code: "RV", name: "Safety & relief valves", nameAr: "صمامات الأمان والتنفيس", synonyms: ["relief valve", "safety valve", "psv", "صمام أمان"] },
  { parent: "valves-and-fittings", slug: "actuators", code: "AC", name: "Valve actuators", nameAr: "محركات الصمامات", synonyms: ["actuator", "electric actuator", "pneumatic actuator", "محرك صمام"] },
  { parent: "valves-and-fittings", slug: "flanges", code: "FL", name: "Flanges", nameAr: "فلنجات", synonyms: ["flange", "فلنجة", "slip on", "weld neck"] },
  { parent: "valves-and-fittings", slug: "gaskets-and-seals", code: "GS", name: "Gaskets & seals", nameAr: "حشوات وموانع تسرب", synonyms: ["gasket", "seal", "حشوة", "o-ring", "spiral wound"] },
  { parent: "valves-and-fittings", slug: "strainers", code: "ST", name: "Strainers", nameAr: "مصافي", synonyms: ["strainer", "y strainer", "مصفاة"] },
  { parent: "valves-and-fittings", slug: "pipe-fittings", code: "PF", name: "Pipe fittings", nameAr: "وصلات الأنابيب", synonyms: ["elbow", "tee", "reducer", "coupling", "وصلات"] },
  { parent: "valves-and-fittings", slug: "expansion-joints", code: "EJ", name: "Expansion joints", nameAr: "وصلات التمدد", synonyms: ["expansion joint", "bellows", "وصلة تمدد"] },
  { parent: "valves-and-fittings", slug: "steam-traps", code: "SR", name: "Steam traps", nameAr: "مصائد البخار", synonyms: ["steam trap", "مصيدة بخار"] },

  // ── Pipes & tubing ───────────────────────────────────────────────────────
  { parent: "pipes-and-tubing", slug: "hdpe-pipes", code: "HD", name: "HDPE pipes", nameAr: "أنابيب بولي إيثيلين", synonyms: ["hdpe", "polyethylene", "بولي إيثيلين"] },
  { parent: "pipes-and-tubing", slug: "upvc-pipes", code: "UP", name: "uPVC pipes", nameAr: "أنابيب يو بي في سي", synonyms: ["upvc", "pvc pipe", "بي في سي"] },
  { parent: "pipes-and-tubing", slug: "seamless-pipes", code: "SL", name: "Seamless steel pipes", nameAr: "أنابيب صلب بدون لحام", synonyms: ["seamless", "smls", "أنبوب بدون لحام"] },
  { parent: "pipes-and-tubing", slug: "erw-pipes", code: "ER", name: "ERW & welded pipes", nameAr: "أنابيب ملحومة", synonyms: ["erw", "welded pipe", "أنبوب ملحوم"] },
  { parent: "pipes-and-tubing", slug: "stainless-tubing", code: "SS", name: "Stainless steel tubing", nameAr: "مواسير ستانلس ستيل", synonyms: ["stainless tube", "ss 316", "ستانلس"] },
  { parent: "pipes-and-tubing", slug: "copper-tubing", code: "CU", name: "Copper tubing", nameAr: "مواسير نحاس", synonyms: ["copper pipe", "نحاس", "acr tube"] },
  { parent: "pipes-and-tubing", slug: "ppr-pipes", code: "PP", name: "PPR pipes", nameAr: "أنابيب بي بي آر", synonyms: ["ppr", "polypropylene", "بي بي آر"] },
  { parent: "pipes-and-tubing", slug: "ductile-iron-pipes", code: "DI", name: "Ductile iron pipes", nameAr: "أنابيب حديد مطيل", synonyms: ["ductile iron", "di pipe", "حديد مطيل"] },
  { parent: "pipes-and-tubing", slug: "grp-pipes", code: "GR", name: "GRP & GRE pipes", nameAr: "أنابيب فايبر جلاس", synonyms: ["grp", "gre", "fiberglass pipe", "فايبر جلاس"] },
  { parent: "pipes-and-tubing", slug: "pipe-supports", code: "PS", name: "Pipe supports & clamps", nameAr: "حوامل ومشابك الأنابيب", synonyms: ["pipe clamp", "hanger", "support", "مشبك"] },
  { parent: "pipes-and-tubing", slug: "pipe-insulation", code: "PI", name: "Pipe insulation", nameAr: "عزل الأنابيب", synonyms: ["insulation", "rockwool", "عزل", "armaflex"] },
  { parent: "pipes-and-tubing", slug: "drainage-pipes", code: "DR", name: "Drainage pipes", nameAr: "أنابيب الصرف", synonyms: ["drainage", "sewer pipe", "صرف صحي"] },

  // ── HVAC & ventilation ───────────────────────────────────────────────────
  { parent: "hvac-and-ventilation", slug: "chillers", code: "CH", name: "Chillers", nameAr: "مبردات", synonyms: ["chiller", "مبرد", "air cooled chiller", "water cooled"] },
  { parent: "hvac-and-ventilation", slug: "air-handling-units", code: "AH", name: "Air handling units", nameAr: "وحدات مناولة الهواء", synonyms: ["ahu", "air handler", "وحدة مناولة"] },
  { parent: "hvac-and-ventilation", slug: "fan-coil-units", code: "FC", name: "Fan coil units", nameAr: "وحدات ملف المروحة", synonyms: ["fcu", "fan coil", "ملف مروحة"] },
  { parent: "hvac-and-ventilation", slug: "split-units", code: "SU", name: "Split & package units", nameAr: "مكيفات سبليت", synonyms: ["split ac", "package unit", "سبليت", "مكيف"] },
  { parent: "hvac-and-ventilation", slug: "cold-rooms", code: "CR", name: "Cold rooms & refrigeration", nameAr: "غرف التبريد", synonyms: ["cold room", "chiller room", "غرفة تبريد", "freezer room"] },
  { parent: "hvac-and-ventilation", slug: "exhaust-fans", code: "EF", name: "Fans & exhaust", nameAr: "مراوح وشفاطات", synonyms: ["exhaust fan", "axial fan", "مروحة", "شفاط"] },
  { parent: "hvac-and-ventilation", slug: "grilles-and-diffusers", code: "GD", name: "Grilles & diffusers", nameAr: "شبكات وموزعات الهواء", synonyms: ["grille", "diffuser", "شبك تكييف"] },
  { parent: "hvac-and-ventilation", slug: "vav-and-dampers", code: "VA", name: "VAV boxes & dampers", nameAr: "صناديق التحكم والدامبرات", synonyms: ["vav", "damper", "fire damper", "دامبر"] },
  { parent: "hvac-and-ventilation", slug: "hvac-controls", code: "HB", name: "HVAC controls & BMS", nameAr: "أنظمة التحكم بالتكييف", synonyms: ["bms", "controls", "thermostat", "تحكم"] },
  { parent: "hvac-and-ventilation", slug: "hvac-amc", code: "HA", name: "HVAC maintenance AMC", nameAr: "عقود صيانة التكييف", synonyms: ["hvac amc", "ac maintenance", "صيانة تكييف", "annual maintenance contract"] },
  { parent: "hvac-and-ventilation", slug: "duct-cleaning", code: "DC", name: "Duct cleaning", nameAr: "تنظيف مجاري الهواء", synonyms: ["duct cleaning", "تنظيف دكت"] },
  { parent: "hvac-and-ventilation", slug: "cooling-towers", code: "CT", name: "Cooling towers", nameAr: "أبراج التبريد", synonyms: ["cooling tower", "برج تبريد"] },

  // ── Electrical & cable ───────────────────────────────────────────────────
  { parent: "electrical-and-cable", slug: "lv-cable", code: "LV", name: "LV power cable", nameAr: "كابلات الجهد المنخفض", synonyms: ["lv cable", "xlpe", "كابل", "power cable"] },
  { parent: "electrical-and-cable", slug: "mv-cable", code: "MV", name: "MV & HV cable", nameAr: "كابلات الجهد المتوسط", synonyms: ["mv cable", "hv cable", "11kv", "جهد متوسط"] },
  { parent: "electrical-and-cable", slug: "control-cable", code: "CC", name: "Control & instrumentation cable", nameAr: "كابلات التحكم", synonyms: ["control cable", "instrumentation", "كابل تحكم"] },
  { parent: "electrical-and-cable", slug: "cable-tray", code: "CY", name: "Cable tray & ladder", nameAr: "حوامل الكابلات", synonyms: ["cable tray", "cable ladder", "trunking", "حامل كابلات"] },
  { parent: "electrical-and-cable", slug: "switchgear", code: "SW", name: "Switchgear & panels", nameAr: "لوحات التوزيع", synonyms: ["switchgear", "lv panel", "mccb", "لوحة كهرباء"] },
  { parent: "electrical-and-cable", slug: "busbar", code: "BB", name: "Busbar trunking", nameAr: "قضبان التوزيع", synonyms: ["busbar", "busduct", "قضيب توزيع"] },
  { parent: "electrical-and-cable", slug: "transformers", code: "TR", name: "Transformers", nameAr: "محولات", synonyms: ["transformer", "محول", "dry type"] },
  { parent: "electrical-and-cable", slug: "generators", code: "GN", name: "Generators & gensets", nameAr: "مولدات كهربائية", synonyms: ["generator", "genset", "مولد", "diesel generator"] },
  { parent: "electrical-and-cable", slug: "ups-and-batteries", code: "UB", name: "UPS & batteries", nameAr: "أنظمة الطاقة الاحتياطية", synonyms: ["ups", "battery", "بطارية", "backup power"] },
  { parent: "electrical-and-cable", slug: "lighting", code: "LT", name: "Lighting & luminaires", nameAr: "إنارة", synonyms: ["lighting", "led", "luminaire", "إنارة", "مصابيح"] },
  { parent: "electrical-and-cable", slug: "conduit-and-accessories", code: "CO", name: "Conduit & accessories", nameAr: "مواسير الكهرباء وملحقاتها", synonyms: ["conduit", "gi conduit", "مواسير كهرباء"] },
  { parent: "electrical-and-cable", slug: "earthing", code: "EA", name: "Earthing & lightning protection", nameAr: "التأريض والحماية من الصواعق", synonyms: ["earthing", "grounding", "lightning protection", "تأريض"] },

  // ── Safety & PPE ─────────────────────────────────────────────────────────
  { parent: "safety-and-ppe", slug: "head-protection", code: "HP", name: "Head protection", nameAr: "حماية الرأس", synonyms: ["helmet", "hard hat", "خوذة"] },
  { parent: "safety-and-ppe", slug: "eye-protection", code: "EP", name: "Eye & face protection", nameAr: "حماية العين والوجه", synonyms: ["safety glasses", "goggles", "face shield", "نظارات سلامة"] },
  { parent: "safety-and-ppe", slug: "hand-protection", code: "HG", name: "Hand protection", nameAr: "حماية اليدين", synonyms: ["gloves", "قفازات", "cut resistant"] },
  { parent: "safety-and-ppe", slug: "safety-footwear", code: "SF", name: "Safety footwear", nameAr: "أحذية السلامة", synonyms: ["safety shoes", "boots", "أحذية أمان"] },
  { parent: "safety-and-ppe", slug: "workwear", code: "WW", name: "Workwear & coveralls", nameAr: "ملابس العمل", synonyms: ["coverall", "workwear", "أفرول", "ملابس عمل"] },
  { parent: "safety-and-ppe", slug: "fall-protection", code: "FP", name: "Fall protection", nameAr: "الحماية من السقوط", synonyms: ["harness", "lanyard", "fall arrest", "حزام أمان"] },
  { parent: "safety-and-ppe", slug: "respiratory-protection", code: "RP", name: "Respiratory protection", nameAr: "حماية الجهاز التنفسي", synonyms: ["respirator", "mask", "كمامة", "scba"] },
  { parent: "safety-and-ppe", slug: "fire-extinguishers", code: "FX", name: "Fire extinguishers", nameAr: "طفايات الحريق", synonyms: ["fire extinguisher", "طفاية حريق"] },
  { parent: "safety-and-ppe", slug: "fire-alarm-systems", code: "FA", name: "Fire alarm & detection", nameAr: "أنظمة إنذار الحريق", synonyms: ["fire alarm", "smoke detector", "إنذار حريق"] },
  { parent: "safety-and-ppe", slug: "fire-fighting-systems", code: "FF", name: "Fire fighting systems", nameAr: "أنظمة مكافحة الحريق", synonyms: ["sprinkler", "hose reel", "fire pump", "مكافحة حريق"] },
  { parent: "safety-and-ppe", slug: "road-safety", code: "RS", name: "Road & site safety", nameAr: "سلامة الطرق والمواقع", synonyms: ["cone", "barrier", "signage", "حواجز"] },
  { parent: "safety-and-ppe", slug: "gas-detection", code: "GT", name: "Gas detection", nameAr: "كشف الغازات", synonyms: ["gas detector", "كاشف غاز", "multi gas"] },

  // ── Packaging & materials ────────────────────────────────────────────────
  { parent: "packaging-and-materials", slug: "corrugated-cartons", code: "CB", name: "Corrugated cartons", nameAr: "كراتين مموجة", synonyms: ["carton", "corrugated box", "كرتون"] },
  { parent: "packaging-and-materials", slug: "stretch-film", code: "SM", name: "Stretch & shrink film", nameAr: "أفلام التغليف", synonyms: ["stretch film", "shrink wrap", "فيلم تغليف"] },
  { parent: "packaging-and-materials", slug: "pallets", code: "PL", name: "Pallets", nameAr: "منصات نقالة", synonyms: ["pallet", "wooden pallet", "بالتة"] },
  { parent: "packaging-and-materials", slug: "strapping", code: "SG", name: "Strapping & tools", nameAr: "أشرطة الربط", synonyms: ["strapping", "pet strap", "شريط ربط"] },
  { parent: "packaging-and-materials", slug: "adhesive-tapes", code: "AT", name: "Adhesive tapes", nameAr: "أشرطة لاصقة", synonyms: ["tape", "bopp tape", "شريط لاصق"] },
  { parent: "packaging-and-materials", slug: "labels-and-ribbons", code: "LR", name: "Labels & ribbons", nameAr: "ملصقات وأشرطة طباعة", synonyms: ["label", "thermal label", "ملصق", "barcode"] },
  { parent: "packaging-and-materials", slug: "flexible-packaging", code: "FG", name: "Flexible packaging", nameAr: "التغليف المرن", synonyms: ["pouch", "laminate", "تغليف مرن"] },
  { parent: "packaging-and-materials", slug: "food-packaging", code: "FD", name: "Food packaging", nameAr: "تغليف الأغذية", synonyms: ["food container", "تغليف أغذية", "takeaway"] },
  { parent: "packaging-and-materials", slug: "drums-and-ibc", code: "DM", name: "Drums & IBCs", nameAr: "براميل وخزانات", synonyms: ["drum", "ibc tank", "برميل"] },
  { parent: "packaging-and-materials", slug: "packaging-machinery", code: "PM", name: "Packaging machinery", nameAr: "آلات التغليف", synonyms: ["packaging machine", "sealer", "آلة تغليف"] },
  { parent: "packaging-and-materials", slug: "protective-packaging", code: "PC", name: "Protective packaging", nameAr: "مواد الحماية", synonyms: ["bubble wrap", "foam", "فقاعات"] },
  { parent: "packaging-and-materials", slug: "pallet-racking", code: "PK", name: "Pallet racking & storage", nameAr: "رفوف التخزين", synonyms: ["pallet racking", "racking", "shelving", "رفوف"] },

  // ── Construction & building materials ────────────────────────────────────
  { parent: "construction-and-building-materials", slug: "cement-and-concrete", code: "CE", name: "Cement & ready-mix concrete", nameAr: "الأسمنت والخرسانة", synonyms: ["cement", "ready mix", "concrete", "أسمنت", "خرسانة"] },
  { parent: "construction-and-building-materials", slug: "steel-rebar", code: "RB", name: "Steel & rebar", nameAr: "حديد التسليح", synonyms: ["rebar", "steel bar", "حديد تسليح", "tmt"] },
  { parent: "construction-and-building-materials", slug: "aggregates", code: "AG", name: "Aggregates & sand", nameAr: "الركام والرمل", synonyms: ["aggregate", "sand", "gabbro", "رمل", "بحص"] },
  { parent: "construction-and-building-materials", slug: "blocks-and-bricks", code: "BL", name: "Blocks & bricks", nameAr: "الطابوق والبلوك", synonyms: ["block", "brick", "aac", "طابوق", "بلوك"] },
  { parent: "construction-and-building-materials", slug: "formwork-and-scaffolding", code: "FW", name: "Formwork & scaffolding", nameAr: "الشدة والسقالات", synonyms: ["formwork", "scaffolding", "shuttering", "سقالات", "شدة"] },
  { parent: "construction-and-building-materials", slug: "waterproofing", code: "WP", name: "Waterproofing", nameAr: "العزل المائي", synonyms: ["waterproofing", "membrane", "عزل مائي"] },
  { parent: "construction-and-building-materials", slug: "paints-and-coatings", code: "PA", name: "Paints & coatings", nameAr: "الدهانات والطلاءات", synonyms: ["paint", "coating", "دهان", "epoxy"] },
  { parent: "construction-and-building-materials", slug: "tiles-and-flooring", code: "TF", name: "Tiles & flooring", nameAr: "البلاط والأرضيات", synonyms: ["tiles", "flooring", "بلاط", "أرضيات", "vinyl"] },
  { parent: "construction-and-building-materials", slug: "doors-and-windows", code: "DW", name: "Doors & windows", nameAr: "الأبواب والنوافذ", synonyms: ["door", "window", "أبواب", "نوافذ", "aluminium"] },
  { parent: "construction-and-building-materials", slug: "glass-and-glazing", code: "GG", name: "Glass & glazing", nameAr: "الزجاج والواجهات", synonyms: ["glass", "glazing", "curtain wall", "زجاج"] },
  { parent: "construction-and-building-materials", slug: "steel-fabrication", code: "SB", name: "Steel fabrication", nameAr: "تصنيع الحديد", synonyms: ["steel fabrication", "structural steel", "تصنيع حديد", "fabrication"] },
  { parent: "construction-and-building-materials", slug: "gypsum-and-ceilings", code: "GY", name: "Gypsum & false ceilings", nameAr: "الجبس والأسقف المستعارة", synonyms: ["gypsum", "false ceiling", "جبس", "drywall"] },
  { parent: "construction-and-building-materials", slug: "insulation-materials", code: "IM", name: "Insulation materials", nameAr: "مواد العزل", synonyms: ["insulation", "thermal", "عزل حراري"] },
  { parent: "construction-and-building-materials", slug: "heavy-equipment-rental", code: "HE", name: "Heavy equipment rental", nameAr: "تأجير المعدات الثقيلة", synonyms: ["equipment rental", "crane", "excavator", "تأجير معدات"] },
  { parent: "construction-and-building-materials", slug: "joinery-and-carpentry", code: "JC", name: "Joinery & carpentry", nameAr: "النجارة والأعمال الخشبية", synonyms: ["joinery", "carpentry", "نجارة", "millwork"] },

  // ── Logistics & freight forwarding ───────────────────────────────────────
  { parent: "logistics-and-freight", slug: "sea-freight", code: "SE", name: "Sea freight", nameAr: "الشحن البحري", synonyms: ["sea freight", "ocean freight", "fcl", "lcl", "شحن بحري"] },
  { parent: "logistics-and-freight", slug: "air-freight", code: "AF", name: "Air freight", nameAr: "الشحن الجوي", synonyms: ["air freight", "air cargo", "شحن جوي"] },
  { parent: "logistics-and-freight", slug: "land-transport", code: "LD", name: "Land transport & trucking", nameAr: "النقل البري", synonyms: ["trucking", "land transport", "نقل بري", "trailer"] },
  { parent: "logistics-and-freight", slug: "customs-clearance", code: "CL", name: "Customs clearance", nameAr: "التخليص الجمركي", synonyms: ["customs clearance", "clearing", "تخليص جمركي"] },
  { parent: "logistics-and-freight", slug: "warehousing", code: "WH", name: "Warehousing & storage", nameAr: "التخزين والمستودعات", synonyms: ["warehouse", "storage", "3pl", "مستودع", "تخزين"] },
  { parent: "logistics-and-freight", slug: "cold-chain", code: "CD", name: "Cold chain logistics", nameAr: "سلسلة التبريد", synonyms: ["cold chain", "reefer", "نقل مبرد"] },
  { parent: "logistics-and-freight", slug: "courier-and-last-mile", code: "CM", name: "Courier & last mile", nameAr: "خدمات التوصيل", synonyms: ["courier", "last mile", "delivery", "توصيل"] },
  { parent: "logistics-and-freight", slug: "project-cargo", code: "PG", name: "Project & heavy-lift cargo", nameAr: "الشحن المشاريعي", synonyms: ["project cargo", "heavy lift", "oog", "شحن مشاريع"] },
  { parent: "logistics-and-freight", slug: "relocation-and-moving", code: "RM", name: "Relocation & moving", nameAr: "خدمات النقل والترحيل", synonyms: ["movers", "relocation", "نقل أثاث"] },
  { parent: "logistics-and-freight", slug: "freight-forwarding", code: "FR", name: "Freight forwarding", nameAr: "وكالة الشحن", synonyms: ["freight forwarder", "forwarding", "وكيل شحن"] },
  { parent: "logistics-and-freight", slug: "material-handling", code: "MH", name: "Material handling equipment", nameAr: "معدات المناولة", synonyms: ["forklift", "pallet truck", "رافعة شوكية"] },
  { parent: "logistics-and-freight", slug: "shipping-agency", code: "SA", name: "Shipping agency", nameAr: "وكالة ملاحية", synonyms: ["shipping agency", "vessel agency", "وكالة ملاحية"] },

  // ── Facilities management & cleaning ─────────────────────────────────────
  { parent: "facilities-management-and-cleaning", slug: "commercial-cleaning", code: "CG", name: "Commercial cleaning", nameAr: "التنظيف التجاري", synonyms: ["cleaning", "office cleaning", "تنظيف", "deep clean"] },
  { parent: "facilities-management-and-cleaning", slug: "pest-control", code: "PT", name: "Pest control", nameAr: "مكافحة الحشرات", synonyms: ["pest control", "مكافحة حشرات", "fumigation"] },
  { parent: "facilities-management-and-cleaning", slug: "landscaping", code: "LS", name: "Landscaping & grounds", nameAr: "تنسيق الحدائق", synonyms: ["landscaping", "gardening", "تنسيق حدائق"] },
  { parent: "facilities-management-and-cleaning", slug: "security-services", code: "SC", name: "Security services", nameAr: "خدمات الأمن", synonyms: ["security", "guarding", "حراسة", "أمن"] },
  { parent: "facilities-management-and-cleaning", slug: "hard-fm", code: "HF", name: "Hard FM & MEP maintenance", nameAr: "الصيانة الفنية", synonyms: ["hard fm", "mep maintenance", "صيانة", "amc"] },
  { parent: "facilities-management-and-cleaning", slug: "waste-management", code: "WM", name: "Waste management", nameAr: "إدارة النفايات", synonyms: ["waste", "recycling", "نفايات", "skip hire"] },
  { parent: "facilities-management-and-cleaning", slug: "water-tank-cleaning", code: "WT", name: "Water tank cleaning", nameAr: "تنظيف خزانات المياه", synonyms: ["water tank cleaning", "تنظيف خزانات"] },
  { parent: "facilities-management-and-cleaning", slug: "facade-cleaning", code: "FE", name: "Facade & window cleaning", nameAr: "تنظيف الواجهات", synonyms: ["facade cleaning", "window cleaning", "rope access", "تنظيف واجهات"] },
  { parent: "facilities-management-and-cleaning", slug: "lift-maintenance", code: "LM", name: "Lift & escalator maintenance", nameAr: "صيانة المصاعد", synonyms: ["lift maintenance", "elevator", "مصاعد"] },
  { parent: "facilities-management-and-cleaning", slug: "laundry-services", code: "LU", name: "Laundry & linen services", nameAr: "خدمات الغسيل", synonyms: ["laundry", "linen", "مغسلة"] },
  { parent: "facilities-management-and-cleaning", slug: "manpower-supply", code: "MP", name: "Manpower supply", nameAr: "توريد العمالة", synonyms: ["manpower", "labour supply", "توريد عمالة"] },
  { parent: "facilities-management-and-cleaning", slug: "swimming-pool-services", code: "SO", name: "Swimming pool services", nameAr: "خدمات المسابح", synonyms: ["pool cleaning", "pool maintenance", "مسابح"] },

  // ── Printing, signage & events ───────────────────────────────────────────
  { parent: "printing-signage-and-events", slug: "large-format-printing", code: "LF", name: "Large format printing", nameAr: "الطباعة بالأحجام الكبيرة", synonyms: ["large format", "banner", "طباعة كبيرة", "vinyl print"] },
  { parent: "printing-signage-and-events", slug: "offset-printing", code: "OF", name: "Offset & digital printing", nameAr: "الطباعة الأوفست والرقمية", synonyms: ["offset printing", "digital printing", "طباعة"] },
  { parent: "printing-signage-and-events", slug: "signage-fabrication", code: "SN", name: "Signage fabrication", nameAr: "تصنيع اللافتات", synonyms: ["signage", "sign board", "لافتات", "3d letters"] },
  { parent: "printing-signage-and-events", slug: "exhibition-stands", code: "EX", name: "Exhibition stands", nameAr: "أجنحة المعارض", synonyms: ["exhibition stand", "booth", "معارض", "stand builder"] },
  { parent: "printing-signage-and-events", slug: "corporate-gifts", code: "CP", name: "Corporate gifts & merchandise", nameAr: "الهدايا الترويجية", synonyms: ["corporate gifts", "promotional", "هدايا ترويجية"] },
  { parent: "printing-signage-and-events", slug: "event-management", code: "EM", name: "Event management", nameAr: "تنظيم الفعاليات", synonyms: ["event management", "تنظيم فعاليات", "conference"] },
  { parent: "printing-signage-and-events", slug: "av-and-staging", code: "AV", name: "AV, staging & lighting", nameAr: "الصوتيات والإضاءة", synonyms: ["av rental", "staging", "sound", "إضاءة"] },
  { parent: "printing-signage-and-events", slug: "vehicle-branding", code: "VB", name: "Vehicle branding & wraps", nameAr: "تغليف السيارات", synonyms: ["vehicle wrap", "car branding", "تغليف سيارات"] },
  { parent: "printing-signage-and-events", slug: "packaging-print", code: "PZ", name: "Packaging print", nameAr: "طباعة التغليف", synonyms: ["packaging print", "carton printing", "طباعة كرتون"] },
  { parent: "printing-signage-and-events", slug: "photography-and-video", code: "PH", name: "Photography & video", nameAr: "التصوير الفوتوغرافي والفيديو", synonyms: ["photography", "video production", "تصوير"] },
  { parent: "printing-signage-and-events", slug: "graphic-design", code: "GX", name: "Graphic design & branding", nameAr: "التصميم الجرافيكي", synonyms: ["graphic design", "branding", "تصميم"] },
  { parent: "printing-signage-and-events", slug: "textile-printing", code: "TP", name: "Textile & garment printing", nameAr: "طباعة الأقمشة", synonyms: ["textile printing", "embroidery", "طباعة أقمشة", "uniform"] },

  // ── IT, telecom & software ───────────────────────────────────────────────
  { parent: "it-telecom-and-software", slug: "structured-cabling", code: "SK", name: "Structured cabling", nameAr: "الكابلات المنظمة", synonyms: ["structured cabling", "network cabling", "cat6", "شبكات"] },
  { parent: "it-telecom-and-software", slug: "networking-hardware", code: "NW", name: "Networking hardware", nameAr: "أجهزة الشبكات", synonyms: ["networking", "switch", "router", "firewall", "شبكات"] },
  { parent: "it-telecom-and-software", slug: "cctv-and-access", code: "CV", name: "CCTV & access control", nameAr: "المراقبة والتحكم بالدخول", synonyms: ["cctv", "access control", "nvr", "كاميرات مراقبة"] },
  { parent: "it-telecom-and-software", slug: "servers-and-storage", code: "SV", name: "Servers & storage", nameAr: "الخوادم والتخزين", synonyms: ["server", "storage", "nas", "خادم"] },
  { parent: "it-telecom-and-software", slug: "it-amc", code: "IA", name: "IT support & AMC", nameAr: "الدعم الفني وعقود الصيانة", synonyms: ["it support", "it amc", "managed services", "دعم فني"] },
  { parent: "it-telecom-and-software", slug: "erp-and-accounting", code: "EN", name: "ERP & accounting software", nameAr: "أنظمة تخطيط الموارد", synonyms: ["erp", "accounting software", "sap", "tally", "أنظمة محاسبة"] },
  { parent: "it-telecom-and-software", slug: "software-development", code: "SD", name: "Software development", nameAr: "تطوير البرمجيات", synonyms: ["software development", "web development", "app", "برمجة"] },
  { parent: "it-telecom-and-software", slug: "cloud-and-hosting", code: "CS", name: "Cloud & hosting", nameAr: "الاستضافة والحوسبة السحابية", synonyms: ["cloud", "hosting", "aws", "استضافة"] },
  { parent: "it-telecom-and-software", slug: "cybersecurity", code: "CX", name: "Cybersecurity", nameAr: "الأمن السيبراني", synonyms: ["cybersecurity", "penetration testing", "أمن سيبراني"] },
  { parent: "it-telecom-and-software", slug: "telecom-services", code: "TL", name: "Telecom services", nameAr: "خدمات الاتصالات", synonyms: ["telecom", "pabx", "voip", "اتصالات"] },
  { parent: "it-telecom-and-software", slug: "av-systems", code: "AY", name: "AV & conference systems", nameAr: "أنظمة الاجتماعات", synonyms: ["av system", "video conferencing", "أنظمة صوتية"] },
  { parent: "it-telecom-and-software", slug: "pos-and-retail-tech", code: "PO", name: "POS & retail technology", nameAr: "أنظمة نقاط البيع", synonyms: ["pos", "point of sale", "نقاط بيع", "barcode scanner"] },

  // ── Legal, audit & business setup ────────────────────────────────────────
  { parent: "legal-audit-and-business-setup", slug: "company-formation", code: "CF", name: "Company formation", nameAr: "تأسيس الشركات", synonyms: ["business setup", "company formation", "تأسيس شركات", "free zone setup"] },
  { parent: "legal-audit-and-business-setup", slug: "trade-licence-renewal", code: "TC", name: "Trade licence renewal", nameAr: "تجديد الرخصة التجارية", synonyms: ["trade licence renewal", "licence renewal", "تجديد رخصة"] },
  { parent: "legal-audit-and-business-setup", slug: "pro-services", code: "PQ", name: "PRO services", nameAr: "خدمات العلاقات الحكومية", synonyms: ["pro services", "government liaison", "خدمات حكومية"] },
  { parent: "legal-audit-and-business-setup", slug: "visa-and-immigration", code: "VI", name: "Visa & immigration", nameAr: "التأشيرات والإقامة", synonyms: ["visa", "immigration", "تأشيرات", "residence visa"] },
  { parent: "legal-audit-and-business-setup", slug: "audit-and-assurance", code: "AA", name: "Audit & assurance", nameAr: "التدقيق والمراجعة", synonyms: ["audit", "assurance", "تدقيق", "external audit"] },
  { parent: "legal-audit-and-business-setup", slug: "accounting-and-bookkeeping", code: "AB", name: "Accounting & bookkeeping", nameAr: "المحاسبة ومسك الدفاتر", synonyms: ["accounting", "bookkeeping", "محاسبة"] },
  { parent: "legal-audit-and-business-setup", slug: "vat-and-tax", code: "VT", name: "VAT & tax advisory", nameAr: "ضريبة القيمة المضافة", synonyms: ["vat", "corporate tax", "ضريبة", "tax advisory"] },
  { parent: "legal-audit-and-business-setup", slug: "legal-consultancy", code: "LC", name: "Legal consultancy", nameAr: "الاستشارات القانونية", synonyms: ["legal consultancy", "law firm", "محاماة", "استشارات قانونية"] },
  { parent: "legal-audit-and-business-setup", slug: "trademark-and-ip", code: "TM", name: "Trademark & IP", nameAr: "العلامات التجارية والملكية الفكرية", synonyms: ["trademark", "intellectual property", "علامة تجارية"] },
  { parent: "legal-audit-and-business-setup", slug: "translation-and-attestation", code: "TA", name: "Translation & attestation", nameAr: "الترجمة والتصديق", synonyms: ["legal translation", "attestation", "ترجمة قانونية", "تصديق"] },
  { parent: "legal-audit-and-business-setup", slug: "hr-and-payroll", code: "HR", name: "HR & payroll", nameAr: "الموارد البشرية والرواتب", synonyms: ["hr services", "payroll", "wps", "موارد بشرية"] },
  { parent: "legal-audit-and-business-setup", slug: "management-consultancy", code: "MC", name: "Management consultancy", nameAr: "الاستشارات الإدارية", synonyms: ["management consultancy", "feasibility study", "استشارات إدارية"] },
];
