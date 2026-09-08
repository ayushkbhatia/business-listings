import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DOCUMENT_BUCKET,
  INVOICE_BUCKET,
  MEDIA_BUCKET,
  PUBLIC_BUCKETS,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_INVOICE_BYTES,
  DOCUMENT_TYPES,
  IMAGE_TYPES,
} from "./buckets";

export * from "./buckets";

/**
 * Supabase Storage, behind three functions.
 *
 * The browser uploads directly to Storage with a signed URL rather than posting
 * bytes through a server action. An eight-megabyte photograph through a Next
 * action is eight megabytes of request body, base64-encoded, held in memory —
 * and a supplier uploading twenty of them would be doing that twenty times.
 *
 * The signature is what carries the permission. It is issued per object, by a
 * server that has already checked the seller owns the business the path is
 * under, and it expires. There is no bucket-wide write policy to get wrong.
 */

export interface SignedUpload {
  path: string;
  token: string;
  /** POST the bytes here. */
  url: string;
}

export async function signUpload(bucket: string, path: string): Promise<SignedUpload> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data) throw error ?? new Error(`could not sign an upload for ${path}`);
  return { path: data.path, token: data.token, url: data.signedUrl };
}

/** The URL a storefront renders. Only ever called for a public bucket. */
export function publicUrl(bucket: string, path: string): string {
  const admin = createAdminClient();
  return admin.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/**
 * A link to a private document, good for a few minutes.
 *
 * Documents hold trade licences. A link that does not expire is a published
 * licence with an unguessable address, which is not the same as a private one.
 */
export async function signedReadUrl(path: string, seconds = 300): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin.storage.from(DOCUMENT_BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

/**
 * Store one invoice PDF, at issue. Board 11g.
 *
 * `upsert: false`. An invoice's PDF is written **once** and the whole point of
 * storing it is that a later template cannot replace it — a regenerated file is
 * a different document from the one the seller filed with their accountant, even
 * when every figure matches. A second write is a bug, and it should fail rather
 * than overwrite the evidence.
 *
 * Reports the failure rather than throwing. The invoice itself has already been
 * written and the money has already moved; losing the whole transaction because
 * object storage was briefly unavailable would be the worse outcome. The screen
 * reads a null `pdfPath` and says the document is not available for download
 * rather than offering to invent one.
 *
 * ## The reason comes back, and it used to only be logged
 *
 * This warned to the console and returned null. On a screen that is honest — a
 * seller sees "not available" rather than a broken download — and in production
 * it is invisible: a `console.warn` in a serverless function reaches nobody, so
 * an invoice raised by the nightly renewal job with no PDF behind it was a
 * failure with no reader. The reason now travels back to the caller, which puts
 * it in the daily job's step report; `writeMissingInvoicePdfs` retries on the
 * next run.
 */
export type PutResult = { ok: true; path: string } | { ok: false; reason: string };

export async function putInvoicePdf(path: string, bytes: Buffer): Promise<PutResult> {
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(INVOICE_BUCKET)
    .upload(path, bytes, { contentType: "application/pdf", upsert: false });

  if (error) {
    // `error`, not `warn`: an invoice with no document behind it is a thing
    // somebody has to act on, and log levels are how that gets noticed.
    console.error(`[storage] could not store the invoice PDF at ${path}: ${error.message}`);
    return { ok: false, reason: error.message };
  }
  return { ok: true, path };
}

/** The stored bytes, read back for the download. Null when it is not there. */
export async function readInvoicePdf(path: string): Promise<Buffer | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(INVOICE_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export async function removeObject(bucket: string, path: string): Promise<void> {
  const admin = createAdminClient();
  await admin.storage.from(bucket).remove([path]);
}

/**
 * Create the buckets, and reconcile the ones that are already there.
 *
 * Idempotent, and deliberately not a migration: `storage.*` belongs to Supabase,
 * and CI runs a plain Postgres with no storage schema at all — a migration
 * touching it would fail every build for a feature CI cannot exercise anyway.
 * `pnpm storage:setup` runs this against a real project.
 *
 * ## Why it updates rather than skipping
 *
 * It used to `continue` past any bucket that existed, which made it a
 * create-once script wearing the name of a reconciler. Board 8b dropped
 * `MAX_IMAGE_BYTES` from 8 MB to 1 MB and the code obeyed it immediately — but
 * every environment whose bucket already existed kept the old ceiling, so the
 * limit the product enforced and the limit the storage layer enforced were
 * different numbers, and the one that actually stops a write was the stale one.
 *
 * A limit that only applies to environments created after the change is not a
 * limit. `updateBucket` is the same call shape and makes the script mean what
 * its name says.
 */
export async function ensureBuckets(): Promise<{
  created: string[];
  updated: string[];
  existing: string[];
}> {
  const admin = createAdminClient();
  const { data: existing } = await admin.storage.listBuckets();
  const have = new Set((existing ?? []).map((b) => b.name));

  const created: string[] = [];
  const updated: string[] = [];

  const settings = [
    ...PUBLIC_BUCKETS.map((name) => ({
      name,
      options: {
        public: true,
        fileSizeLimit: MAX_IMAGE_BYTES,
        allowedMimeTypes: [...IMAGE_TYPES],
      },
    })),
    {
      name: DOCUMENT_BUCKET,
      options: {
        public: false,
        fileSizeLimit: MAX_DOCUMENT_BYTES,
        allowedMimeTypes: [...DOCUMENT_TYPES],
      },
    },
    /*
       The invoice bucket is narrower than the document one on both axes.

       Only PDFs, because nothing but this writer ever puts anything in it — a
       bucket that would accept a JPEG is a bucket somebody can put a JPEG in.
       And a megabyte, because a one-page A4 invoice with no embedded fonts is
       tens of kilobytes; sixteen megabytes here would be a ceiling on nothing.
    */
    {
      name: INVOICE_BUCKET,
      options: {
        public: false,
        fileSizeLimit: MAX_INVOICE_BYTES,
        allowedMimeTypes: ["application/pdf"],
      },
    },
  ];

  for (const { name, options } of settings) {
    if (have.has(name)) {
      const { error } = await admin.storage.updateBucket(name, options);
      // Reported rather than thrown: a project whose key cannot update buckets
      // should still be told which limit is now wrong, not handed a stack trace.
      if (error) console.warn(`[storage] could not reconcile ${name}: ${error.message}`);
      else updated.push(name);
      continue;
    }
    await admin.storage.createBucket(name, options);
    created.push(name);
  }

  return {
    created,
    updated,
    existing: [...have].filter((n) => n === MEDIA_BUCKET || n === DOCUMENT_BUCKET),
  };
}
