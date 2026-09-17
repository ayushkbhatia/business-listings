/**
 * The seven emirates, in the order the federal government lists them.
 *
 * Values match the `Emirate` enum in the schema. Labels are proper nouns and
 * are not translated — Dubai is Dubai in every locale, and the Arabic names
 * live on the taxonomy records in the database, not here.
 */
import type { Emirate } from "@/lib/db/generated/enums";

export const EMIRATES = [
  { value: "abu_dhabi", label: "Abu Dhabi" },
  { value: "dubai", label: "Dubai" },
  { value: "sharjah", label: "Sharjah" },
  { value: "ajman", label: "Ajman" },
  { value: "umm_al_quwain", label: "Umm Al Quwain" },
  { value: "ras_al_khaimah", label: "Ras Al Khaimah" },
  { value: "fujairah", label: "Fujairah" },
] as const;

/**
 * Whether a string is one of the seven.
 *
 * Here rather than a fourth copy: `lib/seo/landing/scope.ts` and
 * `lib/enquiry/service-brief.ts` each carry their own, and both of those
 * modules are `server-only` — so a route handler that needed the check had to
 * pull a database client in with it. This file is the list and holds no
 * imports but the type.
 */
export function isEmirate(value: string): value is Emirate {
  return EMIRATES.some((emirate) => emirate.value === value);
}
