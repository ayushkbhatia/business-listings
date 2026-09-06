import "server-only";
import { prisma } from "@/lib/db/client";
import { maskTRN } from "@/lib/format";
import {
  credentialState,
  isCheckedByUs,
  isCredential,
  isOnStorefront,
  type CredentialState,
} from "@/lib/verification/credentials";
import { daysUntil, licenceStage, type LicenceStage } from "@/lib/verification";
import type { Authority, DocumentKind } from "@/lib/db/generated/enums";

/**
 * Board 3e's page, in one read.
 *
 * ## The TRN never leaves this function
 *
 * Criterion 7: *the TRN is masked in every response, not in the view.* The
 * column is selected here, masked here, and what the caller receives is a
 * fifteen-character string with eight bullets in the middle — there is no
 * shape of this result that carries the real number, so no later refactor can
 * accidentally send one to a browser. The storefront rail masks at render,
 * which is fine for a server component and would not be fine the day somebody
 * makes it a client one; this is the stronger arrangement and the one the
 * criterion asks for.
 *
 * ## Every count and date is a query
 *
 * The render this was built from hardcodes both numbers on the screen — the
 * 220 days to expiry and the 22 to the Civil Defence lapse — and the spec is
 * explicit that both are computed in the build, because *"a date in a fixture
 * goes stale and starts lying"*. `daysToExpiry` is derived from the expiry date
 * at read time and stored nowhere.
 */

export interface CheckedDocument {
  /** `trade_licence` or `vat_certificate`. Never anything publishable. */
  kind: "trade_licence" | "vat_certificate";
  /** Licence number as issued, or the **masked** TRN. Never a raw TRN. */
  number: string | null;
  expiresAt: Date | null;
  checkedAt: Date | null;
}

export interface CredentialDocument {
  id: string;
  kind: DocumentKind;
  /** What a buyer would call it, falling back to the file's own name. */
  name: string;
  reference: string | null;
  validUntil: Date | null;
  state: CredentialState;
  /** Days left, computed. Null where the document does not expire. */
  daysLeft: number | null;
  isPublic: boolean;
  onStorefront: boolean;
  reviewReason: string | null;
}

export interface UploadedDocument {
  id: string;
  kind: DocumentKind;
  filename: string;
  uploadedAt: Date;
  /**
   * False for a trade licence or VAT certificate we have already checked.
   *
   * That document is the evidence behind the tier, so a seller removing it
   * would be removing the thing their own badge rests on — and board 3e open
   * question 5 keeps even a lapsed one, because deleting it makes the tier
   * history unauditable. A renewal replaces it; nothing else does.
   */
  deletable: boolean;
}

export interface VerificationView {
  tier: number;
  verifiedAt: Date | null;
  licenceAuthority: Authority;
  licenceExpiry: Date;
  /** Computed at read time. Negative once the licence has lapsed. */
  daysToExpiry: number;
  stage: LicenceStage;
  checked: CheckedDocument[];
  credentials: CredentialDocument[];
  /** Every file on the account, for the upload surface's own list. */
  uploads: UploadedDocument[];
}

export async function getVerification(
  businessId: string,
  now: Date = new Date(),
): Promise<VerificationView | null> {
  const [business, documents] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: {
        verificationTier: true,
        verifiedAt: true,
        licenceNumber: true,
        licenceAuthority: true,
        licenceExpiry: true,
        trn: true,
      },
    }),
    prisma.document.findMany({
      where: { businessId, kind: { not: "enquiry_attachment" } },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        kind: true,
        filename: true,
        displayName: true,
        reference: true,
        validUntil: true,
        isPublic: true,
        reviewedAt: true,
        reviewReason: true,
        createdAt: true,
      },
    }),
  ]);
  if (!business) return null;

  /*
     Two rows, always, and the second one even when there is no TRN.

     A missing TRN renders `Not provided` in grey rather than dropping the row —
     CLAUDE.md's interface-honesty rule about unfilled data. A seller who is not
     VAT registered should see that we know the field is empty; a seller who is
     should see the gap they can close.
  */
  const checked: CheckedDocument[] = [
    {
      kind: "trade_licence",
      number: business.licenceNumber,
      expiresAt: business.licenceExpiry,
      checkedAt: business.verifiedAt,
    },
    {
      kind: "vat_certificate",
      // Masked here. See the note at the top of the file.
      number: business.trn ? maskTRN(business.trn) : null,
      expiresAt: null,
      checkedAt: business.trn ? business.verifiedAt : null,
    },
  ];

  // Certificates and approvals only. A catalogue and a datasheet are
  // publishable and are not credentials — see `CREDENTIAL_KINDS`.
  const credentials = documents.filter((document) => isCredential(document.kind));

  return {
    tier: business.verificationTier,
    verifiedAt: business.verifiedAt,
    licenceAuthority: business.licenceAuthority,
    licenceExpiry: business.licenceExpiry,
    daysToExpiry: daysUntil(business.licenceExpiry, now),
    stage: licenceStage(business.licenceExpiry, now),
    checked,
    uploads: documents.map((document) => ({
      id: document.id,
      kind: document.kind,
      filename: document.filename,
      uploadedAt: document.createdAt,
      deletable: !(isCheckedByUs(document.kind) && business.verifiedAt !== null),
    })),
    credentials: credentials.map((document) => ({
      id: document.id,
      kind: document.kind,
      name: document.displayName ?? document.filename,
      reference: document.reference,
      validUntil: document.validUntil,
      state: credentialState(document, now),
      daysLeft: document.validUntil ? daysUntil(document.validUntil, now) : null,
      isPublic: document.isPublic,
      onStorefront: isOnStorefront(document),
      reviewReason: document.reviewReason,
    })),
  };
}
