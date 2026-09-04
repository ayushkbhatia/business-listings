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
    ...PRIVATE_BUCKETS.map((name) => ({
      name,
      options: {
        public: false,
        fileSizeLimit: MAX_DOCUMENT_BYTES,
        allowedMimeTypes: [...DOCUMENT_TYPES],
      },
    })),
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
