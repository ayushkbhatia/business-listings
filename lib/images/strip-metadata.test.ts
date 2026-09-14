import { describe, expect, it } from "vitest";
import { sniffImageType, stripImageMetadata } from "./strip-metadata";
import { jpegWithExif, pngWithText, webpWithExif } from "@/tests/fixtures/images";

/**
 * Board 10f `B6` — the metadata comes out and the picture does not change.
 *
 * Each format is built by hand with a location-bearing segment in it, run
 * through the stripper, and read back: the segment is gone, every other byte
 * that makes the image is still there in order, and the size is measured.
 */

const GPS = "GPSLatitude 25.0772 N";

function contains(bytes: Uint8Array, text: string): boolean {
  return Buffer.from(bytes).includes(Buffer.from(text, "latin1"));
}

describe("JPEG", () => {
  it("removes EXIF, XMP-bearing APP1, IPTC and comments, and keeps JFIF, ICC and the scan", () => {
    const input = jpegWithExif({ width: 800, height: 600, exif: GPS });
    expect(contains(input, GPS)).toBe(true);

    const result = stripImageMetadata(input)!;
    expect(result.type).toBe("image/jpeg");
    expect(result.removed).toEqual(["APP1", "APP13", "COM"]);
    expect(contains(result.bytes, GPS)).toBe(false);
    expect(contains(result.bytes, "JFIF")).toBe(true);
    expect(contains(result.bytes, "ICC_PROFILE")).toBe(true);
    expect(contains(result.bytes, "SCANDATA")).toBe(true);
    expect([result.width, result.height]).toEqual([800, 600]);
    // Ends where a JPEG ends.
    expect([...result.bytes.slice(-2)]).toEqual([0xff, 0xd9]);
  });

  it("leaves a clean file byte for byte", () => {
    const clean = stripImageMetadata(jpegWithExif({ width: 400, height: 900, exif: null }))!;
    const again = stripImageMetadata(clean.bytes)!;
    expect(again.removed).toEqual([]);
    expect(Buffer.from(again.bytes).equals(Buffer.from(clean.bytes))).toBe(true);
  });

  it("refuses a truncated segment rather than guessing", () => {
    const input = jpegWithExif({ width: 800, height: 600, exif: GPS });
    expect(stripImageMetadata(input.slice(0, 30))).toBeNull();
  });
});

describe("PNG", () => {
  it("removes text, eXIf and time chunks and reads the size from IHDR", () => {
    const input = pngWithText({ width: 1200, height: 700, text: GPS });
    const result = stripImageMetadata(input)!;
    expect(result.type).toBe("image/png");
    expect(result.removed).toEqual(["tEXt", "eXIf", "tIME"]);
    expect(contains(result.bytes, GPS)).toBe(false);
    expect(contains(result.bytes, "IDAT")).toBe(true);
    expect([result.width, result.height]).toEqual([1200, 700]);
  });
});

describe("WebP", () => {
  it("removes EXIF and XMP chunks, clears their flags and fixes the RIFF size", () => {
    const input = webpWithExif({ width: 1600, height: 1200, exif: GPS });
    const result = stripImageMetadata(input)!;
    expect(result.type).toBe("image/webp");
    expect(result.removed).toEqual(["EXIF", "XMP"]);
    expect(contains(result.bytes, GPS)).toBe(false);
    expect([result.width, result.height]).toEqual([1600, 1200]);
    const flags = result.bytes[20]!;
    expect(flags & 0x0c).toBe(0);
    const riffSize = Buffer.from(result.bytes).readUInt32LE(4);
    expect(riffSize).toBe(result.bytes.length - 8);
  });
});

describe("anything else", () => {
  it("is not an image this accepts", () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 not a photo at all");
    expect(sniffImageType(pdf)).toBeNull();
    expect(stripImageMetadata(pdf)).toBeNull();
  });
});
