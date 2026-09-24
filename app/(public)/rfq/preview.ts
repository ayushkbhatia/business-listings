import "server-only";
import { prisma } from "@/lib/db/client";
import { selectRecipients } from "@/lib/enquiry/fanout";
import { descendantsOf, findFanoutCandidates } from "@/lib/enquiry/service";
import { formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { RecipientPreview } from "@/components/domain";

export interface RecipientPreviewInput {
  categoryId: string;
  emirate: string | null;
  lineCount: number;
  fanoutTo: number;
  pinnedBusinessIds?: string[];
}

/**
 * Who the enquiry would go to, for the composer's recipient list.
 *
 * The same matcher the send uses, so the preview and the delivery cannot
 * disagree — including about a seller at their monthly cap, who is absent from
 * both rather than shown and then skipped.
 *
 * And about the viewer's own business, which `createEnquiry` never sends to and
 * refuses a send that names. The composer ticks what it previews, so a list that
 * showed it would offer a send the service refuses. Taken as an argument rather
 * than read here: only a request has a session, and this is also called
 * without one.
 */
export async function previewRecipientsFor(
  input: RecipientPreviewInput,
  viewer: { excludeBusinessId: string | null },
): Promise<RecipientPreview[]> {
  const request = {
    categoryId: input.categoryId,
    // The preview has to widen the same way the send does, or the composer
    // shows five suppliers and the enquiry reaches a different five.
    categoryIds: await descendantsOf(input.categoryId),
    emirate: input.emirate,
    lineCount: Math.max(1, input.lineCount),
    want: input.fanoutTo,
    ...(input.pinnedBusinessIds ? { pinned: input.pinnedBusinessIds } : {}),
  };

  const candidates = await findFanoutCandidates({
    ...request,
    ...(viewer.excludeBusinessId ? { excludeBusinessIds: [viewer.excludeBusinessId] } : {}),
  });
  const { recipients } = selectRecipients(candidates, request);
  if (recipients.length === 0) return [];

  const areas = await prisma.business.findMany({
    where: { id: { in: recipients.map((r) => r.businessId) } },
    select: {
      id: true,
      locations: { where: { published: true }, select: { area: { select: { name: true } } }, take: 1 },
    },
  });
  const areaById = new Map(areas.map((a) => [a.id, a.locations[0]?.area?.name ?? null]));
  const pinned = new Set(input.pinnedBusinessIds ?? []);

  return recipients.map((r) => ({
    businessId: r.businessId,
    displayName: r.displayName,
    areaName: areaById.get(r.businessId) ?? null,
    verificationTier: r.verificationTier,
    // Measured, never claimed. Unmeasured says so rather than guessing.
    responseLabel:
      r.responseTimeMedianMs === null
        ? t("response.unmeasured")
        : t("response.median", { duration: formatDuration(r.responseTimeMedianMs) }),
    ...(pinned.has(r.businessId) ? { pinned: true } : {}),
  }));
}
