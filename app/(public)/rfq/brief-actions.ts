"use server";

import { getActor } from "@/lib/auth/session";
import { PermissionError } from "@/lib/auth/errors";
import { readAttribution } from "@/lib/campaign/cookie";
import { prisma } from "@/lib/db/client";
import { t } from "@/lib/i18n";
import type { EngagementType } from "@/lib/db/generated/client";
import { BRIEF_ENGAGEMENTS, parseSiteValue, type BriefField } from "@/lib/enquiry/service-brief";
import { briefFieldErrors } from "@/lib/enquiry/service-brief-words";
import {
  previewBrief,
  sendServiceBrief,
  type BriefPreview,
  type SendServiceBriefInput,
} from "@/lib/enquiry/service-brief-server";
import { confirmEnquiryAttachment } from "@/lib/enquiry/service-enquiry-server";

/**
 * Board `1h-s` — the brief's three calls from the browser.
 *
 * Thin, like every action here: resolve who is asking, hand it to the service,
 * word the answer. The rules are in `lib/enquiry/service-brief.ts` and the order
 * they run in is `lib/enquiry/service-brief-server.ts`, both tested without a
 * request.
 */

/**
 * Who the brief would go to, for the rail and the button.
 *
 * The same `matchBrief` the send runs. A site the taxonomy does not hold, or a
 * trade that does not exist, previews as nobody rather than as an error — the
 * rail's empty state is the honest answer to both.
 */
export async function previewServiceBrief(input: {
  categoryId: string;
  site: string;
  widen: boolean;
  engagement: string;
}): Promise<BriefPreview> {
  const nobody: BriefPreview = { count: 0, names: [], emirateCount: null };

  const areaId = input.site.startsWith("area:") ? input.site.slice("area:".length) : null;
  const area = areaId
    ? await prisma.area.findUnique({ where: { id: areaId }, select: { emirate: true } })
    : null;
  const site = parseSiteValue(input.site, () => area?.emirate ?? null);
  if (!site) return nobody;

  const category = await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } });
  if (!category) return nobody;

  return previewBrief({
    categoryId: category.id,
    site,
    scope: input.widen ? "emirate" : "area",
    engagement: (BRIEF_ENGAGEMENTS as readonly string[]).includes(input.engagement)
      ? (input.engagement as EngagementType)
      : null,
  });
}

export type SubmitBriefResult =
  | {
      ok: true;
      enquiryId: string;
      next: string;
      uploads: { url: string; path: string; filename: string }[];
      claimToken: string | null;
    }
  | { ok: false; error: string; fields: Partial<Record<BriefField, string>> };

export async function submitServiceBrief(input: SendServiceBriefInput): Promise<SubmitBriefResult> {
  const actor = await getActor();
  const result = await sendServiceBrief(input, {
    buyerId: actor?.id ?? null,
    attribution: await readAttribution(),
  }).catch(notPermitted);
  // Build plan 9.4: `enquiry.create`, refused in the service. See `notPermitted`.
  if (result === null) return { ok: false, error: t("rfq.not_permitted"), fields: {} };

  if (result.ok) {
    return {
      ok: true,
      enquiryId: result.enquiryId,
      next: result.next,
      uploads: result.uploads,
      claimToken: result.claimToken,
    };
  }

  if ("refusals" in result) {
    return { ok: false, error: t("brief.fix_fields"), fields: briefFieldErrors(result.refusals) };
  }

  return {
    ok: false,
    fields: {},
    error:
      result.error === "no_buyer"
        ? t("rfq.contact_required")
        : result.error === "no_recipients"
          ? t("brief.undelivered")
          : t("brief.gone"),
  };
}

/** A refusal from the matrix, as a value; anything else is still thrown. */
function notPermitted(error: unknown): null {
  if (error instanceof PermissionError) return null;
  throw error;
}

export async function confirmBriefAttachment(input: {
  enquiryId: string;
  path: string;
  filename: string;
  claimToken: string | null;
}): Promise<{ ok: boolean }> {
  const actor = await getActor();
  const result = await confirmEnquiryAttachment(input, { actorId: actor?.id ?? null });
  // The reason stays on the server; the buyer's page says a file did not arrive.
  return { ok: result.ok };
}
