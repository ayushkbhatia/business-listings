/**
 * Get a phone photograph under a megabyte, in the browser, before it is sent.
 *
 * ## Why this exists at all
 *
 * A photograph off any current phone is two to eight megabytes. The seller this
 * screen is written for is standing in their warehouse holding that phone, and
 * board 8b says so out loud — "a phone camera is fine". So a one-megabyte rule
 * cannot be a refusal: refusing every real photograph would leave the task
 * completable only by somebody who owns image-editing software, which is the
 * opposite of who it is for.
 *
 * The rule is therefore about what we *store*, not about what they *choose*.
 * The browser decodes the file it was given, draws it smaller, and re-encodes
 * until it fits. The seller picks a photograph and it works.
 *
 * ## Why the browser and not the server
 *
 * Bandwidth, and it is not a small difference here. Uploading eight megabytes
 * over a UAE mobile connection to have the server throw seven of them away is
 * the slowest possible version of this, on the connection least able to afford
 * it. Resizing first means the bytes that leave the phone are the bytes we
 * keep.
 *
 * It also needs no dependency. `sharp` would be a native module, a build
 * concern on Vercel, and a server-side processing step on a path that today has
 * none — `lib/storage/` never opens the bytes at all. Canvas is already in
 * every browser this product supports.
 *
 * ## What this deliberately does not do
 *
 * No blur detection, no luminance check, no perceptual hash, no derivative
 * ladder. Board 8b §4 specifies all four; they are cut from this phase, and the
 * amber "Blurry and dark — replace it?" tile in the render goes with them.
 * Measuring image quality and telling a seller their photograph is bad is a
 * feature that has to earn its place with real thresholds calibrated against
 * real UAE warehouse photographs — §8 says exactly that — and a wrong one nags
 * somebody about a picture they chose. `slotKey` copy is the honest half and it
 * stays.
 *
 * Dimensions are measured, because the decode has already happened and the
 * numbers are free. That is metadata, not judgement.
 */

/** The ceiling this module exists to hold. Board 8b, and the bucket agrees. */
export const MAX_STORED_BYTES = 1024 * 1024;

/**
 * The longest edge we keep.
 *
 * A storefront hero is 1440 wide at the largest, and a search result thumbnail
 * is a couple of hundred. Sixteen hundred leaves room to crop and to serve a
 * retina cover without keeping a twelve-megapixel original nobody renders.
 */
export const MAX_EDGE = 1600;

/**
 * The floor board 8b §2 sets, enforced rather than described.
 *
 * A photograph smaller than this on its long edge is a thumbnail or a logo
 * somebody has dragged into the wrong place. It is the one hard reject, and it
 * is a reject rather than an upscale because there is nothing to recover.
 */
export const MIN_EDGE = 800;

/** What we ask the canvas for, worst first, until one fits. */
const QUALITY_LADDER = [0.82, 0.72, 0.62, 0.5] as const;

export type DownscaleRefusal =
  /** The browser could not decode it. HEIC on Chrome lands here. */
  | "unreadable"
  /** Long edge under MIN_EDGE. The only hard reject. */
  | "too_small"
  /** Every quality step still exceeded the ceiling. Vanishingly rare. */
  | "too_large";

export interface DownscaledImage {
  blob: Blob;
  /** `image/webp`, or `image/jpeg` where the browser will not encode WebP. */
  type: string;
  width: number;
  height: number;
  bytes: number;
}

export type DownscaleResult =
  | { ok: true; image: DownscaledImage }
  | { ok: false; error: DownscaleRefusal; longEdge?: number };

/**
 * Decode, measure, shrink, re-encode.
 *
 * `createImageBitmap` rather than an `<img>` and an object URL: it decodes off
 * the main thread, it does not need the element to be in the document, and it
 * is the one path that reliably reports the *decoded* dimensions rather than
 * the laid-out ones. It also respects EXIF orientation on every browser that
 * supports the option, which an `<img>` in a canvas famously does not — a
 * portrait warehouse photograph arriving on its side is the classic version of
 * this bug.
 */
export async function downscaleImage(file: File | Blob): Promise<DownscaleResult> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, error: "unreadable" };
  }

  try {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (longEdge < MIN_EDGE) return { ok: false, error: "too_small", longEdge };

    /*
       Never upscale. A photograph between the floor and the ceiling is already
       the size we want, and redrawing it at 1:1 would still cost it a
       generation of re-encoding for nothing.
    */
    const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return { ok: false, error: "unreadable" };
    context.drawImage(bitmap, 0, 0, width, height);

    /*
       WebP where the browser has it, JPEG where it does not.

       `toBlob` does not throw on an unsupported type — it silently hands back
       PNG, which for a photograph is larger than the original and would fail
       the ceiling for a reason that looks like the seller's fault. So the type
       that comes back is read rather than assumed.
    */
    for (const quality of QUALITY_LADDER) {
      const blob = await encode(canvas, "image/webp", quality);
      if (blob && blob.size <= MAX_STORED_BYTES) {
        return { ok: true, image: { blob, type: blob.type, width, height, bytes: blob.size } };
      }
      const fallback = blob?.type === "image/webp" ? null : blob;
      if (fallback && fallback.size <= MAX_STORED_BYTES) {
        return {
          ok: true,
          image: { blob: fallback, type: fallback.type, width, height, bytes: fallback.size },
        };
      }
    }

    return { ok: false, error: "too_large" };
  } finally {
    // Frees the decoded bitmap rather than waiting for the collector. A seller
    // adding five twelve-megapixel photographs holds five of these otherwise.
    bitmap.close();
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/**
 * The extension the stored object should carry.
 *
 * The name the seller's phone gave the file is kept for the grid — board 8b
 * shows `IMG_4471.jpg` as the label on an unslotted photograph — but the bytes
 * are no longer a JPEG once they have been through the canvas, and an object
 * whose extension disagrees with its content type is a cache header waiting to
 * be wrong.
 */
export function storedName(filename: string, type: string): string {
  const extension = type === "image/webp" ? "webp" : type === "image/png" ? "png" : "jpg";
  const stem = filename.replace(/\.[^.]+$/, "") || "photo";
  return `${stem}.${extension}`;
}
