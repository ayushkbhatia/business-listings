import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCanEditListing } from "@/lib/auth/guards";
import { checkTaxAgent } from "./fta";
import {
  CREDENTIAL_KINDS,
  isCheckable,
  isCredentialKind,
  rateOf,
  worthSuggesting,
  type SuggestionRate,
} from "./kinds";
import type { Actor } from "@/lib/auth/roles";
import type { CredentialKind, TrustTier } from "@/lib/db/generated/enums";

/**
 * Credentials against a database — board `8b-s`.
 *
 * The capability is `listing.edit`, not a new one. Board 7d gives the owner and
 * the manager "upload verification documents", which is this in the words that
 * board used, and `/dashboard/verification` already guards on it.
 *
 * ## Nothing refuses a save
 *
 * There is no path through this module that returns "you must fill in X". The
 * only refusals are structural — a kind that is not a kind, a row that belongs
 * to somebody else — and a credential with no number, no issuer, no expiry and
 * no file saves happily as what it is: the seller telling us they hold
 * something. That is board `8b-s`'s first build note and its first acceptance
 * criterion, and the way to keep it true is for the refusals not to exist.
 */

export interface CredentialRow {
  id: string;
  kind: CredentialKind;
  identifier: string | null;
  issuer: string | null;
  expiresOn: Date | null;
  trust: TrustTier;
  verifiedOn: Date | null;
  verifiedBy: string | null;
  document: { id: string; filename: string } | null;
}

export interface LicenceOnFile {
  number: string;
  authority: string;
  expiresOn: Date;
  /** Null until an ops lead has checked it. The screen says which. */
  verifiedOn: Date | null;
}

export interface CredentialsState {
  businessId: string;
  /** The subcategory the suggestion rates are computed over, by name. */
  category: string;
  /**
   * The one thing the platform has actually checked, read from the business
   * row — board `8b-s` B4. Never re-asked for, never editable here.
   */
  licence: LicenceOnFile;
  held: CredentialRow[];
  /** Evidenced, and empty where the evidence is thin — B6. */
  suggestions: SuggestionRate[];
  /** Whether an FTA register is wired up at all. The screen is honest about it. */
  registerLive: boolean;
}

export async function credentialsStateFor(businessId: string): Promise<CredentialsState | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      licenceNumber: true,
      licenceAuthority: true,
      licenceExpiry: true,
      verifiedAt: true,
      primaryCategoryId: true,
      primaryCategory: { select: { name: true } },
      credentials: {
        orderBy: [{ createdAt: "asc" }],
        select: {
          id: true,
          kind: true,
          identifier: true,
          issuer: true,
          expiresOn: true,
          trust: true,
          verifiedOn: true,
          verifiedBy: true,
          document: { select: { id: true, filename: true } },
        },
      },
    },
  });
  if (!business) return null;

  return {
    businessId: business.id,
    category: business.primaryCategory.name,
    licence: {
      number: business.licenceNumber,
      authority: business.licenceAuthority,
      expiresOn: business.licenceExpiry,
      verifiedOn: business.verifiedAt,
    },
    held: business.credentials,
    suggestions: worthSuggesting(
      await suggestionRates(business.primaryCategoryId),
      business.credentials.map((row) => row.kind),
    ),
    registerLive: Boolean(process.env.FTA_REGISTER_URL),
  };
}

/**
 * What share of the verified suppliers in this trade hold each kind — B6.
 *
 * "68% of verified suppliers in your subcategory hold it" is the mechanism the
 * suggestion rows run on: a seller does not know what their competitors show,
 * and the rate answers it in one line where a generic *you might also add…*
 * gets ignored.
 *
 * **Verified suppliers only**, which is the denominator the copy names. An
 * unclaimed licence import holds no credentials and never will, so counting it
 * would drag every rate toward zero and suppress every row — a number that is
 * wrong in the direction of saying nothing.
 *
 * Two queries whatever the answer: the peers, and the holdings across them.
 */
export async function suggestionRates(categoryId: string): Promise<SuggestionRate[]> {
  const peers = await prisma.business.findMany({
    where: {
      primaryCategoryId: categoryId,
      publishedAt: { not: null },
      suspendedAt: null,
      verifiedAt: { not: null },
    },
    select: { id: true },
  });
  if (peers.length === 0) {
    return CREDENTIAL_KINDS.map((kind) => ({ kind, holders: 0, peers: 0, rate: 0 }));
  }

  const holdings = await prisma.credential.groupBy({
    by: ["kind", "businessId"],
    where: { businessId: { in: peers.map((row) => row.id) } },
  });

  const holders = new Map<string, number>();
  for (const row of holdings) {
    holders.set(row.kind, (holders.get(row.kind) ?? 0) + 1);
  }

  return CREDENTIAL_KINDS.map((kind) => {
    const count = holders.get(kind) ?? 0;
    return { kind, holders: count, peers: peers.length, rate: rateOf(count, peers.length) };
  });
}

/* ── Writing ─────────────────────────────────────────────────────────────── */

export interface CredentialInput {
  kind: string;
  identifier?: string | null;
  issuer?: string | null;
  /** `yyyy-mm-dd`, as a date input holds it. Optional, and stays optional. */
  expiresOn?: string | null;
  documentId?: string | null;
}

/** Why a register check did not verify. Surfaced inline, never swallowed — AC10. */
export type RegisterNote = "not_found" | "bad_format" | "register_unavailable";

export type AddResult =
  | { ok: true; id: string; trust: TrustTier; registerNote: RegisterNote | null }
  | { ok: false; reason: "not_found" | "unknown_kind" };

/**
 * Add one credential — and the only two ways this refuses are structural.
 *
 * The tier is assigned here and never taken from the form, which is B3 and
 * AC3: a seller cannot choose to be verified, and the screen offers no control
 * that would let them try.
 *
 * A failed or impossible register check **saves the credential as a claim and
 * says so** — `8b-s` Q2, AC10. Blocking would be the wrong failure mode with a
 * register behind it and an impossible screen without one; silently downgrading
 * would be worse than either, because the seller may simply have mistyped.
 */
export async function addCredential(
  actor: Actor,
  businessId: string,
  input: CredentialInput,
  now: Date = new Date(),
): Promise<AddResult> {
  assertCanEditListing(actor);

  if (!isCredentialKind(input.kind)) return { ok: false, reason: "unknown_kind" };
  const exists = await prisma.business.count({ where: { id: businessId } });
  if (exists === 0) return { ok: false, reason: "not_found" };

  const identifier = clean(input.identifier);
  let trust: TrustTier = "seller_claim";
  let verifiedOn: Date | null = null;
  let verifiedBy: string | null = null;
  let registerNote: RegisterNote | null = null;

  if (isCheckable(input.kind) && identifier !== null) {
    const answer = await checkTaxAgent(identifier, now);
    if (answer.ok) {
      trust = "register_verified";
      verifiedOn = answer.verifiedOn;
      verifiedBy = answer.verifiedBy;
    } else {
      registerNote = answer.reason;
    }
  }

  const document = await ownDocument(businessId, input.documentId);

  const row = await prisma.credential.create({
    data: {
      businessId,
      kind: input.kind,
      identifier,
      issuer: clean(input.issuer),
      expiresOn: readDate(input.expiresOn),
      documentId: document,
      trust,
      verifiedOn,
      verifiedBy,
    },
    select: { id: true },
  });

  return { ok: true, id: row.id, trust, registerNote };
}

export async function removeCredential(
  actor: Actor,
  businessId: string,
  credentialId: string,
): Promise<{ ok: boolean }> {
  assertCanEditListing(actor);
  const { count } = await prisma.credential.deleteMany({
    where: { id: credentialId, businessId },
  });
  return { ok: count > 0 };
}

/**
 * A document id is only usable if it belongs to this business.
 *
 * The upload path already builds its storage key from the seat's own business,
 * so a foreign id can only arrive by being typed into a form — and a credential
 * pointing at somebody else's private certificate is the one mistake on this
 * screen that would matter. Unknown ids drop to null rather than refusing the
 * save, because refusing is the thing this screen does not do.
 */
async function ownDocument(businessId: string, documentId?: string | null): Promise<string | null> {
  const id = clean(documentId);
  if (id === null) return null;
  const document = await prisma.document.findFirst({
    where: { id, businessId },
    select: { id: true },
  });
  return document?.id ?? null;
}

function clean(value?: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed.slice(0, 200);
}

/** `yyyy-mm-dd` or nothing. An unparseable date is absent, never today's. */
function readDate(value?: string | null): Date | null {
  const raw = clean(value);
  if (raw === null) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/* ── What the buyer's page reads ─────────────────────────────────────────── */

export interface PublicCredential {
  id: string;
  kind: CredentialKind;
  identifier: string | null;
  issuer: string | null;
  expiresOn: Date | null;
  verified: boolean;
  verifiedBy: string | null;
}

/**
 * The trust block on `1g-s` and `1d-s` — board `8b-s`'s Feeds note.
 *
 * **The file never travels.** A credential document is private and stays
 * private (B10, AC9): what a buyer is shown is that the credential exists, what
 * it is, and whether anybody checked it. `documentId` is not selected here at
 * all, which is the same defence `indicativeFee` gets one board over — a field
 * that is never fetched cannot leak.
 */
export async function publicCredentialsFor(businessId: string): Promise<PublicCredential[]> {
  const rows = await prisma.credential.findMany({
    where: { businessId },
    /*
       Verified first, then by kind, then oldest — `1d-s`'s data model, `trust
       desc, kind`. "Desc" on the board means *most trusted first*; the enum is
       declared `register_verified` before `seller_claim`, so that is ascending
       here. Kind is the enum's declared order, which is the order the `8b-s`
       form offers them in, so the overview's first four are the checkable kind
       and the regulatory ones before the loose `other`.
    */
    orderBy: [{ trust: "asc" }, { kind: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      kind: true,
      identifier: true,
      issuer: true,
      expiresOn: true,
      trust: true,
      verifiedBy: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    identifier: row.identifier,
    issuer: row.issuer,
    expiresOn: row.expiresOn,
    verified: row.trust === "register_verified",
    verifiedBy: row.verifiedBy,
  }));
}
