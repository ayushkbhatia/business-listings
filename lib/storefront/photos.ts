/**
 * The gallery photos a storefront may show, after the plan's cut.
 *
 * From the plan row, not from a constant — D1, 9 Sep 2026. This was
 * `const FREE_PHOTO_LIMIT = 3`, gated on `plan.id === "free"`, in a page file:
 * nobody could change the cut without a deploy, and a second free-shaped plan
 * would have rendered as Pro.
 *
 * `publicPhotoLimit` is null on the paid plans, so the null check is the whole
 * paid path. A listing with no plan row is treated as Free — most are unclaimed
 * imports, and defaulting the other way would hand the best storefront to every
 * listing nobody has claimed.
 *
 * Pure, and shared by both storefront compositions — the goods overview and
 * board `1d-s`'s — so the cut cannot be one number on one and another on the
 * other.
 */
export const FALLBACK_FREE_PHOTOS = 3;

export function storefrontPhotos<T extends { kind: string }>(
  plan: { id: string; publicPhotoLimit: number | null } | null,
  media: readonly T[],
): T[] {
  const free = (plan?.id ?? "free") === "free";
  const limit = plan?.publicPhotoLimit ?? (free ? FALLBACK_FREE_PHOTOS : null);
  const gallery = media.filter((item) => item.kind === "gallery");
  return limit === null ? gallery : gallery.slice(0, limit);
}
