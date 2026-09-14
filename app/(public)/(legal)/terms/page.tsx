import type { Metadata } from "next";
import { termsDocument } from "@/lib/legal/documents";
import { LegalPage, legalMetadata } from "../_LegalPage";

/**
 * Board 13f — sixteen clauses, replacing board 10j's five-section stub.
 *
 * Static: no auth, no data fetch, no state, and never gated behind consent.
 * `revalidate` is a year rather than an hour because the content is a module
 * and changing it is a deploy — an hourly revalidation would re-render an
 * identical page eight thousand times a year for nothing.
 *
 * It ships ahead of the systems it describes because three flows already link
 * here: account creation, claim submission and plan subscribe each need a live
 * URL for their acceptance checkbox, and each stores the *version* rather than
 * a boolean. A boolean cannot answer which terms a seller agreed to, which is
 * the only question a dispute asks.
 */

/*
   A day, not a year, since board 11i. The page now changes on a date as well as
   on a deploy: an amendment announced today takes effect on a fixed day, and a
   year-long cache would keep serving the earlier wording long after it stopped
   applying. Two renders a day is the cost of the page being right.
*/
export const revalidate = 86400;

export function generateMetadata(): Metadata {
  return legalMetadata(termsDocument());
}

export default function Page() {
  return <LegalPage document={termsDocument()} />;
}
