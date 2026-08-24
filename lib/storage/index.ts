import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DOCUMENT_BUCKET,
  MEDIA_BUCKET,
  PRIVATE_BUCKETS,
  PUBLIC_BUCKETS,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
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

export async function removeObject(bucket: string, path: string): Promise<void> {
  const admin = createAdminClient();
  await admin.storage.from(bucket).remove([path]);
}

/**
 * Create the buckets if they are not there.
 *
 * Idempotent, and deliberately not a migration: `storage.*` belongs to Supabase,
 * and CI runs a plain Postgres with no storage schema at all — a migration
 * touching it would fail every build for a feature CI cannot exercise anyway.
 * `pnpm storage:setup` runs this against a real project.
 */
export async function ensureBuckets(): Promise<{ created: string[]; existing: string[] }> {
  const admin = createAdminClient();
  const { data: existing } = await admin.storage.listBuckets();
  const have = new Set((existing ?? []).map((b) => b.name));

  const created: string[] = [];
  for (const name of PUBLIC_BUCKETS) {
    if (have.has(name)) continue;
    await admin.storage.createBucket(name, {
      public: true,
      fileSizeLimit: MAX_IMAGE_BYTES,
      allowedMimeTypes: [...IMAGE_TYPES],
    });
    created.push(name);
  }
  for (const name of PRIVATE_BUCKETS) {
    if (have.has(name)) continue;
    await admin.storage.createBucket(name, {
      public: false,
      fileSizeLimit: MAX_DOCUMENT_BYTES,
      allowedMimeTypes: [...DOCUMENT_TYPES],
    });
    created.push(name);
  }

  return { created, existing: [...have].filter((n) => n === MEDIA_BUCKET || n === DOCUMENT_BUCKET) };
}
