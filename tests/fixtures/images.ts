/**
 * Hand-built image containers for the metadata tests.
 *
 * Not decodable photographs — the stripper never decodes — but byte-exact
 * containers: every segment and chunk the stripper walks is where a real file
 * would put it, with a location string planted in the ones it must remove.
 * Shared by the unit test of the stripper and the integration test of the
 * review service, which uploads one to a fake bucket.
 */

const latin1 = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  const length = payload.length + 2;
  return concat([Uint8Array.of(0xff, marker, length >> 8, length & 0xff), payload]);
}

export function jpegWithExif(options: { width: number; height: number; exif: string | null }): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.of(0xff, 0xd8)];
  parts.push(jpegSegment(0xe0, latin1("JFIF\0\x01\x01\0\0\x01\0\x01\0\0")));
  if (options.exif) {
    parts.push(jpegSegment(0xe1, latin1(`Exif\0\0${options.exif}`)));
    parts.push(jpegSegment(0xed, latin1(`Photoshop 3.0\0${options.exif}`)));
  }
  parts.push(jpegSegment(0xe2, latin1("ICC_PROFILE\0\x01\x01profile")));
  if (options.exif) parts.push(jpegSegment(0xfe, latin1(`Shot at ${options.exif}`)));
  parts.push(
    jpegSegment(
      0xc0,
      Uint8Array.of(8, options.height >> 8, options.height & 0xff, options.width >> 8, options.width & 0xff, 1, 1, 0x11, 0),
    ),
  );
  parts.push(jpegSegment(0xda, Uint8Array.of(1, 1, 0, 0, 0x3f, 0)));
  parts.push(latin1("SCANDATA"), Uint8Array.of(0xff, 0x00, 0x12), Uint8Array.of(0xff, 0xd9));
  return concat(parts);
}

function u32be(value: number): Uint8Array {
  return Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  // The CRC is not checked by the stripper; four bytes stand in for it.
  return concat([u32be(data.length), latin1(type), data, u32be(0)]);
}

export function pngWithText(options: { width: number; height: number; text: string }): Uint8Array {
  return concat([
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    pngChunk("IHDR", concat([u32be(options.width), u32be(options.height), Uint8Array.of(8, 2, 0, 0, 0)])),
    pngChunk("tEXt", latin1(`Comment\0${options.text}`)),
    pngChunk("eXIf", latin1(options.text)),
    pngChunk("IDAT", latin1("pixels")),
    pngChunk("tIME", Uint8Array.of(7, 234, 9, 15, 10, 0, 0)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

function u32le(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function u24le(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff);
}

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const pad = data.length % 2 === 1 ? Uint8Array.of(0) : new Uint8Array(0);
  return concat([latin1(fourcc), u32le(data.length), data, pad]);
}

export function webpWithExif(options: { width: number; height: number; exif: string }): Uint8Array {
  const vp8x = concat([Uint8Array.of(0x0c, 0, 0, 0), u24le(options.width - 1), u24le(options.height - 1)]);
  const body = concat([
    latin1("WEBP"),
    riffChunk("VP8X", vp8x),
    riffChunk("VP8 ", latin1("lossy-frame")),
    riffChunk("EXIF", latin1(options.exif)),
    riffChunk("XMP ", latin1(`<x:xmpmeta>${options.exif}</x:xmpmeta>`)),
  ]);
  return concat([latin1("RIFF"), u32le(body.length), body]);
}
