import "server-only";
import { prisma } from "@/lib/db/client";
import type { Attribution } from "@/lib/campaign/attribution";
import {
  DOCUMENT_BUCKET,
  removeObject,
  signUpload,
  statDocument,
  type SignedUpload,
} from "@/lib/storage";
import { sellsWork } from "@/lib/storefront/tabs";
import { createEnquiry } from "./service";
import { MAX_BRIEF_ATTACHMENTS } from "./service-brief";
import {
  MAX_ENQUIRY_ATTACHMENTS,
  checkEnquiryAttachment,
  checkServiceEnquiry,
  displayFilename,
  enquiryAttachmentPath,
  isEnquiryAttachmentPath,
  serviceLine,
  uaeToday,
  type ServiceEnquiryRefusal,
} from "./service-enquiry";

/**
 * Board `1d-s` — sending the enquiry a firm that sells work receives, and the
 * one file that may come with it.
 *
 * The rules are in `./service-enquiry.ts` and the fan-out, the recipients, the
 * routing and the notifications are `createEnquiry`'s. This is the order they
 * run in, and the two things only a server can do: know which services are live
 * and speak to storage.
 *
 * ## The file travels after the enquiry, never before it
 *
 * The upload is signed **for an enquiry that already exists**, under that
 * enquiry's own folder. The obvious alternative — sign on pick, as the seller
 * screens do — hands a signed write into a private bucket to anyone who opens a
 * public storefront, with no enquiry, no phone number and no recipient behind
 * it. Here a signature costs a delivered enquiry, which is rate enough.
 *
 * If the upload then fails, the enquiry stands and the buyer is told plainly
 * that the file did not arrive. A requirement delivered without its trial
 * balance is a worse enquiry; a requirement lost because storage blinked is no
 * enquiry at all.
 *
 * Storage is a parameter so the integration project, which has Postgres and
 * no Storage, can exercise every branch.
 */

export interface StorageDeps {
  sign: (bucket: string, path: string) => Promise<SignedUpload>;
  stat: typeof statDocument;
  remove: (bucket: string, path: string) => Promise<void>;
}

export const storageDeps: StorageDeps = { sign: signUpload, stat: statDocument, remove: removeObject };
const storage = storageDeps;

export interface SendServiceEnquiryInput {
  businessId: string;
  /** A live service slug, or empty for *something not listed*. */
  service: string;
  requirement: string;
  scale: string;
  neededBy: string;
  attachment: { filename: string; type: string; bytes: number } | null;
  /** Ignored for a signed-in buyer. */
  contactPhone: string;
  contactName: string;
}

export type SendServiceEnquiryResult =
  | {
      ok: true;
      enquiryId: string;
      ref: string;
      /** Where the buyer lands. Carries the claim token for a buyer with no account. */
      next: string;
      /** The signed write for the file, when there is one and signing worked. */
      upload: { url: string; path: string } | null;
      /** A file was chosen and could not be signed for. The enquiry still went. */
      uploadUnavailable: boolean;
      claimToken: string | null;
    }
  | { ok: false; refusals: ServiceEnquiryRefusal[] }
  /** `own_business`: the firm is the one the sender's own seat is on — see `createEnquiry`. */
  | { ok: false; error: "not_found" | "no_recipients" | "no_buyer" | "own_business" };

export async function sendServiceEnquiry(
  input: SendServiceEnquiryInput,
  context: { buyerId: string | null; attribution?: Attribution | null },
  deps: StorageDeps = storage,
  now: Date = new Date(),
): Promise<SendServiceEnquiryResult> {
  /*
     The storefront the form sits on, re-read rather than trusted. A suspended,
     unpublished or unclaimed listing has no composer, and neither does a goods
     seller: this path writes a service enquiry and nothing else.
  */
  const business = await prisma.business.findFirst({
    where: {
      id: input.businessId,
      publishedAt: { not: null },
      suspendedAt: null,
      claimStatus: { not: "unclaimed" },
    },
    select: { id: true, primaryCategoryId: true, sellsKind: true },
  });
  if (!business || !sellsWork(business.sellsKind)) return { ok: false, error: "not_found" };

  const services = await prisma.service.findMany({
    where: { businessId: business.id, status: "live" },
    select: { id: true, slug: true, name: true, categoryId: true },
  });

  const checked = checkServiceEnquiry(
    {
      service: input.service,
      requirement: input.requirement,
      scale: input.scale,
      neededBy: input.neededBy,
      attachment: input.attachment
        ? { type: input.attachment.type, bytes: input.attachment.bytes }
        : null,
      contactPhone: context.buyerId ? null : input.contactPhone,
    },
    services.map((service) => service.slug),
    uaeToday(now),
  );
  if (!checked.ok) return { ok: false, refusals: checked.refusals };

  const service = services.find((row) => row.slug === checked.value.serviceSlug) ?? null;

  const created = await createEnquiry(
    {
      buyerId: context.buyerId,
      phone: context.buyerId ? null : input.contactPhone,
      fullName: context.buyerId ? null : input.contactName.trim() || null,
      attribution: context.attribution ?? null,
      requirement: checked.value.requirement,
      lines: [serviceLine(service, checked.value.requirement)],
      /*
         The service's own subcategory where there is one. That is the trade the
         enquiry is about, and it is what `3l`'s *where enquiries come from* and
         the fan-out's category widening read — the firm's primary category is
         where it is filed, which for a multi-trade practice is not the same.
      */
      categoryId: service?.categoryId ?? business.primaryCategoryId,
      scale: checked.value.scale,
      neededBy: checked.value.neededBy,
      /*
         This firm and nobody else. A storefront is a single-seller surface —
         board 1d's criterion 3 — and a buyer who chose this practice has not
         asked for four more.
      */
      pinnedBusinessIds: [business.id],
      chosenBusinessIds: [business.id],
      fanoutTo: 1,
    },
    now,
  );
  if (!created.ok) {
    return { ok: false, error: created.error === "no_lines" ? "no_buyer" : created.error };
  }

  const params = new URLSearchParams({ sent: "1" });
  if (created.claimToken) params.set("t", created.claimToken);

  let upload: { url: string; path: string } | null = null;
  let uploadUnavailable = false;
  if (input.attachment) {
    try {
      const signed = await deps.sign(
        DOCUMENT_BUCKET,
        enquiryAttachmentPath(created.enquiryId, input.attachment.filename),
      );
      upload = { url: signed.url, path: signed.path };
    } catch {
      uploadUnavailable = true;
      params.set("attachment", "failed");
    }
  }

  return {
    ok: true,
    enquiryId: created.enquiryId,
    ref: created.ref,
    next: `/enquiry/${created.enquiryId}?${params}`,
    upload,
    uploadUnavailable,
    claimToken: created.claimToken,
  };
}

export type AttachResult =
  | { ok: true; documentId: string }
  | { ok: false; reason: "not_found" | "missing" | "refused" | "full" };

/**
 * The file arrived; write the row that points at it.
 *
 * Four checks, and a refusal on any of them writes nothing:
 *
 *  1. **The asker is the buyer.** Signed in as them, or holding the claim token
 *     their tracking link carries. An enquiry id alone is not a credential —
 *     it is in every recipient's inbox URL.
 *  2. **The path is this enquiry's.** Derived from the id and checked against
 *     it, so a posted path cannot point the row at somebody else's file.
 *  3. **Storage holds it, and it is what the bucket allows.** Read back from
 *     storage, not from the form — the bytes are not bound by what the browser
 *     said about them. A file that fails is removed, not orphaned.
 *  4. **Within the set.** One file for a storefront enquiry, five for a brief
 *     (`1h-s` B8). A confirm past the limit is refused rather than stacked.
 *
 * `not_found` for the first two, and for an enquiry that does not exist: the
 * same answer for *not yours* and *not there*, so the endpoint is not an oracle.
 */
export async function confirmEnquiryAttachment(
  input: { enquiryId: string; path: string; filename: string; claimToken: string | null },
  context: { actorId: string | null },
  deps: StorageDeps = storage,
): Promise<AttachResult> {
  const enquiry = await prisma.enquiry.findUnique({
    where: { id: input.enquiryId },
    select: {
      id: true,
      buyerId: true,
      buyer: { select: { claimToken: true } },
      _count: { select: { attachments: true } },
      serviceBrief: { select: { enquiryId: true } },
    },
  });
  if (!enquiry) return { ok: false, reason: "not_found" };

  const isBuyer =
    (context.actorId !== null && context.actorId === enquiry.buyerId) ||
    (input.claimToken !== null &&
      input.claimToken !== "" &&
      enquiry.buyer.claimToken !== null &&
      enquiry.buyer.claimToken === input.claimToken);
  if (!isBuyer) return { ok: false, reason: "not_found" };

  if (!isEnquiryAttachmentPath(enquiry.id, input.path)) return { ok: false, reason: "not_found" };
  const limit = enquiry.serviceBrief ? MAX_BRIEF_ATTACHMENTS : MAX_ENQUIRY_ATTACHMENTS;
  if (enquiry._count.attachments >= limit) return { ok: false, reason: "full" };

  const stored = await deps.stat(input.path);
  if (!stored) return { ok: false, reason: "missing" };

  if (checkEnquiryAttachment(stored.mimeType ?? "", stored.bytes)) {
    await deps.remove(DOCUMENT_BUCKET, input.path);
    return { ok: false, reason: "refused" };
  }

  const document = await prisma.document.create({
    data: {
      kind: "enquiry_attachment",
      enquiryId: enquiry.id,
      storagePath: input.path,
      filename: displayFilename(input.filename),
      bytes: stored.bytes,
      mimeType: stored.mimeType,
      // The column's default, said out loud: a buyer's trial balance is never
      // a public document, and nothing downstream may treat it as one.
      isPublic: false,
    },
    select: { id: true },
  });

  return { ok: true, documentId: document.id };
}
