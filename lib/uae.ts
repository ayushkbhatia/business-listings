/**
 * The seven emirates, in the order the federal government lists them.
 *
 * Values match the `Emirate` enum in the schema. Labels are proper nouns and
 * are not translated — Dubai is Dubai in every locale, and the Arabic names
 * live on the taxonomy records in the database, not here.
 */
export const EMIRATES = [
  { value: "abu_dhabi", label: "Abu Dhabi" },
  { value: "dubai", label: "Dubai" },
  { value: "sharjah", label: "Sharjah" },
  { value: "ajman", label: "Ajman" },
  { value: "umm_al_quwain", label: "Umm Al Quwain" },
  { value: "ras_al_khaimah", label: "Ras Al Khaimah" },
  { value: "fujairah", label: "Fujairah" },
] as const;
