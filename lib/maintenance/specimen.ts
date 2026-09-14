import type { MaintenanceRecord } from "./window";

/**
 * Board 13e's window, as drawn: work on the search index, forty minutes from
 * 02:20 GST, two of four down.
 *
 * For the gallery, the tests and `docs/maintenance.md` — never a default. The
 * WhatsApp number is the board's specimen, corrected at export from a landline
 * placeholder; it is not a line anyone answers, and the handoff is explicit that
 * ops confirms the real one per window.
 */
export const SPECIMEN_WINDOW: MaintenanceRecord = {
  id: "2026-09-20-search-index",
  work: "search_index",
  startsAt: "2026-09-20T02:20:00+04:00",
  endsAt: "2026-09-20T03:00:00+04:00",
  affected: [
    { system: "search", state: "down" },
    { system: "requirements", state: "down" },
    { system: "quotes", state: "running" },
    { system: "notifications", state: "running" },
  ],
  whatsapp: "+971 50 118 4400",
};
