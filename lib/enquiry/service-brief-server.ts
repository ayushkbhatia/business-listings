import "server-only";
import type { Emirate, EngagementType } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import type { Attribution } from "@/lib/campaign/attribution";
import { DOCUMENT_BUCKET } from "@/lib/storage";
import { businessCoverage } from "@/lib/locations/service-coverage";
import type { CoverageScope } from "@/lib/locations/coverage";
import { MIN_SAMPLE, windowStart } from "@/lib/metrics/response-time";
import { PLAN_CAPS_SELECT, effectiveCaps, toCaps } from "@/lib/plan/entitlements";
import { sellsWork } from "@/lib/storefront/tabs";
import { tradeKindFor } from "@/lib/taxonomy/service";
import { VERIFIED_TIER } from "@/lib/verification";
import { monthStart } from "./fanout";
import { createEnquiry, descendantsOf } from "./service";
import {
  BRIEF_NAMES_SHOWN,
  briefSubjectLine,
  checkServiceBrief,
  reachesSite,
  selectBriefRecipients,
  siteLabel,
  type BriefCandidate,
  type BriefRefusal,
  type BriefSelection,
  type BriefSite,
} from "./service-brief";
import { enquiryAttachmentPath, uaeToday } from "./service-enquiry";
import { storageDeps, type StorageDeps } from "./service-enquiry-server";

/**
 * Board `1h-s` — matching a brief, previewing the match, and sending it.
 *
 * The rules are `./service-brief.ts`. This is the order they run in and the
 * two things only a server can do: read the directory, and speak to storage.
 *
 * **The preview and the send are one function.** The rail names three firms and
 * the button states a count; both come from `matchBrief`, the same call the send
 * makes, so what a buyer is shown and what is delivered cannot disagree beyond
 * the minutes between the two — a firm reaching its cap in that gap is skipped
 * at send, as the goods composer does.
 */

/* ── Which composer the route mounts ────────────────────────────────────── */

/**
 * Whether `/rfq/new` should ask for a brief rather than a parts list.
 *
 * The subcategory's `tradeKind` decides, as the spec says. Two arrivals can
 * override a trade that still resolves to `goods`, because the taxonomy is
 * being classified by ops today and a subcategory nobody has reached yet must
 * not hand a buyer from a firm's service page a lines table:
 *
 *  - **a named firm that sells only work** (`?to=` from a storefront or a
 *    search row), since a quantity is meaningless to them whatever the trade
 *    row says; and
 *  - **`kind=services` from a service surface** (`1f-s`'s offer), honoured only
 *    where at least one live service is filed in the trade — a hand-typed
 *    parameter cannot turn a valves subcategory into a brief nobody can match.
 */
export async function briefWanted(input: {
  categoryId: string;
  kindParam: string | null;
  pinnedSellsKind: string | null;
}): Promise<boolean> {
  if (input.pinnedSellsKind === "services") return true;
  if ((await tradeKindFor(input.categoryId)) === "services") return true;
  if (input.kindParam !== "services") return false;
  const live = await prisma.service.count({
    where: { status: "live", categoryId: { in: await descendantsOf(input.categoryId) } },
  });
  return live > 0;
}

/* ── The matcher ─────────────────────────────────────────────────────────── */

export interface BriefMatchRequest {
  categoryId: string;
  site: BriefSite;
  /** `emirate` once the buyer has widened an area that found nobody. */
  scope: "area" | "emirate";
  engagement: EngagementType | null;
}

/**
 * A pool bound, not a cap anybody meets. Every row already holds a verified
 * licence, sells work in this trade and has some coverage in the emirate; four
 * hundred of those in one trade and one emirate is a directory this one is not
 * yet, and the ranking only needs eight.
 */
const POOL = 400;

/**
 * Clauses 1–3 of B5, in the database where they can be, and in TypeScript where
 * the union of per-service coverage has to be resolved.
 *
 * `serviceCoverage: { some: { emirate } }` is a necessary condition, not the
 * test: any union that reaches the site has at least one row in its emirate.
 * The exact answer — Al Quoz does not reach Business Bay, a service narrowed
 * away from Sharjah does not count for Sharjah — is `businessCoverage` and
 * `reachesSite`, the same helpers the storefront's coverage renders from.
 */
export async function findBriefCandidates(
  request: BriefMatchRequest,
  now: Date = new Date(),
): Promise<BriefCandidate[]> {
  const tree = await descendantsOf(request.categoryId);
  const since = monthStart(now);

  const businesses = await prisma.business.findMany({
    where: {
      suspendedAt: null,
      publishedAt: { not: null },
      // Somebody is behind it to write a proposal.
      claimStatus: "claimed",
      sellsKind: { in: ["services", "both"] },
      // B5, clause 1: the licence, checked, and still current. The nightly sweep
      // drops a lapsed tier; this closes the hours between the lapse and the job.
      verificationTier: { gte: VERIFIED_TIER },
      licenceExpiry: { gte: now },
      serviceCoverage: { some: { emirate: request.site.emirate } },
      OR: [
        { primaryCategoryId: { in: tree } },
        // A flagged extra category is out of routing until a reviewer clears
        // it — board 2c's rule, the same one the goods fan-out applies.
        { categories: { some: { categoryId: { in: tree }, unverifiedActivityAt: null } } },
        { services: { some: { status: "live", categoryId: { in: tree } } } },
      ],
    },
    select: {
      id: true,
      slug: true,
      displayName: true,
      primaryCategoryId: true,
      responseTimeMedianMs: true,
      categories: { where: { unverifiedActivityAt: null }, select: { categoryId: true } },
      services: { where: { status: "live" }, select: { id: true, categoryId: true, engagementType: true } },
      plan: { select: PLAN_CAPS_SELECT },
      subscription: { select: { entitlementSnapshot: true } },
      _count: { select: { recipients: { where: { createdAt: { gte: since } } } } },
    },
    orderBy: { id: "asc" },
    take: POOL,
  });
  if (businesses.length === 0) return [];

  const rows = await prisma.serviceCoverage.findMany({
    where: { businessId: { in: businesses.map((b) => b.id) } },
    select: { businessId: true, serviceId: true, emirate: true, areaId: true },
  });
  const byBusiness = new Map<string, typeof rows>();
  for (const row of rows) {
    const held = byBusiness.get(row.businessId);
    if (held) held.push(row);
    else byBusiness.set(row.businessId, [row]);
  }

  const inTree = new Set(tree);
  const out: BriefCandidate[] = [];
  for (const business of businesses) {
    const own = byBusiness.get(business.id) ?? [];
    const scope = (row: (typeof own)[number]): CoverageScope => ({ emirate: row.emirate, areaId: row.areaId });
    /*
       `2d-s` B6: the union of every live service's effective coverage, and the
       default alone for a firm with no live service yet. Not filtered to the
       services in this trade — the spec's own line is that a firm whose audit
       does not travel to Sharjah still receives a Sharjah brief for a service
       that does, and answers from its own scope sheet.
    */
    const coverage = businessCoverage(
      own.filter((row) => row.serviceId === null).map(scope),
      business.services.map((service) => own.filter((row) => row.serviceId === service.id).map(scope)),
    );
    if (!reachesSite(coverage, request.site, request.scope)) continue;

    const tradeServices = business.services.filter((service) => inTree.has(service.categoryId));
    out.push({
      businessId: business.id,
      slug: business.slug,
      displayName: business.displayName,
      exactTrade:
        business.primaryCategoryId === request.categoryId ||
        business.categories.some((c) => c.categoryId === request.categoryId) ||
        tradeServices.some((service) => service.categoryId === request.categoryId),
      offersEngagement:
        request.engagement !== null &&
        tradeServices.some((service) => service.engagementType === request.engagement),
      responseTimeMedianMs: business.responseTimeMedianMs,
      enquiriesPerMonth: business.plan
        ? effectiveCaps(toCaps(business.plan), business.subscription?.entitlementSnapshot).enquiriesPerMonth
        : null,
      enquiriesThisMonth: business._count.recipients,
    });
  }
  return out;
}

export async function matchBrief(request: BriefMatchRequest, now: Date = new Date()): Promise<BriefSelection> {
  return selectBriefRecipients(await findBriefCandidates(request, now));
}

/* ── A named firm ────────────────────────────────────────────────────────── */

export interface PinnedFirm {
  id: string;
  slug: string;
  displayName: string;
  primaryCategoryId: string;
  sellsKind: string;
}

/**
 * The firm a buyer arrived from, re-read rather than trusted. Public, claimed
 * and selling work, or nobody — the same gate the storefront's own composer
 * applies. Not the matcher's licence or coverage clauses: those decide who *we*
 * pick, and the buyer picked.
 */
export async function pinnedFirm(slug: string): Promise<PinnedFirm | null> {
  const firm = await prisma.business.findFirst({
    where: { slug, suspendedAt: null, publishedAt: { not: null }, claimStatus: "claimed" },
    select: { id: true, slug: true, displayName: true, primaryCategoryId: true, sellsKind: true },
  });
  return firm && sellsWork(firm.sellsKind) ? firm : null;
}

/**
 * The one-recipient selection for a named firm: them, unless their plan has no
 * room this month — then nobody, silently, and a `MissedEnquiry` for the stack
 * (D4). Never a substitute the buyer did not choose.
 */
export async function pinnedSelection(firmId: string, now: Date = new Date()): Promise<BriefSelection> {
  const firm = await prisma.business.findUnique({
    where: { id: firmId },
    select: {
      id: true,
      slug: true,
      displayName: true,
      responseTimeMedianMs: true,
      plan: { select: PLAN_CAPS_SELECT },
      subscription: { select: { entitlementSnapshot: true } },
      _count: { select: { recipients: { where: { createdAt: { gte: monthStart(now) } } } } },
    },
  });
  if (!firm) return { recipients: [], skipped: [] };
  return selectBriefRecipients(
    [
      {
        businessId: firm.id,
        slug: firm.slug,
        displayName: firm.displayName,
        exactTrade: true,
        offersEngagement: false,
        responseTimeMedianMs: firm.responseTimeMedianMs,
        enquiriesPerMonth: firm.plan
          ? effectiveCaps(toCaps(firm.plan), firm.subscription?.entitlementSnapshot).enquiriesPerMonth
          : null,
        enquiriesThisMonth: firm._count.recipients,
      },
    ],
    { cap: 1 },
  );
}

/* ── The preview ─────────────────────────────────────────────────────────── */

export interface BriefPreview {
  /** Recipients the send would write now, at most the cap. */
  count: number;
  /** The first three, by display name — never a trade name. */
  names: string[];
  /**
   * How many would match anywhere in the emirate, asked only when an area
   * matched nobody — the number behind the widening offer.
   */
  emirateCount: number | null;
}

export async function previewBrief(request: BriefMatchRequest, now: Date = new Date()): Promise<BriefPreview> {
  const { recipients } = await matchBrief(request, now);
  const emirateCount =
    recipients.length === 0 && request.site.areaId !== null && request.scope === "area"
      ? (await matchBrief({ ...request, scope: "emirate" }, now)).recipients.length
      : null;
  return {
    count: recipients.length,
    names: recipients.slice(0, BRIEF_NAMES_SHOWN).map((r) => r.displayName),
    emirateCount,
  };
}

/* ── The measured line in *What happens next* ───────────────────────────── */

/**
 * The median time from a brief being sent to its first reply from anybody,
 * over the last ninety days — or null under the reply-time floor.
 *
 * The render claims *most buyers get their first proposal back in under an
 * hour*. That is a number, and on a directory whose only asset is that its
 * numbers are true it has to be one somebody measured. Same window and same
 * floor as a firm's own median (`lib/metrics/response-time.ts`, floor 3 by the
 * owner's decision of 13 Sep). A brief nobody answered contributes nothing
 * rather than infinity, for the reason `latencies` gives; an automatic
 * out-of-hours reply never stamps `firstReplyAt`, so it cannot flatter this.
 *
 * Null is the launch state and the page has a sentence for it.
 */
export async function briefFirstReplyMedianMs(now: Date = new Date()): Promise<number | null> {
  const [row] = await prisma.$queryRaw<{ median: number | null; n: bigint }[]>`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS median, count(*) AS n
    FROM (
      SELECT EXTRACT(EPOCH FROM (MIN(r.first_reply_at) - e.created_at)) * 1000 AS ms
      FROM service_brief b
      JOIN enquiry e ON e.id = b.enquiry_id
      JOIN enquiry_recipient r ON r.enquiry_id = b.enquiry_id
      WHERE e.created_at >= ${windowStart(now)}
      GROUP BY b.enquiry_id, e.created_at
      HAVING MIN(r.first_reply_at) IS NOT NULL
    ) replies
    WHERE ms >= 0
  `;
  if (!row || Number(row.n) < MIN_SAMPLE || row.median === null) return null;
  return Math.round(Number(row.median));
}

/* ── Sending ─────────────────────────────────────────────────────────────── */

export interface SendServiceBriefInput {
  categoryId: string;
  /** `?kind=` as the page received it, so the server re-decides the composer. */
  kind: string | null;
  site: string;
  /** The buyer accepted the offer to match anywhere in the emirate. */
  widen: boolean;
  building: string;
  description: string;
  engagement: string;
  cadence: string;
  startMode: string;
  startsOn: string;
  scale: string;
  /** A firm the buyer named, by slug. The brief goes to them alone. */
  pinned: string | null;
  /** That firm's live service the buyer came from, by slug. */
  service: string | null;
  attachments: readonly { filename: string; type: string; bytes: number }[];
  /** Ignored for a signed-in buyer. */
  contactPhone: string;
  contactName: string;
}

export type SendServiceBriefResult =
  | {
      ok: true;
      enquiryId: string;
      ref: string;
      next: string;
      /** One signed write per chosen file, in the order they were chosen. */
      uploads: { url: string; path: string; filename: string }[];
      /** At least one file could not be signed for. The brief still went. */
      uploadUnavailable: boolean;
      claimToken: string | null;
    }
  | { ok: false; refusals: BriefRefusal[] }
  | { ok: false; error: "not_found" | "no_recipients" | "no_buyer" };

export async function sendServiceBrief(
  input: SendServiceBriefInput,
  context: { buyerId: string | null; attribution?: Attribution | null },
  deps: StorageDeps = storageDeps,
  now: Date = new Date(),
): Promise<SendServiceBriefResult> {
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { id: true, name: true, acceptsRfq: true },
  });
  if (!category || !category.acceptsRfq) return { ok: false, error: "not_found" };

  const firm = input.pinned ? await pinnedFirm(input.pinned) : null;
  if (input.pinned && !firm) return { ok: false, error: "not_found" };

  // The composer is re-decided, not trusted: a brief posted against a trade
  // the page would have offered a parts list for is refused.
  if (!(await briefWanted({ categoryId: category.id, kindParam: input.kind, pinnedSellsKind: firm?.sellsKind ?? null }))) {
    return { ok: false, error: "not_found" };
  }

  const areaId = input.site.startsWith("area:") ? input.site.slice("area:".length) : null;
  const area = areaId
    ? await prisma.area.findUnique({ where: { id: areaId }, select: { id: true, name: true, emirate: true } })
    : null;

  const checked = checkServiceBrief(
    {
      site: input.site,
      building: input.building,
      description: input.description,
      engagement: input.engagement,
      cadence: input.cadence,
      startMode: input.startMode,
      startsOn: input.startsOn,
      scale: input.scale,
      attachments: input.attachments.map((file) => ({ type: file.type, bytes: file.bytes })),
      contactPhone: context.buyerId ? null : input.contactPhone,
    },
    {
      today: uaeToday(now),
      areaEmirate: (id) => (area && area.id === id ? (area.emirate as Emirate) : null),
    },
  );
  if (!checked.ok) return { ok: false, refusals: checked.refusals };
  const brief = checked.value;

  const service =
    firm && input.service
      ? await prisma.service.findFirst({
          where: { businessId: firm.id, slug: input.service, status: "live" },
          select: { id: true, name: true },
        })
      : null;

  const selection = firm
    ? await pinnedSelection(firm.id, now)
    : await matchBrief(
        {
          categoryId: category.id,
          site: brief.site,
          scope: input.widen ? "emirate" : "area",
          engagement: brief.engagement,
        },
        now,
      );

  // Before an identity is minted for a buyer with no account: a brief that
  // reaches nobody must not leave a provisional user behind it.
  if (selection.recipients.length === 0) return { ok: false, error: "no_recipients" };

  const created = await createEnquiry(
    {
      buyerId: context.buyerId,
      phone: context.buyerId ? null : input.contactPhone,
      fullName: context.buyerId ? null : input.contactName.trim() || null,
      attribution: context.attribution ?? null,
      requirement: brief.description,
      lines: [briefSubjectLine(category, service)],
      categoryId: category.id,
      emirate: brief.site.emirate,
      areaId: brief.site.areaId,
      // What a supplier's notification prints as the place. The buyer picked it
      // from our list, so the words name the row.
      deliverToArea: siteLabel(brief.site, area?.name ?? null),
      scale: brief.scale,
      selection,
      serviceBrief: {
        categoryId: category.id,
        engagementType: brief.engagement,
        cadence: brief.cadence,
        startMode: brief.startMode,
        startsOn: brief.startsOn,
        building: brief.building,
      },
      ...(firm ? { pinnedBusinessIds: [firm.id] } : {}),
      fanoutTo: Math.max(1, selection.recipients.length),
    },
    now,
  );
  if (!created.ok) {
    return { ok: false, error: created.error === "no_lines" ? "no_buyer" : created.error };
  }

  const params = new URLSearchParams({ sent: "1" });
  if (created.claimToken) params.set("t", created.claimToken);

  /*
     The files travel after the brief exists, under its own folder, for the
     reason `service-enquiry-server.ts` gives: a signature costs a delivered
     enquiry. One failure marks the brief and signs nothing further — a partial
     set the buyer believes is whole is worse than a plain "attach them again".
  */
  const uploads: { url: string; path: string; filename: string }[] = [];
  let uploadUnavailable = false;
  for (const file of input.attachments) {
    try {
      const signed = await deps.sign(DOCUMENT_BUCKET, enquiryAttachmentPath(created.enquiryId, file.filename));
      uploads.push({ url: signed.url, path: signed.path, filename: file.filename });
    } catch {
      uploadUnavailable = true;
      params.set("attachment", "failed");
      break;
    }
  }

  return {
    ok: true,
    enquiryId: created.enquiryId,
    ref: created.ref,
    next: `/enquiry/${created.enquiryId}?${params}`,
    uploads: uploadUnavailable ? [] : uploads,
    uploadUnavailable,
    claimToken: created.claimToken,
  };
}
