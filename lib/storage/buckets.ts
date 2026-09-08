/**
 * Where uploaded bytes live, and who may read them.
 *
 * Two buckets, and the split is the whole point. Photographs are on a public
 * storefront and are meant to be seen; trade licences and VAT certificates are
 * documents a supplier handed us to be verified, and nothing about that implies
 * consent to publish them. A single bucket with per-object rules would make the
 * private case the exception, and the exception is the one that must not fail.
 *
 * Pure — no Supabase import — so the path conventions can be tested and the
 * seed can use them without a network.
 */

export const MEDIA_BUCKET = "business-media";
export const DOCUMENT_BUCKET = "business-documents";
/**
 * Invoice PDFs, written by us at issue. Board 11g.
 *
 * A third bucket rather than a folder in `business-documents`, and the reason is
 * retention rather than tidiness. That bucket holds files a **seller uploaded**
 * for staff to verify — a trade licence is replaceable, and a future "remove
 * this business's uploaded documents" job would be right to sweep it. An invoice
 * is a legal record **we issued**, which we have promised to serve byte for byte
 * for as long as it is asked for, and it must outlive exactly that kind of job.
 *
 * Same access rules as documents: private, reached only through a brief signed
 * link.
 */
export const INVOICE_BUCKET = "invoice-documents";

/** Public read, because these render on a storefront a buyer has not signed into. */
export const PUBLIC_BUCKETS = [MEDIA_BUCKET] as const;
/** No public read at any URL. Reached only through a signed link, briefly. */
export const PRIVATE_BUCKETS = [DOCUMENT_BUCKET, INVOICE_BUCKET] as const;

/**
 * Where one invoice's PDF lives, keyed by its id.
 *
 * Not through `safeName`: that appends a random suffix so two uploads of
 * `licence.pdf` cannot collide, which is right for a file a seller names and
 * wrong here. The path has to be **derivable from the invoice**, because the
 * download reads it back and a stored path is the only thing that could point at
 * the wrong file. The id never moves and the ref is unique.
 */
export function invoicePdfPath(businessId: string, invoiceId: string, ref: string): string {
  return `${businessId}/${invoiceId}/${ref}.pdf`;
}

/**
 * One megabyte, for a stored photograph.
 *
 * It was eight, which was a ceiling on what a browser could send rather than a
 * decision about what we keep. At the scale this directory is built for —
 * tens of thousands of listings, five photographs each, every one of them
 * fetched by a buyer on a phone — eight megabytes an image is the difference
 * between a storefront that opens and one that does not.
 *
 * **This is not a refusal a seller ever meets.** A photograph off any current
 * phone is two to eight megabytes, and board 8b's whole premise is that a phone
 * camera is fine. `lib/images/downscale.ts` decodes, resizes and re-encodes in
 * the browser before anything is uploaded, so the file that arrives is already
 * under this. The limit is the fence behind that, and the bucket carries the
 * same number so a direct write to a signed URL cannot walk around it.
 */
export const MAX_IMAGE_BYTES = 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;

/**
 * A trade licence, on board 2b, where the ceiling is lower than the platform's.
 *
 * Ten megabytes is what that screen tells a supplier, and a limit stated on a
 * screen has to be the limit enforced by the server or it is decoration. Below
 * `MAX_DOCUMENT_BYTES` on purpose: a licence is one or two pages, and an upload
 * larger than this is a photograph nobody has resized — which is a slow upload
 * on a warehouse connection and a slow read afterwards.
 */
export const MAX_LICENCE_BYTES = 10 * 1024 * 1024;

/**
 * One megabyte for an invoice PDF, which is roughly thirty times what one is.
 *
 * A single A4 page with no embedded fonts and no images is tens of kilobytes.
 * The ceiling is here so the bucket has one, not because anything approaches it.
 */
export const MAX_INVOICE_BYTES = 1024 * 1024;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export const DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

/**
 * Everything a business owns sits under its own id.
 *
 * Not under a slug: a slug changes when a trade name changes, and a rename that
 * silently orphans every photograph is a bad afternoon. The id never moves.
 */
export function mediaPath(businessId: string, kind: string, filename: string): string {
  return `${businessId}/${kind}/${safeName(filename)}`;
}

export function documentPath(businessId: string, kind: string, filename: string): string {
  return `${businessId}/${kind}/${safeName(filename)}`;
}

/**
 * A filename that cannot escape its folder or collide with the last upload.
 *
 * The random suffix is not decoration: two uploads called `photo.jpg` are the
 * normal case, and the second silently replacing the first is the kind of thing
 * a seller discovers weeks later.
 */
export function safeName(filename: string): string {
  const cleaned = filename
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-80);
  const stem = cleaned.replace(/\.[a-z0-9]+$/, "") || "file";
  const extension = /\.([a-z0-9]+)$/.exec(cleaned)?.[1] ?? "bin";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${stem}-${suffix}.${extension}`;
}

export type UploadRefusal = { ok: false; reason: string };
export type UploadAccepted = { ok: true };

/**
 * Refuse before uploading, not after.
 *
 * The message says the limit and the actual size, because "file too large" sends
 * a seller back to a folder with no idea which of eleven photographs to shrink.
 */
export function checkImage(type: string, bytes: number): UploadAccepted | UploadRefusal {
  if (!(IMAGE_TYPES as readonly string[]).includes(type)) {
    return {
      ok: false,
      reason: `That is a ${type || "file of unknown type"}. Photographs must be JPEG, PNG, WebP or AVIF.`,
    };
  }
  if (bytes > MAX_IMAGE_BYTES) {
    /*
       A seller should not reach this. The browser resizes first, so arriving
       here means the resize was skipped or bypassed — which is worth a plain
       sentence rather than a cheerful one, because there is nothing they can
       do about it from where they are standing.
    */
    return {
      ok: false,
      reason: `That photograph is ${megabytes(bytes)} MB after resizing. The limit is ${megabytes(MAX_IMAGE_BYTES)} MB.`,
    };
  }
  return { ok: true };
}

export function checkDocument(
  type: string,
  bytes: number,
  /** Board 2b passes its own, lower ceiling. Defaults to the platform's. */
  limit: number = MAX_DOCUMENT_BYTES,
): UploadAccepted | UploadRefusal {
  if (!(DOCUMENT_TYPES as readonly string[]).includes(type)) {
    return {
      ok: false,
      reason: `That is a ${type || "file of unknown type"}. Documents must be a PDF, JPEG or PNG.`,
    };
  }
  if (bytes > limit) {
    return {
      ok: false,
      reason: `That document is ${megabytes(bytes)} MB. The limit is ${megabytes(limit)} MB.`,
    };
  }
  return { ok: true };
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");
}
