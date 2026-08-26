"use server";

import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { createEnquiry, findFanoutCandidates } from "@/lib/enquiry/service";
import { selectRecipients } from "@/lib/enquiry/fanout";
import { prisma } from "@/lib/db/client";
import { formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { RecipientPreview } from "@/components/domain";

/**
 * Sending an enquiry.
 *
 * Thin: resolve who is asking, hand it to the service, redirect to the
 * tracking page. Every rule about who receives it is in lib/enquiry/fanout.ts
 * and lib/enquiry/service.ts, where it is tested without a request.
 */

export interface SendEnquiryInput {
  requirement: string;
  lines: { description: string; qty: number; unit: string | null; size: string | null; targetUnitPriceAed: string | null; productId: string | null }[];
  categoryId: string;
  emirate: string | null;
  deliverToArea: string | null;
  neededBy: string | null;
  termsWanted: string | null;
  closesInDays: number;
  fanoutTo: number;
  contactPhone: string;
  contactName: string;
  pinnedBusinessIds?: string[];
}

export type SendEnquiryResult = { ok: false; error: string };

export async function sendEnquiry(input: SendEnquiryInput): Promise<SendEnquiryResult> {
  const actor = await getActor();

  const result = await createEnquiry({
    buyerId: actor?.id ?? null,
    phone: input.contactPhone,
    fullName: input.contactName,
    requirement: input.requirement,
    lines: input.lines,
    categoryId: input.categoryId,
    emirate: input.emirate,
    deliverToArea: input.deliverToArea,
    neededBy: input.neededBy ? new Date(input.neededBy) : null,
    termsWanted: input.termsWanted,
    closesInDays: input.closesInDays,
    fanoutTo: input.fanoutTo,
    ...(input.pinnedBusinessIds ? { pinnedBusinessIds: input.pinnedBusinessIds } : {}),
  });

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "no_recipients"
          ? t("rfq.recipients_none")
          : result.error === "no_buyer"
            ? t("rfq.contact_required")
            : t("rfq.lines_required"),
    };
  }

  // The token goes in the link because an account-less buyer has nothing else
  // to identify them with. See app/(public)/enquiry/_buyer.ts.
  const params = new URLSearchParams({ sent: "1" });
  if (result.claimToken) params.set("t", result.claimToken);
  redirect(`/enquiry/${result.enquiryId}?${params}`);
}

/**
 * Who the enquiry would go to, for the wizard's third step.
 *
 * The same matcher the send uses, so the preview and the delivery cannot
 * disagree — including about a seller at their monthly cap, who is absent from
 * both rather than shown and then skipped.
 */
export async function previewRecipients(input: {
  categoryId: string;
  emirate: string | null;
  lineCount: number;
  fanoutTo: number;
  pinnedBusinessIds?: string[];
}): Promise<RecipientPreview[]> {
  const request = {
    categoryId: input.categoryId,
    emirate: input.emirate,
    lineCount: Math.max(1, input.lineCount),
    want: input.fanoutTo,
    ...(input.pinnedBusinessIds ? { pinned: input.pinnedBusinessIds } : {}),
  };

  const candidates = await findFanoutCandidates(request);
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
