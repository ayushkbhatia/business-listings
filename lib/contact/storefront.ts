import "server-only";
import { cookies } from "next/headers";
import { maskPhone, toE164 } from "@/lib/format/phone";
import { pairedCopyFor } from "@/lib/strings/store";
import {
  SESSION_COOKIE,
  VISITOR_COOKIE,
  contactGate,
  landlinesFor,
  readSessionId,
  readVisitorId,
  type Landlines,
  type LeadPrefill,
} from "./service";

/**
 * What a storefront route hands `ContactReveal`, decided once per render.
 *
 * Three routes render the reveal — the goods overview, the services overview
 * and the branches tab — and a buyer who revealed on one has revealed on all of
 * them for the session. One reader, so the three cannot disagree about whether
 * a number is shown.
 *
 * Everything here is data: strings and booleans a client component can
 * receive. The numbers are included only where this viewer already revealed in
 * this session; otherwise the page carries the mask and nothing else (`B2`).
 */

export interface StorefrontContact {
  businessId: string;
  supplierName: string;
  /** The head office's masked landline, or null — no landline, no chip. */
  masked: string | null;
  /** `https://wa.me/<digits>`, or null. Never gated (`B4`). */
  whatsAppHref: string | null;
  formRequired: boolean;
  prefill: LeadPrefill | null;
  initial: Pick<Landlines, "numbers" | "headLocationId"> | null;
  note: string;
  privacyHref: string;
}

interface ContactBusiness {
  id: string;
  displayName: string;
  sellsKind: "unset" | "goods" | "services" | "both";
  claimStatus: string;
  locations: readonly { id: string; phone: string | null; whatsapp: string | null }[];
}

export async function storefrontContact(
  business: ContactBusiness,
  actor: { id: string } | null,
): Promise<StorefrontContact> {
  const [base, store] = await Promise.all([cachedStorefrontContact(business), cookies()]);
  if (!base.hasLandline) return base.contact;

  const viewer = {
    visitorId: readVisitorId(store.get(VISITOR_COOKIE)?.value),
    sessionId: readSessionId(store.get(SESSION_COOKIE)?.value),
    actorId: actor?.id ?? null,
  };

  /*
     A viewer who revealed this session is given the numbers in this render —
     theirs alone, since the route reads cookies and is never cached across
     readers.
  */
  const gate = await contactGate(business.id, viewer);
  const landlines = gate.revealed ? await landlinesFor(business.id) : null;

  return {
    ...base.contact,
    formRequired: gate.formRequired,
    prefill: gate.prefill,
    initial: landlines ? { numbers: landlines.numbers, headLocationId: landlines.headLocationId } : null,
  };
}

/**
 * The same, for a route cached across every reader — the branches tab — which
 * reads no cookie and so cannot know this viewer. The chip tries the reveal on
 * click and the server says whether the form is needed; a returning session is
 * resolved in the browser after load (`resolveOnMount`).
 */
export async function cachedStorefrontContact(
  business: ContactBusiness,
): Promise<{ contact: StorefrontContact; hasLandline: boolean }> {
  const head = business.locations[0];
  /*
     Whether the reveal is live at all. Claimed is enough to ask: a listing's
     numbers are its locations' landlines and its team section's lines, and the
     team is not in this render's data. `landlinesFor` answers exactly, on click.
  */
  const hasLandline = business.claimStatus !== "unclaimed";
  const copy = await pairedCopyFor(business.sellsKind);
  const whatsapp = head?.whatsapp ? (toE164(head.whatsapp) ?? head.whatsapp).replace(/[^\d]/g, "") : null;

  return {
    hasLandline,
    contact: {
      businessId: business.id,
      supplierName: business.displayName,
      masked: hasLandline && head?.phone ? maskPhone(head.phone) : null,
      whatsAppHref: whatsapp ? `https://wa.me/${whatsapp}` : null,
      formRequired: false,
      prefill: null,
      initial: null,
      note: copy["contact.reveal_note"],
      privacyHref: "/privacy",
    },
  };
}

/** Each location's masked landline, for the branches tab. */
export function maskedLandlines(locations: readonly { id: string; phone: string | null }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const location of locations) {
    if (location.phone) out[location.id] = maskPhone(location.phone);
  }
  return out;
}
