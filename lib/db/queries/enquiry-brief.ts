/**
 * Board `1h-s` — a brief, as the buyer's tracking page and the seller's lead
 * both read it.
 *
 * One select and one shape for the two sides, so the site, the engagement and
 * the start a supplier prices against are the ones the buyer sees they sent.
 * The description, the scale and the files are already on the enquiry and are
 * read there.
 */

/** What a brief carries beyond an enquiry, as both sides of it read it. */
export interface EnquiryBrief {
  subcategoryName: string;
  emirate: string | null;
  areaName: string | null;
  building: string | null;
  engagementType: string;
  cadence: string | null;
  startMode: string;
  startsOn: Date | null;
}

/** The select both readers use, so the buyer and the seller read one brief. */
export const ENQUIRY_BRIEF_SELECT = {
  building: true,
  engagementType: true,
  cadence: true,
  startMode: true,
  startsOn: true,
  category: { select: { name: true } },
} as const;

export function toEnquiryBrief(
  row: {
    building: string | null;
    engagementType: string;
    cadence: string | null;
    startMode: string;
    startsOn: Date | null;
    category: { name: string };
  } | null,
  site: { emirate: string | null; area: { name: string } | null },
): EnquiryBrief | null {
  if (!row) return null;
  return {
    subcategoryName: row.category.name,
    emirate: site.emirate,
    areaName: site.area?.name ?? null,
    building: row.building,
    engagementType: row.engagementType,
    cadence: row.cadence,
    startMode: row.startMode,
    startsOn: row.startsOn,
  };
}

