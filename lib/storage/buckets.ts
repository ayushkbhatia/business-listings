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

/** Public read, because these render on a storefront a buyer has not signed into. */
export const PUBLIC_BUCKETS = [MEDIA_BUCKET] as const;
/** No public read at any URL. Reached only through a signed link, briefly. */
export const PRIVATE_BUCKETS = [DOCUMENT_BUCKET] as const;

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;

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
    return {
      ok: false,
      reason: `That photograph is ${megabytes(bytes)} MB. The limit is ${megabytes(MAX_IMAGE_BYTES)} MB.`,
    };
  }
  return { ok: true };
}

export function checkDocument(type: string, bytes: number): UploadAccepted | UploadRefusal {
  if (!(DOCUMENT_TYPES as readonly string[]).includes(type)) {
    return {
      ok: false,
      reason: `That is a ${type || "file of unknown type"}. Documents must be a PDF, JPEG or PNG.`,
    };
  }
  if (bytes > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      reason: `That document is ${megabytes(bytes)} MB. The limit is ${megabytes(MAX_DOCUMENT_BYTES)} MB.`,
    };
  }
  return { ok: true };
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");
}
