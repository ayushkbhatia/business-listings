/**
 * Take the metadata out of a stored photograph, on the server. Board 10f `B6`.
 *
 * A phone photograph carries where it was taken, to a few metres, and when, and
 * on what device. A buyer photographing a delivery at their own site and
 * posting it on a public review page has published their site's coordinates
 * unless something removes them — and the buyer is the last person who would
 * think to.
 *
 * The browser already re-encodes every photo through a canvas
 * (`lib/images/downscale.ts`), which drops EXIF as a side effect. That is not a
 * guarantee: a signed upload URL accepts whatever bytes are sent to it. So the
 * server reads back what storage holds and removes the metadata segments
 * itself, before the file is attached to anything.
 *
 * ## Why bytes, not a decoder
 *
 * No `sharp`, for the reason `downscale.ts` gives — a native module on Vercel
 * for a path that never needed one — and a second reason: re-encoding here
 * would cost the photo another generation of compression to remove a few
 * kilobytes of tags. The three container formats a canvas can produce keep
 * metadata in named segments, and removing a segment leaves the pixels
 * byte-identical.
 *
 * What goes, per format:
 *
 * - **JPEG** — APP1 (EXIF, XMP), APP3–APP13 (APP13 is IPTC/Photoshop), APP15,
 *   and comments. APP0 (JFIF), APP2 (the ICC colour profile) and APP14 (Adobe's
 *   colour transform flag) stay, because removing them changes how the pixels
 *   render and they say nothing about a person or a place.
 * - **PNG** — `eXIf`, `tEXt`, `zTXt`, `iTXt`, `tIME`.
 * - **WebP** — the `EXIF` and `XMP ` chunks, with their flags cleared in `VP8X`.
 *
 * Orientation lives in EXIF, so a file that arrives here un-rotated with an
 * orientation tag loses the tag. The browser applied it when it drew the photo
 * (`imageOrientation: "from-image"`), so this only affects a file that skipped
 * the canvas — which is a file the buyer's own form did not produce.
 *
 * Pure. A test builds each format by hand and reads the result back.
 */

export type StrippableType = "image/jpeg" | "image/png" | "image/webp";

export interface StripResult {
  type: StrippableType;
  bytes: Uint8Array;
  /** Segment names removed, for the log. Empty when the file was already clean. */
  removed: string[];
  width: number | null;
  height: number | null;
}

/** Null when the bytes are not a well-formed JPEG, PNG or WebP. */
export function stripImageMetadata(input: Uint8Array): StripResult | null {
  if (isJpeg(input)) return stripJpeg(input);
  if (isPng(input)) return stripPng(input);
  if (isWebp(input)) return stripWebp(input);
  return null;
}

export function sniffImageType(input: Uint8Array): StrippableType | null {
  if (isJpeg(input)) return "image/jpeg";
  if (isPng(input)) return "image/png";
  if (isWebp(input)) return "image/webp";
  return null;
}

/* ── JPEG ──────────────────────────────────────────────────────────────────── */

function isJpeg(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/** Markers with no length field. */
function standalone(marker: number): boolean {
  return marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

function strippedJpegMarker(marker: number): string | null {
  if (marker === 0xe1) return "APP1";
  if (marker >= 0xe3 && marker <= 0xed) return `APP${marker - 0xe0}`;
  if (marker === 0xef) return "APP15";
  if (marker === 0xfe) return "COM";
  return null;
}

function stripJpeg(b: Uint8Array): StripResult | null {
  const out: Uint8Array[] = [b.subarray(0, 2)];
  const removed: string[] = [];
  let width: number | null = null;
  let height: number | null = null;
  let i = 2;

  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    // Fill bytes: any number of 0xFF may precede a marker.
    let j = i;
    while (j < b.length && b[j] === 0xff) j += 1;
    if (j >= b.length) return null;
    const marker = b[j]!;
    const markerStart = j - 1;

    if (standalone(marker)) {
      out.push(b.subarray(markerStart, j + 1));
      i = j + 1;
      continue;
    }
    if (marker === 0xd9) {
      out.push(b.subarray(markerStart));
      break;
    }
    if (j + 2 >= b.length) return null;
    const length = (b[j + 1]! << 8) | b[j + 2]!;
    if (length < 2) return null;
    const end = j + 1 + length;
    if (end > b.length) return null;

    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc && length >= 7) {
      height = (b[j + 4]! << 8) | b[j + 5]!;
      width = (b[j + 6]! << 8) | b[j + 7]!;
    }

    const name = strippedJpegMarker(marker);
    if (name) {
      removed.push(name);
    } else {
      out.push(b.subarray(markerStart, end));
    }

    if (marker === 0xda) {
      // Start of scan: the entropy-coded data runs to the end, and nothing
      // after it is a header segment a writer would put metadata in.
      out.push(b.subarray(end));
      break;
    }
    i = end;
  }

  return { type: "image/jpeg", bytes: concat(out), removed, width, height };
}

/* ── PNG ───────────────────────────────────────────────────────────────────── */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_STRIPPED = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function isPng(b: Uint8Array): boolean {
  return b.length > 8 && PNG_SIGNATURE.every((byte, index) => b[index] === byte);
}

function stripPng(b: Uint8Array): StripResult | null {
  const out: Uint8Array[] = [b.subarray(0, 8)];
  const removed: string[] = [];
  let width: number | null = null;
  let height: number | null = null;
  let i = 8;

  while (i < b.length) {
    if (i + 12 > b.length) return null;
    const length = readU32BE(b, i);
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + length;
    if (end > b.length) return null;

    if (type === "IHDR" && length >= 8) {
      width = readU32BE(b, i + 8);
      height = readU32BE(b, i + 12);
    }
    if (PNG_STRIPPED.has(type)) removed.push(type);
    else out.push(b.subarray(i, end));

    i = end;
    if (type === "IEND") break;
  }

  return { type: "image/png", bytes: concat(out), removed, width, height };
}

/* ── WebP ──────────────────────────────────────────────────────────────────── */

function isWebp(b: Uint8Array): boolean {
  return b.length > 16 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP";
}

const VP8X_EXIF = 0x08;
const VP8X_XMP = 0x04;

function stripWebp(b: Uint8Array): StripResult | null {
  const chunks: Uint8Array[] = [];
  const removed: string[] = [];
  let width: number | null = null;
  let height: number | null = null;
  let i = 12;

  while (i < b.length) {
    if (i + 8 > b.length) return null;
    const fourcc = ascii(b, i, 4);
    const size = readU32LE(b, i + 4);
    const padded = size + (size % 2);
    const end = i + 8 + padded;
    if (i + 8 + size > b.length) return null;
    const chunk = b.subarray(i, Math.min(end, b.length));

    if (fourcc === "EXIF" || fourcc === "XMP ") {
      removed.push(fourcc.trim());
    } else if (fourcc === "VP8X" && size >= 10) {
      const copy = new Uint8Array(chunk);
      copy[8] = copy[8]! & ~(VP8X_EXIF | VP8X_XMP);
      width = 1 + (copy[12]! | (copy[13]! << 8) | (copy[14]! << 16));
      height = 1 + (copy[15]! | (copy[16]! << 8) | (copy[17]! << 16));
      chunks.push(copy);
    } else {
      if (width === null && fourcc === "VP8 " && size >= 10) {
        width = (b[i + 14]! | (b[i + 15]! << 8)) & 0x3fff;
        height = (b[i + 16]! | (b[i + 17]! << 8)) & 0x3fff;
      } else if (width === null && fourcc === "VP8L" && size >= 5) {
        const bits = readU32LE(b, i + 9);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      }
      chunks.push(chunk);
    }
    i = end;
  }

  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(b.subarray(0, 4), 0);
  writeU32LE(header, 4, body.length + 4);
  header.set(b.subarray(8, 12), 8);
  return { type: "image/webp", bytes: concat([header, body]), removed, width, height };
}

/* ── bytes ─────────────────────────────────────────────────────────────────── */

function readU32BE(b: Uint8Array, at: number): number {
  return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
}

function readU32LE(b: Uint8Array, at: number): number {
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
}

function writeU32LE(b: Uint8Array, at: number, value: number): void {
  b[at] = value & 0xff;
  b[at + 1] = (value >>> 8) & 0xff;
  b[at + 2] = (value >>> 16) & 0xff;
  b[at + 3] = (value >>> 24) & 0xff;
}

function ascii(b: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...b.subarray(at, at + length));
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
