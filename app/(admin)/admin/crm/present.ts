import type { CrmBoard, CrmRow, HeldScopeBanner, ScriptRecord } from "@/lib/crm/board";
import { SIGNAL_WINDOW_DAYS, supplyGap, unansweredOf } from "@/lib/crm/model";
import type { ScriptId } from "@/lib/crm/scripts";
import { WINDOW_DAYS } from "@/lib/metrics/response-time";
import { formatCount, formatDate, formatDateShort, formatDateTime, formatPercent } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";

/**
 * Board 12d — the call list as the strings it prints.
 *
 * The only place a task becomes text, so the page and the gallery say the same
 * sentence about the same row. Every figure here is one the task's facts carry
 * — the run that derived the row measured it — and the banner's arithmetic is
 * `supplyGap`, which a unit test holds to the handoff's own corrected numbers.
 */

export type Tone = "bad" | "warn" | "ok" | "neutral";

export interface CallRowView {
  id: string;
  businessName: string;
  businessHref: string;
  /** Licence, area and renewal, as the render's grey line under the name. */
  meta: string;
  /** Masked until revealed, and the reveal is a logged event (B9). */
  phoneMasked: string | null;
  why: string;
  whyTone: Tone;
  listing: { label: string; plan: "free" | "basic" | "pro" | null };
  lastTouch: string;
  lastTouchTone: Tone;
  action: { label: string; variant: "primary" | "secondary" | "danger" };
  due: boolean;
  mine: boolean;
  hasPhone: boolean;
  script: { text: string; record: string };
}

export interface BannerView {
  signalRef: string;
  title: string;
  body: string;
  /** The page's other conditions, which recruiting does not touch (B4). */
  other: string;
  canBuild: boolean;
  buildLabel: string;
  mineNote: string | null;
  matrixHref: string;
}

export interface WeekLine {
  key: string;
  label: string;
  value: string;
  tone: Tone;
}

export interface CrmView {
  rows: CallRowView[];
  banner: BannerView | null;
  moreHeldScopes: string | null;
  week: { since: string; lines: WeekLine[] };
  headerCounts: string;
  listTitle: string;
  listCount: string;
  heldByOthers: string | null;
  empty: { title: string; body: string; neverRun: boolean };
  refreshed: string;
  tabNote: string | null;
}

const PLANS = new Set(["free", "basic", "pro"]);

function whyOf(row: CrmRow): { text: string; tone: Tone } {
  const f = row.facts;
  switch (f.kind) {
    case "held_page":
      return {
        text: t(row.claimStatus === "claimed" ? "admin.crm.why.held_page_unverified" : "admin.crm.why.held_page_unclaimed", {
          trade: f.trade,
          area: f.areaName,
        }),
        tone: "neutral",
      };
    case "zero_result": {
      // Board 10e B6: saved searches waiting on an alert in this trade, said beside the searches.
      const waiting = f.alertsWaiting ?? 0;
      const searches = t("admin.crm.why.zero_result", { count: f.searches30d, n: formatCount(f.searches30d), category: f.categoryName });
      if (waiting === 0) return { text: searches, tone: "neutral" };
      const alerts = t("admin.crm.why.zero_result_alerts", { count: waiting, n: formatCount(waiting), category: f.categoryName });
      return {
        text: f.searches30d === 0 ? alerts : t("admin.crm.why.zero_result_and_alerts", { searches, alerts: t("admin.crm.why.alerts_waiting", { count: waiting, n: formatCount(waiting) }) }),
        tone: "neutral",
      };
    }
    case "unclaimed_demand":
      return { text: t("admin.crm.why.unclaimed_demand", { count: f.enquiries30d, n: formatCount(f.enquiries30d) }), tone: "neutral" };
    case "cap_reached":
      if (f.cap === "enquiry_cap") {
        return { text: t("admin.crm.why.enquiry_cap", { count: f.missedEnquiries30d, n: formatCount(f.missedEnquiries30d) }), tone: "neutral" };
      }
      return {
        text:
          f.refusedCap !== null
            ? t(f.cap === "service_cap" ? "admin.crm.why.service_cap" : "admin.crm.why.product_cap", { cap: formatCount(f.refusedCap) })
            : t(f.cap === "service_cap" ? "admin.crm.why.service_cap_unknown" : "admin.crm.why.product_cap_unknown"),
        tone: "neutral",
      };
    case "churn_risk":
      return { text: t("admin.crm.why.churn_risk", { rate: formatPercent(f.replyRate, { decimals: 0 }) }), tone: "bad" };
  }
}

function listingOf(row: CrmRow): CallRowView["listing"] {
  if (row.claimStatus !== "claimed") return { label: t("admin.crm.listing.unclaimed"), plan: null };
  const plan = row.planId && PLANS.has(row.planId) ? (row.planId as "free" | "basic" | "pro") : null;
  if (plan === "free" || plan === null) return { label: t("admin.crm.listing.claimed_free"), plan: null };
  return { label: t(`admin.crm.listing.${plan}` as MessageKey), plan };
}

function lastTouchOf(row: CrmRow, now: Date): { text: string; tone: Tone } {
  if (row.state === "callback" && row.callBackAt) {
    return {
      text: t(row.due ? "admin.crm.touch.callback_due" : "admin.crm.touch.callback", {
        asked: row.lastTouchAt ? formatDateShort(row.lastTouchAt) : "—",
        date: formatDateShort(row.callBackAt),
      }),
      tone: row.due ? "warn" : "neutral",
    };
  }
  if (!row.lastTouchAt || !row.lastOutcome) return { text: t("admin.crm.touch.never"), tone: "bad" };
  const when = sameDubaiDay(row.lastTouchAt, now)
    ? t("admin.crm.touch.today")
    : sameDubaiDay(row.lastTouchAt, new Date(now.getTime() - 86_400_000))
      ? t("admin.crm.touch.yesterday")
      : formatDateShort(row.lastTouchAt);
  return {
    text: t("admin.crm.touch.outcome", { when, outcome: t(`crm.outcome.${row.lastOutcome}` as MessageKey).toLowerCase() }),
    tone: row.lastOutcome === "interested" || row.lastOutcome === "claim_link_sent" ? "ok" : "neutral",
  };
}

function sameDubaiDay(a: Date, b: Date): boolean {
  const day = (d: Date) => new Date(d.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
  return day(a) === day(b);
}

export function scriptText(row: CrmRow): string {
  const f = row.facts;
  const id = row.scriptId;
  switch (f.kind) {
    case "held_page":
      return t(`admin.crm.script.${id}` as MessageKey, {
        count: f.tradeSearchesWeek,
        n: formatCount(f.tradeSearchesWeek),
        trade: f.trade,
        category: f.categoryName,
        area: f.areaName,
      });
    case "zero_result": {
      const count = id === "zero_result.alerts.v1" ? (f.alertsWaiting ?? 0) : f.searchesWeek;
      return t(`admin.crm.script.${id}` as MessageKey, { count, n: formatCount(count), category: f.categoryName });
    }
    case "unclaimed_demand":
      return t(`admin.crm.script.${id}` as MessageKey, { count: f.enquiries30d, n: formatCount(f.enquiries30d), days: String(SIGNAL_WINDOW_DAYS) });
    case "cap_reached":
      return t(`admin.crm.script.${id}` as MessageKey, {
        count: f.cap === "enquiry_cap" ? f.missedEnquiries30d : (f.refusedAttempted ?? 0),
        n: formatCount(f.cap === "enquiry_cap" ? f.missedEnquiries30d : (f.refusedAttempted ?? 0)),
        cap: f.refusedCap !== null ? formatCount(f.refusedCap) : "—",
        date: f.refusedAt ? formatDate(f.refusedAt) : "—",
        days: String(SIGNAL_WINDOW_DAYS),
      });
    case "churn_risk":
      return t(`admin.crm.script.${id}` as MessageKey, {
        count: f.replySample,
        counted: formatCount(f.replySample),
        unanswered: formatCount(unansweredOf(f)),
        days: String(WINDOW_DAYS),
        date: formatDate(f.renewsAt),
      });
  }
}

/** Q3: what the log says about this script, never a claim the log cannot back. */
export function scriptRecord(record: ScriptRecord | undefined): string {
  if (!record || record.calls === 0) return t("admin.crm.script_record.none");
  if (record.linksSent === 0) {
    return t("admin.crm.script_record.no_links", { count: record.calls, calls: formatCount(record.calls) });
  }
  return t("admin.crm.script_record.some", {
    count: record.calls,
    calls: formatCount(record.calls),
    claimed: formatCount(record.claimed),
    links: formatCount(record.linksSent),
  });
}

export function toRowView(row: CrmRow, scripts: CrmBoard["scripts"], now: Date): CallRowView {
  const why = whyOf(row);
  const touch = lastTouchOf(row, now);
  const metaParts = [row.licenceNumber, row.areaName].filter((part): part is string => Boolean(part));
  if (row.facts.kind === "churn_risk") metaParts.push(t("admin.crm.renews", { date: formatDateShort(row.facts.renewsAt) }));
  return {
    id: row.id,
    businessName: row.displayName,
    businessHref: `/admin/businesses/${row.businessId}`,
    meta: metaParts.join(" · "),
    phoneMasked: row.phoneMasked,
    why: why.text,
    whyTone: why.tone,
    listing: listingOf(row),
    lastTouch: touch.text,
    lastTouchTone: touch.tone,
    action: {
      label: t(`admin.crm.action.${row.action}` as MessageKey),
      variant: row.action === "save" ? "danger" : row.due ? "primary" : "secondary",
    },
    due: row.due,
    mine: row.mine,
    hasPhone: row.phoneMasked !== null,
    script: { text: scriptText(row), record: scriptRecord(scripts[row.scriptId as ScriptId]) },
  };
}

// ── The banner ───────────────────────────────────────────────────────────────

/**
 * The held page, stated so every number in it can be checked against the
 * others: listings, verified, the need and the floor, then the recruits that
 * close the supply gate and the figures after — and then the conditions
 * recruiting does not touch, because an ops lead who reads "22 calls unlocks
 * the page" will report the page unlocked (B3, B4).
 */
export function bannerView(banner: HeldScopeBanner): BannerView {
  const f = banner.facts;
  const gap = supplyGap(f);
  const share = f.listings === 0 ? 0 : f.verified / f.listings;
  const title =
    f.monthlySearches !== null
      ? t("admin.crm.banner.title", {
          count: f.listings,
          scope: `${f.areaName} ${f.categoryName}`,
          searches: formatCount(f.monthlySearches),
          listings: formatCount(f.listings),
          verified: formatCount(f.verified),
        })
      : t("admin.crm.banner.title_no_demand", {
          count: f.listings,
          scope: `${f.areaName} ${f.categoryName}`,
          listings: formatCount(f.listings),
          verified: formatCount(f.verified),
        });

  const listingsClause = gap.listingsPass
    ? t("admin.crm.banner.listings_pass", { need: formatCount(f.need) })
    : t("admin.crm.banner.listings_fail", { listings: formatCount(f.listings), need: formatCount(f.need) });
  const shareClause = gap.sharePass
    ? t("admin.crm.banner.share_pass", { share: formatPercent(share, { decimals: 0 }), floor: formatPercent(f.minVerifiedShare, { decimals: 0 }) })
    : t("admin.crm.banner.share_fail", { share: formatPercent(share, { decimals: 0 }), floor: formatPercent(f.minVerifiedShare, { decimals: 0 }) });

  const shareAfter = gap.listingsAfter === 0 ? 0 : gap.verifiedAfter / gap.listingsAfter;
  const figures = {
    add: formatCount(gap.listingsToAdd),
    addedVerified: formatCount(gap.addedVerified),
    verify: formatCount(gap.toVerify),
    unverified: formatCount(f.unverified),
    verifiedAfter: formatCount(gap.verifiedAfter),
    listingsAfter: formatCount(gap.listingsAfter),
    shareAfter: formatPercent(shareAfter, { decimals: 0 }),
  };
  let action: string;
  if (gap.listingsToAdd === 0 && gap.toVerify === 0) {
    action = t("admin.crm.banner.supply_clear");
  } else if (gap.listingsToAdd === 0) {
    action = t("admin.crm.banner.verify", { count: gap.toVerify, n: figures.verify, ...figures });
  } else if (gap.toVerify === 0 && gap.addedVerified === 0) {
    action = t("admin.crm.banner.add", { count: gap.listingsToAdd, ...figures });
  } else if (gap.addedVerified === 0) {
    action = t("admin.crm.banner.add_and_verify", { count: gap.toVerify, ...figures });
  } else if (gap.toVerify === 0) {
    action = t("admin.crm.banner.add_verified", { count: gap.addedVerified, ...figures });
  } else {
    action = t("admin.crm.banner.add_verified_and_verify", { count: gap.toVerify, ...figures });
  }

  const introShort = f.failing.includes("copy");
  const faqShort = f.failing.includes("faq");
  const supplyClear = gap.listingsToAdd === 0 && gap.toVerify === 0;
  const other = supplyClear
    ? introShort || faqShort
      ? t("admin.crm.banner.waits_on_content")
      : t("admin.crm.banner.other_none")
    : introShort && faqShort
      ? t("admin.crm.banner.other_copy_faq", { words: formatCount(f.minIntroWords) })
      : introShort
        ? t("admin.crm.banner.other_copy", { words: formatCount(f.minIntroWords) })
        : faqShort
          ? t("admin.crm.banner.other_faq")
          : t("admin.crm.banner.other_none");

  return {
    signalRef: banner.signalRef,
    title,
    body: `${listingsClause}, ${shareClause}. ${action}`,
    other,
    canBuild: banner.unassigned > 0,
    buildLabel: t("admin.crm.banner.build", { count: banner.unassigned, n: formatCount(banner.unassigned) }),
    mineNote: banner.mine > 0 ? t("admin.crm.banner.mine", { count: banner.mine, n: formatCount(banner.mine) }) : null,
    matrixHref: "/admin/content/matrix",
  };
}

// ── The whole view ───────────────────────────────────────────────────────────

export function presentCrm(board: CrmBoard, now: Date): CrmView {
  const w = board.week;
  const claimedShare = w.linksSent === 0 ? null : w.claimedAfterLink / w.linksSent;

  const lines: WeekLine[] = [
    { key: "calls", label: t("admin.crm.week.calls"), value: formatCount(w.callsMade), tone: "neutral" },
    { key: "links", label: t("admin.crm.week.links"), value: formatCount(w.linksSent), tone: "neutral" },
    {
      key: "claimed",
      label: t("admin.crm.week.claimed"),
      value:
        claimedShare === null
          ? t("admin.crm.week.none_sent")
          : t("admin.crm.week.of_share", {
              part: formatCount(w.claimedAfterLink),
              whole: formatCount(w.linksSent),
              share: formatPercent(claimedShare, { decimals: 0 }),
            }),
      tone: w.claimedAfterLink > 0 ? "ok" : "neutral",
    },
    { key: "upgraded", label: t("admin.crm.week.upgraded"), value: formatCount(w.upgraded), tone: w.upgraded > 0 ? "ok" : "neutral" },
    {
      key: "saved",
      label: t("admin.crm.week.saved"),
      value: t("admin.crm.week.of", { part: formatCount(w.churnSaved), whole: formatCount(w.churnClosed) }),
      tone: w.churnSaved > 0 ? "ok" : "neutral",
    },
    { key: "cleared", label: t("admin.crm.week.cleared"), value: formatCount(w.clearedBySignal), tone: "neutral" },
    { key: "wrong", label: t("admin.crm.week.wrong_numbers"), value: formatCount(w.wrongNumbers), tone: "neutral" },
  ];

  const refreshed = board.lastRun
    ? t("admin.crm.refreshed", {
        when: formatDateTime(board.lastRun.finishedAt),
        next: formatDateTime(board.nextRun),
        count: board.lastRun.derived,
        n: formatCount(board.lastRun.derived),
      })
    : t("admin.crm.never_refreshed", { next: formatDateTime(board.nextRun) });

  const tabNote =
    board.tab === "renewal"
      ? t("admin.crm.tab_note.renewal", {
          count: board.renewal.fourF,
          onList: formatCount(board.renewal.onList),
          fourF: formatCount(board.renewal.fourF),
          passed: formatCount(board.renewal.renewalPassed),
          rest: formatCount(Math.max(0, board.renewal.fourF - board.renewal.renewalPassed - board.renewal.onList)),
        })
      : board.tab === "upgrade"
        ? t("admin.crm.tab_note.upgrade", { days: String(SIGNAL_WINDOW_DAYS) })
        : null;

  return {
    rows: board.rows.map((row) => toRowView(row, board.scripts, now)),
    banner: board.banner ? bannerView(board.banner) : null,
    moreHeldScopes: board.moreHeldScopes > 0 ? t("admin.crm.banner.more", { count: board.moreHeldScopes, n: formatCount(board.moreHeldScopes) }) : null,
    week: { since: t("admin.crm.week.since", { date: formatDate(w.since) }), lines },
    headerCounts: t("admin.crm.assigned_to_me", { count: board.assignedToMe, n: formatCount(board.assignedToMe) }),
    listTitle: t(`admin.crm.list_title.${board.tab}` as MessageKey),
    listCount: t("admin.crm.due", { count: board.due, n: formatCount(board.due), total: formatCount(board.rows.length) }),
    heldByOthers: board.heldByOthers > 0 ? t("admin.crm.held_by_others", { count: board.heldByOthers, n: formatCount(board.heldByOthers) }) : null,
    empty: board.lastRun
      ? { title: t("admin.crm.empty.title"), body: refreshed, neverRun: false }
      : { title: t("admin.crm.empty.never_title"), body: t("admin.crm.never_refreshed", { next: formatDateTime(board.nextRun) }), neverRun: true },
    refreshed,
    tabNote,
  };
}
