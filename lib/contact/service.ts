import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { formatPhone, toE164 } from "@/lib/format/phone";
import { checkRate, recordHit, requesterKey, retryAfterSeconds } from "@/lib/rate-limit";
import {
  mobileFieldValue,
  readLeadFields,
  type LandlineNumber,
  type LeadFieldsInput,
  type LeadProblems,
} from "./lead-form";

/**
 * Board `1d` amendment — the storefront's landline, masked, behind three fields.
 *
 * ## What the reveal is
 *
 * A supplier's landline renders masked (`04 88• ••••`). Clicking it the first
 * time on a listing asks for a name, a work email and a mobile; submitting them
 * records a `ContactLead` the seller reads on `/dashboard/leads/phone` and staff
 * on `/admin/leads`, and writes the `ContactReveal` event 3l counts. The number
 * comes back from the server in the action's reply — it is never in the page a
 * visitor who has not asked is sent (`B2`).
 *
 * ## The three identities, and what each one gates
 *
 * - **visitor** (`bl_vid`, a persistent cookie set by the form's submit and by
 *   nothing before it) — the form is asked once per visitor and listing (`B10`).
 *   A signed-in buyer is matched on their account as well, so a second device
 *   does not ask again.
 * - **session** (`bl_rsid`, a browser-session cookie) — a reveal is one row per
 *   session, listing and channel (`B1`, `B6`), and the storefront stays revealed
 *   for the rest of it (`Q1b`). A new session is masked again: a reveal is not a
 *   permanent entitlement.
 * - **actor** — the signed-in buyer, where there is one. It prefills the form
 *   from their account (`B12`) and never skips it: the form is also where the
 *   buyer is told this supplier receives the three fields, and a lead the buyer
 *   was not shown going out is not one to hand a seller.
 *
 * ## Never gate the buyer on our bookkeeping
 *
 * The spec's last state row: if the event write fails, the number still
 * reveals. The same holds for the lead — once the fields are valid and the
 * listing has a landline, a failed insert is logged and retried after the
 * response rather than put between the buyer and the number they were promised
 * in thirty seconds.
 */

export const VISITOR_COOKIE = "bl_vid";
export const SESSION_COOKIE = "bl_rsid";

/**
 * How long the form stays answered for one browser. Half a year: long enough
 * that a buyer comparing the same suppliers next quarter is not asked again,
 * short enough that a shared office machine forgets.
 */
export const VISITOR_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 180;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION = /^[A-Za-z0-9_-]{16,64}$/;

/** A cookie's value, or null where it is not one this module wrote. */
export function readVisitorId(value: string | undefined): string | null {
  return value && UUID.test(value) ? value.toLowerCase() : null;
}

export function readSessionId(value: string | undefined): string | null {
  return value && SESSION.test(value) ? value : null;
}

export function mintSessionId(): string {
  return randomUUID().replace(/-/g, "");
}

export interface RevealViewer {
  visitorId: string | null;
  sessionId: string | null;
  actorId: string | null;
}

export type { LandlineNumber };

export interface Landlines {
  businessId: string;
  /** The location the identity block's chip reveals — the storefront's head office. */
  headLocationId: string | null;
  /** Every published location's landline, by location id. The branches tab reads all of them. */
  numbers: Record<string, LandlineNumber>;
}

/**
 * The numbers a reveal hands back, for one listing a buyer may reveal on.
 *
 * Null for anything without a public claimed storefront: an unclaimed listing
 * has no contact chips at all (`10g`) — there is no verified number to reveal —
 * and a suspended or unpublished one has no page to reveal on. Null too where
 * no published location carries a number, which is the *seller has no landline*
 * state: the chip is absent, not masked-and-empty.
 *
 * Ordered exactly as `getBusinessBySlug` orders locations, so the head office
 * the chip reveals is the head office the page drew.
 */
export async function landlinesFor(businessId: string): Promise<Landlines | null> {
  const business = await prisma.business.findFirst({
    where: { id: businessId, suspendedAt: null, publishedAt: { not: null }, claimStatus: { not: "unclaimed" } },
    select: {
      id: true,
      locations: {
        where: { published: true },
        select: { id: true, phone: true },
        orderBy: [{ type: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!business) return null;

  const numbers: Record<string, LandlineNumber> = {};
  const add = (key: string, phone: string | null) => {
    if (!phone) return;
    numbers[key] = { display: formatPhone(phone), tel: toE164(phone) ?? phone.replace(/[^\d+]/g, "") };
  };
  for (const location of business.locations) add(location.id, location.phone);
  if (Object.keys(numbers).length === 0) return null;

  const head = business.locations[0];
  return {
    businessId: business.id,
    headLocationId: head && numbers[head.id] ? head.id : null,
    numbers,
  };
}

export interface LeadPrefill {
  name: string;
  email: string;
  /** As the field shows it, beside its fixed +971. */
  mobile: string;
}

export interface ContactGate {
  /** Revealed in this session already — render the numbers, the note, and fire nothing. */
  revealed: boolean;
  /** No lead from this visitor or account on this listing yet (`B10`). */
  formRequired: boolean;
  /** What the form opens with, where it will be asked. */
  prefill: LeadPrefill | null;
}

/**
 * Where a viewer stands on one listing, for the page's render.
 *
 * Two indexed reads, and only for a storefront that has a landline to mask.
 */
export async function contactGate(businessId: string, viewer: RevealViewer): Promise<ContactGate> {
  const [reveal, lead] = await Promise.all([
    viewer.sessionId
      ? prisma.contactReveal.findUnique({
          where: {
            sessionId_businessId_channel: { sessionId: viewer.sessionId, businessId, channel: "phone" },
          },
          select: { id: true },
        })
      : null,
    existingLead(businessId, viewer),
  ]);

  const formRequired = lead === null;
  return {
    revealed: reveal !== null,
    formRequired,
    prefill: formRequired ? await prefillFor(viewer) : null,
  };
}

async function existingLead(businessId: string, viewer: RevealViewer) {
  const or: Prisma.ContactLeadWhereInput[] = [];
  if (viewer.visitorId) or.push({ visitorId: viewer.visitorId });
  if (viewer.actorId) or.push({ actorId: viewer.actorId });
  if (or.length === 0) return null;
  return prisma.contactLead.findFirst({
    where: { businessId, OR: or },
    select: { id: true, visitorId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * Whether this session already revealed on the listing, and the numbers if so.
 *
 * For a storefront route that stays cached for every reader — the branches tab
 * — and so cannot put one buyer's revealed state in its render. The browser asks
 * after the page loads, and only where it holds a session cookie at all.
 */
export async function revealedInSession(businessId: string, viewer: RevealViewer): Promise<Landlines | null> {
  if (!viewer.sessionId) return null;
  const reveal = await prisma.contactReveal.findUnique({
    where: { sessionId_businessId_channel: { sessionId: viewer.sessionId, businessId, channel: "phone" } },
    select: { id: true },
  });
  return reveal ? landlinesFor(businessId) : null;
}

/**
 * `B12`. A signed-in buyer's own account first — name, email and mobile are
 * all there — and otherwise the details this browser gave the last supplier it
 * revealed. Either way the buyer confirms with one tap; nothing is sent to a
 * seller the buyer was not shown on this seller's form.
 */
async function prefillFor(viewer: RevealViewer): Promise<LeadPrefill | null> {
  if (viewer.actorId) {
    const user = await prisma.user.findUnique({
      where: { id: viewer.actorId },
      select: { fullName: true, email: true, phone: true },
    });
    if (user && (user.fullName || user.email || user.phone)) {
      return {
        name: user.fullName ?? "",
        email: user.email ?? "",
        mobile: mobileFieldValue(user.phone),
      };
    }
  }
  if (viewer.visitorId) {
    const last = await prisma.contactLead.findFirst({
      where: { visitorId: viewer.visitorId },
      select: { name: true, email: true, mobile: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (last) return { name: last.name, email: last.email, mobile: mobileFieldValue(last.mobile) };
  }
  return null;
}

export type RevealRefusal =
  /** The form has not been answered for this listing by this visitor — with what it opens with. */
  | { ok: false; reason: "form_required"; prefill: LeadPrefill | null }
  | { ok: false; reason: "invalid"; problems: LeadProblems }
  /** Nothing to reveal: unclaimed, unpublished, suspended, or no landline. */
  | { ok: false; reason: "no_landline" }
  | { ok: false; reason: "rate_limited"; retryAfterS: number };

export type RevealOutcome =
  | {
      ok: true;
      landlines: Landlines;
      /** The identities to set as cookies — minted here where the viewer had none. */
      visitorId: string | null;
      sessionId: string;
    }
  | RevealRefusal;

/**
 * A contact-lead insert is the one write on this path a script could repeat to
 * walk the directory's numbers. Twenty an hour per requester is more listings
 * than a buyer compares in a sitting and still refuses a loop.
 */
export async function submitContactLead(input: {
  businessId: string;
  fields: LeadFieldsInput;
  viewer: RevealViewer;
  sourcePath: string | null;
  now?: Date;
  /** The rate limiter's key. Read from the request where absent. */
  requester?: string;
}): Promise<RevealOutcome> {
  const read = readLeadFields(input.fields);
  if (!read.ok) return { ok: false, reason: "invalid", problems: read.problems };

  const landlines = await landlinesFor(input.businessId);
  if (!landlines) return { ok: false, reason: "no_landline" };

  const sessionId = input.viewer.sessionId ?? mintSessionId();
  const now = input.now ?? new Date();

  let lead = await existingLead(input.businessId, input.viewer);
  let visitorId = input.viewer.visitorId ?? lead?.visitorId ?? null;

  if (!lead) {
    const identifier = input.requester ?? (await requesterKey(input.viewer.actorId));
    const decision = await checkRate("contact_lead", identifier, now);
    if (!decision.allowed) {
      return { ok: false, reason: "rate_limited", retryAfterS: retryAfterSeconds(decision) };
    }
    await recordHit("contact_lead", identifier);

    visitorId = visitorId ?? randomUUID();
    const data = {
      businessId: input.businessId,
      visitorId,
      actorId: input.viewer.actorId,
      name: read.lead.name,
      email: read.lead.email,
      mobile: read.lead.mobile,
      sourcePath: input.sourcePath,
      createdAt: now,
    };
    try {
      lead = await prisma.contactLead.create({ data, select: { id: true, visitorId: true } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // The same browser submitted twice at once. The first row is the lead.
        lead = await existingLead(input.businessId, { ...input.viewer, visitorId });
      } else {
        console.error("[contact_lead] write failed; revealing anyway and retrying", error);
        later(() => retry(() => prisma.contactLead.create({ data }), "contact_lead"));
      }
    }
  }

  await recordReveal({
    businessId: input.businessId,
    locationId: landlines.headLocationId,
    channel: "phone",
    sessionId,
    leadId: lead?.id ?? null,
    actorId: input.viewer.actorId,
    sourcePath: input.sourcePath,
  });

  return { ok: true, landlines, visitorId, sessionId };
}

/**
 * The chip clicked by somebody who has already answered the form for this
 * listing — on an earlier visit, or on another device while signed in. No form
 * (`B10`); one reveal row for this session.
 */
export async function revealForReturningVisitor(input: {
  businessId: string;
  viewer: RevealViewer;
  sourcePath: string | null;
}): Promise<RevealOutcome> {
  const [landlines, lead] = await Promise.all([
    landlinesFor(input.businessId),
    existingLead(input.businessId, input.viewer),
  ]);
  if (!landlines) return { ok: false, reason: "no_landline" };
  if (!lead) return { ok: false, reason: "form_required", prefill: await prefillFor(input.viewer) };

  const sessionId = input.viewer.sessionId ?? mintSessionId();
  await recordReveal({
    businessId: input.businessId,
    locationId: landlines.headLocationId,
    channel: "phone",
    sessionId,
    leadId: lead.id,
    actorId: input.viewer.actorId,
    sourcePath: input.sourcePath,
  });
  return { ok: true, landlines, visitorId: input.viewer.visitorId ?? lead.visitorId, sessionId };
}

/**
 * `B4`. WhatsApp is a direct action — the chip is a `wa.me` link and asks
 * nothing. Opening it is still a contact the seller's funnel counts, so it is
 * recorded: once per session where the buyer already has a session from a
 * reveal, and otherwise with no session at all, because minting an identifier
 * to deduplicate a counter is the consent question `docs/telemetry.md` §4
 * keeps this site out of.
 */
export async function recordWhatsAppOpen(input: {
  businessId: string;
  viewer: RevealViewer;
  sourcePath: string | null;
}): Promise<void> {
  const exists = await prisma.business.count({
    where: { id: input.businessId, suspendedAt: null, publishedAt: { not: null } },
  });
  if (exists === 0) return;
  await recordReveal({
    businessId: input.businessId,
    locationId: null,
    channel: "whatsapp",
    sessionId: input.viewer.sessionId,
    leadId: null,
    actorId: input.viewer.actorId,
    sourcePath: input.sourcePath,
  });
}

interface RevealRow {
  businessId: string;
  locationId: string | null;
  channel: "phone" | "whatsapp";
  /** Null only for a WhatsApp open with no session — which nothing deduplicates. */
  sessionId: string | null;
  leadId: string | null;
  actorId: string | null;
  sourcePath: string | null;
}

/**
 * One row per (session, listing, channel), and never in the buyer's way.
 *
 * `skipDuplicates` is `ON CONFLICT DO NOTHING` against the unique index, so a
 * second reveal in the session — a reload, a tab switch, the branches tab — is
 * the same row rather than an inflated count (`B6`). A failure is logged and
 * tried again after the response (the spec's *queue the event*): the number has
 * already gone back to the buyer either way.
 */
async function recordReveal(row: RevealRow): Promise<void> {
  const write = () =>
    prisma.contactReveal.createMany({
      data: [{ ...row, surface: "storefront" }],
      skipDuplicates: true,
    });
  try {
    await write();
  } catch (error) {
    console.error("[contact_reveal] write failed; retrying after the response", error);
    later(() => retry(write, "contact_reveal"));
  }
}

/** `after()` inside a request; outside one (a job, a test) the retry simply runs. */
function later(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

async function retry(write: () => Promise<unknown>, label: string): Promise<void> {
  for (const waitMs of [500, 2_000, 8_000]) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    try {
      await write();
      return;
    } catch (error) {
      // Already written, or refused by a key no retry will change: stop.
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2003")) {
        console.error(`[${label}] not retried`, error.code);
        return;
      }
      console.error(`[${label}] retry failed`, error);
    }
  }
}
