import { prisma } from "@/lib/db/client";
import { allowance, type PlanCaps } from "@/lib/plan/entitlements";
import { WEIGHTS } from "@/lib/metrics/profile-strength";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";
import { Card } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { deleteMedia, recordMedia, saveAlt, signMediaUpload } from "./actions";
import { MediaLibrary, type MediaItem } from "./MediaLibrary";

/**
 * Board 3i — the media library.
 *
 * The intro says what photographs are worth in profile-strength points, taken
 * from `WEIGHTS` rather than written into a sentence. Board 8a states the same
 * numbers on the setup hub, and two places quoting a percentage that has drifted
 * apart is worse than neither quoting one.
 */
export const metadata = { title: "Media" };
export const dynamic = "force-dynamic";

const PLAN_SELECT = {
  id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true, productLimit: true,
  locationLimit: true, photoLimit: true, teamSeats: true, rankingMultiplier: true,
  customDomain: true, siteVisitIncluded: true, sortOrder: true,
} as const;

export default async function MediaPage() {
  const seat = await requireSellerSeat();

  const [business, badges, media] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: { plan: { select: PLAN_SELECT } },
    }),
    getNavBadges(seat.businessId),
    prisma.media.findMany({
      where: { OR: [{ businessId: seat.businessId }, { product: { businessId: seat.businessId } }], reviewId: null },
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        kind: true,
        alt: true,
        storagePath: true,
        product: { select: { name: true } },
      },
    }),
  ]);

  const plan: PlanCaps | null =
    business.plan ?? (await prisma.plan.findUnique({ where: { id: "free" }, select: PLAN_SELECT }));

  const items: MediaItem[] = media.map((row) => ({
    id: row.id,
    kind: row.kind,
    alt: row.alt,
    url: publicUrl(MEDIA_BUCKET, row.storagePath),
    attachedTo: row.product?.name ?? null,
  }));

  const photos = plan ? allowance(plan, "photos", media.length) : null;

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/media"
      eyebrow={t("media.eyebrow")}
      title={t("media.title")}
      meta={
        photos && plan ? (
          <span className="font-mono text-caption text-muted">
            {photos.cap === null
              ? t("media.count", { count: formatCount(media.length) })
              : t("media.of_limit", {
                  used: formatCount(media.length),
                  cap: formatCount(photos.cap),
                  plan: plan.name,
                })}
          </span>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <p className="max-w-prose text-body-sm text-muted">
          {t("media.intro", { points: `${WEIGHTS.photos}%` })}
        </p>

        {media.length === 0 && (
          <Card padded>
            <h2 className="text-h3 text-ink">{t("media.empty_title")}</h2>
            <p className="mt-2 max-w-prose text-body-sm text-muted">{t("media.empty_body")}</p>
          </Card>
        )}

        <MediaLibrary
          items={items}
          signAction={signMediaUpload}
          recordAction={recordMedia}
          saveAltAction={saveAlt}
          deleteAction={deleteMedia}
        />
      </div>
    </SellerPage>
  );
}
