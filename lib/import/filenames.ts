/**
 * Matching a filename in a spreadsheet to a file in the media library.
 *
 * Board 11d §3: *"Photo matching is by filename against `3i`, which means it
 * inherits that library's naming rules and its reference model."* The render
 * shows `405 of 412 filenames are in your media library`.
 *
 * ## Why this is not string equality
 *
 * The library does not store the name the seller's computer had. `safeName` in
 * `lib/storage/buckets.ts` lowercases the name, replaces every run of
 * punctuation with a hyphen, truncates to eighty characters and **appends six
 * random ones**:
 *
 *     BF-100 (1).JPG  ->  bf-100-1-x7k2m9.jpg
 *
 * That suffix is deliberate and correct — two uploads called `photo.jpg` are
 * the normal case, and the second silently replacing the first is the kind of
 * thing a seller finds out about weeks later. But it means comparing a CSV cell
 * against `basename(storage_path)` matches **nothing, ever**, and reports it as
 * `0 of 412 filenames are in your media library`: a true sentence answering a
 * question nobody asked.
 *
 * So board 11d adds `Media.filename`, which `Document` has carried since
 * handoff 1, and this module reconciles the two forms — the real name for
 * anything uploaded since, and the suffixed name for everything before.
 *
 * ## The rule
 *
 * Two tiers, and the second exists because a stock file's photo column is typed
 * by a person:
 *
 *   1. **The whole name**, normalised. `BF-100 (1).JPG` matches `bf-100-1.jpg`.
 *   2. **The stem**, when the whole name does not match. A seller writes
 *      `AW-BF-100` in a column headed `Photo File` and means `aw-bf-100.jpg`;
 *      requiring the extension would refuse the match and the product would
 *      import photoless for a reason the seller cannot see.
 *
 * And one refusal. A key resolving to **more than one file** is not matched:
 * `safeName` exists because duplicate names are normal, so "the one called
 * `photo.jpg`" is a question the library genuinely cannot answer. Attaching
 * whichever row came back first would be a coin toss written into forty
 * products. It reports as ambiguous, which is a different sentence from
 * unmatched and leads somewhere different.
 */

/** Everything this module needs to know about a file in the library. */
export interface LibraryFile {
  id: string;
  /** The name as uploaded. Null for rows that predate `Media.filename`. */
  filename: string | null;
  storagePath: string;
}

export type FilenameMatch =
  | { kind: "matched"; id: string }
  | { kind: "ambiguous"; count: number }
  | { kind: "unmatched" };

/**
 * The same normalisation `safeName` applies, minus the random suffix and the
 * truncation.
 *
 * Kept deliberately close to that function: the two have to agree about what
 * counts as the same name, and they are the only two places in the codebase
 * that decide it. A change to one is a change to both.
 */
export function normaliseFilename(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    // A spreadsheet cell often holds a path — `C:\photos\bf-100.jpg` or
    // `images/bf-100.jpg`. The library has no folders in its storage paths that
    // the seller ever sees, so only the last segment can mean anything.
    .split("/")
    .pop()!
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `bf-100.jpg` -> `bf-100`. A name with no extension is its own stem. */
export function stemOf(normalised: string): string {
  return normalised.replace(/\.[a-z0-9]+$/, "") || normalised;
}

/**
 * The stem with `safeName`'s random suffix removed, when there is one to remove.
 *
 * `Math.random().toString(36).slice(2, 8)` is usually six characters and
 * occasionally fewer, so the pattern is a range rather than a fixed length —
 * and it is only ever applied to a name **derived from a storage path**, never
 * to one the seller typed. Applying it to a real filename would quietly turn
 * `valve-dn100.jpg` into `valve`, and match the wrong file with confidence.
 */
export function stripUploadSuffix(stem: string): string {
  const stripped = stem.replace(/-[a-z0-9]{4,6}$/, "");
  // A name that is *only* a suffix has nothing left to match on.
  return stripped === "" ? stem : stripped;
}

const basename = (path: string): string => path.split("/").pop() ?? path;

/**
 * Every key one library file can legitimately answer to.
 *
 * The real filename first, because it is what the seller typed. The storage
 * basename after it, with the suffix stripped, which is the best available
 * answer for a file uploaded before `Media.filename` existed.
 */
export function keysFor(file: LibraryFile): string[] {
  const keys = new Set<string>();

  if (file.filename && file.filename.trim() !== "") {
    const normalised = normaliseFilename(file.filename);
    if (normalised !== "") {
      keys.add(normalised);
      keys.add(stemOf(normalised));
    }
  }

  const stored = normaliseFilename(basename(file.storagePath));
  if (stored !== "") {
    keys.add(stored);
    const stem = stemOf(stored);
    keys.add(stem);
    keys.add(stripUploadSuffix(stem));
  }

  return [...keys].filter((key) => key !== "");
}

/**
 * An index from every key to the files answering to it.
 *
 * Built once per import rather than per row: a 412-row file with one photo
 * column is 412 lookups, and a query each would be 412 round trips to answer a
 * question the library could answer once.
 */
export class FilenameIndex {
  private readonly byKey = new Map<string, string[]>();

  constructor(files: readonly LibraryFile[]) {
    for (const file of files) {
      for (const key of keysFor(file)) {
        const ids = this.byKey.get(key);
        if (ids) {
          // A file can produce the same key twice — `photo.jpg` uploaded as
          // `photo.jpg` has the same value for name and stripped path. That is
          // one file, not two candidates.
          if (!ids.includes(file.id)) ids.push(file.id);
        } else {
          this.byKey.set(key, [file.id]);
        }
      }
    }
  }

  /** What one cell in the photo column resolves to. */
  match(raw: string): FilenameMatch {
    const value = raw.trim();
    if (value === "") return { kind: "unmatched" };

    const normalised = normaliseFilename(value);
    if (normalised === "") return { kind: "unmatched" };

    for (const key of [normalised, stemOf(normalised)]) {
      const ids = this.byKey.get(key);
      if (!ids || ids.length === 0) continue;
      if (ids.length > 1) return { kind: "ambiguous", count: ids.length };
      return { kind: "matched", id: ids[0]! };
    }

    return { kind: "unmatched" };
  }
}

/**
 * A cell holding several filenames.
 *
 * `photo_1…photo_6` come back from the export as one column each, but a stock
 * file a seller keeps by hand puts them in one cell separated by whatever was
 * to hand. Splitting on comma, semicolon and pipe covers it; a space is not a
 * separator, because `IMG 1234.jpg` is one filename.
 */
export function splitFilenames(cell: string): string[] {
  return cell
    .split(/[,;|]/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}
