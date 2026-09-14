import "server-only";
import { stripImageMetadata } from "@/lib/images/strip-metadata";
import {
  MAX_IMAGE_BYTES,
  MEDIA_BUCKET,
  publicUrl,
  readObject,
  removeObject,
  replaceObject,
  signUpload,
  type SignedUpload,
} from "@/lib/storage";
import { REVIEW_PHOTO_MIN_EDGE, type ReviewPhotoRef } from "./write";

/**
 * Board 10f `B6` — a review photograph between the signed upload and the review.
 *
 * The browser shrinks and re-encodes, then writes straight to storage with a
 * signed URL. Nothing about that write is bound by what the form claimed, so
 * the server reads the object back and decides: a JPEG, PNG or WebP by its
 * bytes rather than its name, under the media bucket's megabyte, above the
 * review floor, with its metadata removed and written back in place. Anything
 * else is deleted rather than left at an unguessable public address.
 *
 * Run once when the photo is added (so the draft only ever lists clean files)
 * and again on post, because a draft is JSON a browser shaped and a path in it
 * is a claim, not a record.
 */

/** Storage, behind the four calls this needs, so an integration test can stand in for Supabase. */
export interface ReviewPhotoStorage {
  sign(path: string): Promise<SignedUpload>;
  read(path: string): Promise<Uint8Array | null>;
  replace(path: string, bytes: Uint8Array, type: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  url(path: string): string;
}

export const reviewPhotoStorage: ReviewPhotoStorage = {
  sign: (path) => signUpload(MEDIA_BUCKET, path),
  read: (path) => readObject(MEDIA_BUCKET, path),
  replace: async (path, bytes, type) => (await replaceObject(MEDIA_BUCKET, path, bytes, type)).ok,
  remove: (path) => removeObject(MEDIA_BUCKET, path),
  url: (path) => publicUrl(MEDIA_BUCKET, path),
};

export type PhotoRefusal = "missing" | "type" | "size" | "too_small" | "storage";

export async function cleanReviewPhoto(
  storage: ReviewPhotoStorage,
  path: string,
): Promise<{ ok: true; photo: ReviewPhotoRef } | { ok: false; error: PhotoRefusal }> {
  const bytes = await storage.read(path);
  if (!bytes) return { ok: false, error: "missing" };

  const refuse = async (error: PhotoRefusal) => {
    await storage.remove(path);
    return { ok: false as const, error };
  };

  const stripped = stripImageMetadata(bytes);
  if (!stripped) return refuse("type");
  if (stripped.bytes.length > MAX_IMAGE_BYTES) return refuse("size");
  const longEdge = Math.max(stripped.width ?? 0, stripped.height ?? 0);
  if (longEdge > 0 && longEdge < REVIEW_PHOTO_MIN_EDGE) return refuse("too_small");

  if (stripped.removed.length > 0) {
    const written = await storage.replace(path, stripped.bytes, stripped.type);
    // A file we could not clean is not a file we attach. Removed, so the
    // metadata is not left sitting at a public address either.
    if (!written) return refuse("storage");
  }

  return {
    ok: true,
    photo: { path, width: stripped.width, height: stripped.height, bytes: stripped.bytes.length },
  };
}
