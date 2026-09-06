import "server-only";
import { prisma } from "@/lib/db/client";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { allowance, type Allowance, type PlanCaps } from "@/lib/plan/entitlements";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";
import { referencesFor } from "./references";
import { badgesFor, needsAlt, stateOf, type BadgeKind, type Reference } from "./state";

/**
 * Board 3i's reads. Every count on the board was hardcoded, including the 41
 * and the 380 MB, and the reference query is the one the spec singles out as
 * "the difference between a delete button and a broken customer document".
 *
 * ## Two tables, one library
 *
 * `Media` holds images and `Document` holds PDFs, and they are genuinely
 * different rows: a document is served through a signed URL from a private
 * bucket and an image is public. The seller has one library, so the ids the
 * screen deals in are prefixed — `media:<id>` and `document:<id>` — rather than
 * merged into one table. A merge would rewrite the claim flow, the catalogue
 * importer, the quote attachments and the storefront's certificate block for a
 * screen-shaped reason.
 *
 * ## Folders
 *
 * Every file is in exactly one, and the counts sum to the header total — board
 * 3i acceptance criterion 1. `Unfiled` is `folderId IS NULL`, a virtual folder
 * that cannot be renamed or deleted, which is what makes the sum hold. The
 * board listed `Unused 41` as a sixth folder and put 41 files in two folders at
 * once; unreferenced is a **state**, computed by `./state.ts`, and it lives in
 * the filter row.
 */

export type FileKind = "image" | "document";

export interface LibraryFile {
  /** `media:<id>` or `document:<id>`. Prefixed, because there are two tables. */
  id: string;
  kind: FileKind;
  filename: string;
  /** Public for an image; null for a document, which is served signed. */
  url: string | null;
  /** `PDF`, `JPEG`. Rendered instead of a fake preview for a document. */
  format: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  bytes: number;
  createdAt: Date;
  folderId: string | null;
  references: Reference[];
  badges: BadgeKind[];
  /** Pre-resolved for the tile: the live surface a missing alt is failing on. */
  liveSurface: string | null;
  unreferenced: boolean;
  quoteHeld: boolean;
  productCount: number;
  primaryFor: string[];
}

export interface Folder {
  /** Null is `Unfiled` — the destination of uploads nobody has moved. */
  id: string | null;
  name: string;
  files: number;
}

export interface LibraryStorage {
  usedBytes: number;
  allowance: Allowance;
  planName: string;
}

export interface Library {
  files: LibraryFile[];
  folders: Folder[];
  total: number;
  storage: LibraryStorage;
  /** Unreferenced anywhere. Safe to delete. */
  unreferenced: number;
  /** Unattached but cited by a sent quote. Cannot be deleted. */
  quoteHeld: number;
  /** Empty alt on a file a buyer can actually see. */
  missingAltOnLive: number;
}

export type SortKey = "newest" | "oldest" | "largest" | "name";

export interface LibraryFilters {
  folderId?: string | null;
  /** Filename or alt text. */
  search?: string;
  type?: FileKind | "all";
  usedIn?: "all" | "products" | "storefront" | "nothing";
  missingAlt?: boolean;
  sort?: SortKey;
}

const basename = (path: string): string => path.split("/").pop() ?? path;

function formatOf(input: { mimeType?: string | null; path: string }): string {
  const fromMime = input.mimeType?.split("/")[1];
  if (fromMime) return fromMime.toUpperCase();
  const ext = input.path.split(".").pop();
  return (ext ?? "file").toUpperCase();
}

/**
 * The whole library for one seller, filtered.
 *
 * One pass: both tables, then one batched reference query over every id. A
 * reference query per file would be 1,482 round trips on the fixture the board
 * drew.
 */
export async function mediaLibrary(
  businessId: string,
  filters: LibraryFilters = {},
): Promise<Library> {
  const [images, documents, folderRows, plan] = await Promise.all([
    prisma.media.findMany({
      // `reviewId: null` — a buyer's review photograph is not the seller's file
      // and must never appear in their library or count against their storage.
      where: { businessId, reviewId: null },
      select: {
        id: true,
        storagePath: true,
        alt: true,
        width: true,
        height: true,
        bytes: true,
        createdAt: true,
        folderId: true,
      },
    }),
    prisma.document.findMany({
      where: { businessId },
      select: {
        id: true,
        storagePath: true,
        filename: true,
        displayName: true,
        mimeType: true,
        bytes: true,
        createdAt: true,
        folderId: true,
      },
    }),
    prisma.mediaFolder.findMany({
      where: { businessId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    effectiveFor(businessId),
  ]);

  const references = await referencesFor(businessId, [
    ...images.map((row) => row.id),
    ...documents.map((row) => row.id),
  ]);

  const build = (
    id: string,
    kind: FileKind,
    row: {
      storagePath: string;
      filename?: string;
      alt: string | null;
      width?: number | null;
      height?: number | null;
      bytes: number | null;
      createdAt: Date;
      folderId: string | null;
      mimeType?: string | null;
    },
  ): LibraryFile => {
    const refs = references.get(id) ?? [];
    const state = stateOf(refs);
    const live = refs.find((reference) => reference.live);
    return {
      id: `${kind === "image" ? "media" : "document"}:${id}`,
      kind,
      filename: row.filename ?? basename(row.storagePath),
      url: kind === "image" ? publicUrl(MEDIA_BUCKET, row.storagePath) : null,
      format: formatOf({ mimeType: row.mimeType ?? null, path: row.storagePath }),
      alt: row.alt,
      width: row.width ?? null,
      height: row.height ?? null,
      bytes: row.bytes ?? 0,
      createdAt: row.createdAt,
      folderId: row.folderId,
      references: refs,
      badges: badgesFor({ describable: kind === "image", alt: row.alt, references: refs }),
      liveSurface: live?.label ?? null,
      unreferenced: state.unreferenced,
      quoteHeld: state.quoteHeld,
      productCount: state.productCount,
      primaryFor: state.primaryFor,
    };
  };

  const all: LibraryFile[] = [
    ...images.map((row) => build(row.id, "image", row)),
    ...documents.map((row) =>
      build(row.id, "document", {
        ...row,
        // A document has no alt text of its own: alt describes an image, and a
        // PDF link is described by its display name. `describable: false` is
        // what keeps it out of the count — a null alt on its own reads as
        // "missing", which is what the first version of this did.
        alt: null,
        filename: row.displayName ?? row.filename,
      }),
    ),
  ];

  const folders: Folder[] = [
    ...folderRows.map((folder) => ({
      id: folder.id as string | null,
      name: folder.name,
      files: all.filter((file) => file.folderId === folder.id).length,
    })),
    {
      id: null,
      name: UNFILED,
      files: all.filter((file) => file.folderId === null).length,
    },
  ];

  return {
    files: applyFilters(all, filters),
    folders,
    total: all.length,
    storage: storageOf(all, plan),
    unreferenced: all.filter((file) => file.unreferenced).length,
    quoteHeld: all.filter((file) => file.quoteHeld).length,
    missingAltOnLive: all.filter((file) =>
      needsAlt({ describable: file.kind === "image", alt: file.alt }, file.references),
    ).length,
  };
}

/** The virtual folder. Not a row, so it cannot be renamed or deleted. */
export const UNFILED = "Unfiled";

function storageOf(files: readonly LibraryFile[], plan: PlanCaps | null): LibraryStorage {
  const usedBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const usedMb = Math.ceil(usedBytes / (1024 * 1024));
  const caps: PlanCaps =
    plan ??
    ({
      id: "free",
      name: "Free",
      monthlyPriceAed: 0,
      enquiriesPerMonth: null,
      productLimit: null,
      locationLimit: null,
      photoLimit: null,
      storageMb: null,
      teamSeats: 0,
      rankingMultiplier: 1,
      customDomain: false,
      sortOrder: 0,
    } satisfies PlanCaps);

  return { usedBytes, allowance: allowance(caps, "storage", usedMb), planName: caps.name };
}

function applyFilters(files: readonly LibraryFile[], filters: LibraryFilters): LibraryFile[] {
  const search = (filters.search ?? "").trim().toLowerCase();
  const sorted = [...files].filter((file) => {
    if (filters.folderId !== undefined && file.folderId !== filters.folderId) return false;
    if (filters.type && filters.type !== "all" && file.kind !== filters.type) return false;
    if (
      filters.missingAlt &&
      !needsAlt({ describable: file.kind === "image", alt: file.alt }, file.references)
    ) {
      return false;
    }
    if (filters.usedIn === "products" && file.productCount === 0) return false;
    if (filters.usedIn === "storefront") {
      if (!file.references.some((r) => r.kind === "storefront" || r.kind === "certificate")) {
        return false;
      }
    }
    if (filters.usedIn === "nothing" && !file.unreferenced) return false;
    if (search) {
      // Filename **or alt text** — §3. Searching alt is what makes the field
      // worth filling in for a seller with a thousand files called IMG_4471.
      const haystack = `${file.filename} ${file.alt ?? ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  switch (filters.sort ?? "newest") {
    case "oldest":
      return sorted.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    case "largest":
      return sorted.sort((a, b) => b.bytes - a.bytes);
    case "name":
      return sorted.sort((a, b) => a.filename.localeCompare(b.filename));
    default:
      return sorted.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

/** Splits `media:abc` into the table and the row id. */
export function parseFileId(id: string): { kind: FileKind; id: string } | null {
  const [table, rest] = id.split(":", 2);
  if (!rest) return null;
  if (table === "media") return { kind: "image", id: rest };
  if (table === "document") return { kind: "document", id: rest };
  return null;
}

export function encodeFileId(kind: FileKind, id: string): string {
  return `${kind === "image" ? "media" : "document"}:${id}`;
}
