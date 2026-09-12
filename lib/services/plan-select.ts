/**
 * Every column `PlanCaps` needs, as a Prisma select.
 *
 * Its own file so `lib/services/service.ts` can read a plan without importing
 * the entitlements *service*, which owns the staff-audited write path and the
 * grandfathering. A seller screen reading caps needs the columns, not the
 * machinery — and `board 2e-s`'s `serviceLimit` is one more place this list has
 * to stay in step with `PlanCaps`, which is the argument for it being written
 * once.
 */
export const PLAN_SELECT = {
  id: true,
  name: true,
  monthlyPriceAed: true,
  enquiriesPerMonth: true,
  productLimit: true,
  serviceLimit: true,
  locationLimit: true,
  photoLimit: true,
  publicPhotoLimit: true,
  categoryLimit: true,
  storageMb: true,
  teamSeats: true,
  rankingMultiplier: true,
  customDomain: true,
  analytics: true,
  csvImport: true,
  sponsoredEligible: true,
  sortOrder: true,
} as const;
