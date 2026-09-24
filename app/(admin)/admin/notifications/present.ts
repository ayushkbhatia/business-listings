import type { NotificationChannel } from "@/lib/db/generated/enums";
import { formatCount, formatDate, formatList, formatRelative } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { EVENT_PARAMS } from "@/lib/notify/params";
import { BUYER_DEFAULT, PLATFORM_FLOOR } from "@/lib/notify/routing";
import type { TemplateBoard, TemplateDetail, TemplateRow, TemplateSort, VersionView } from "@/lib/notify/templates";
import type { Line, PrimaryState, TwinState } from "@/lib/notify/template-lines";

/**
 * Board 12g — every string on the templates screen, written from the board and
 * one template's detail.
 *
 * Pure, so the gallery renders the same function the console does: a figure
 * that does not derive in a specimen does not derive on the page either. The
 * components decide layout and nothing about what a number means.
 */

export type Tone = "ok" | "warn" | "bad" | "neutral";

export const CHANNEL_ORDER = ["whatsapp", "email", "sms", "in_app"] as const satisfies readonly NotificationChannel[];
export type ChannelFilter = "all" | NotificationChannel;

export interface Filters {
  channel: ChannelFilter;
  sort: TemplateSort;
  /** `event.channel` of the open template. */
  open: string | null;
  line: Line;
}

export function channelLabel(channel: NotificationChannel): string {
  return t(`notifications.channel.${channel}` as MessageKey);
}

/** A channel inside a sentence: "by email and in-app", not "by Email and In-app". */
export function channelWord(channel: NotificationChannel): string {
  return t(`notifications.channel_word.${channel}` as MessageKey);
}

export function hrefFor(filters: Filters, change: Partial<Filters>): string {
  const next = { ...filters, ...change };
  const params = new URLSearchParams();
  if (next.channel !== "all") params.set("channel", next.channel);
  if (next.sort !== "volume") params.set("sort", next.sort);
  if (next.open) params.set("t", next.open);
  if (next.line === "services") params.set("line", "services");
  const query = params.toString();
  return `/admin/notifications${query ? `?${query}` : ""}`;
}

export function readFilters(raw: { channel?: string; sort?: string; t?: string; line?: string }): Filters {
  const channel = (CHANNEL_ORDER as readonly string[]).includes(raw.channel ?? "") ? (raw.channel as NotificationChannel) : "all";
  const sort: TemplateSort = raw.sort === "key" || raw.sort === "twin" ? raw.sort : "volume";
  const open = raw.t && /^[a-z_]+\.(whatsapp|email|sms|in_app)$/.test(raw.t) ? raw.t : null;
  return { channel, sort, open, line: raw.line === "services" ? "services" : "primary" };
}

// ── The list ──────────────────────────────────────────────────────────────────

export interface RowView {
  key: string;
  event: string;
  channel: string;
  firedBy: string;
  firedByTone: Tone;
  sent: string;
  /** "412 suppressed · 3 failed", or null when both are zero. */
  notSent: string | null;
  twin: string;
  twinTone: Tone;
  /** A chip where the twin is owed and nothing about it is in motion. */
  twinChip: boolean;
  state: string;
  stateTone: Tone;
  href: string;
  selected: boolean;
  openLabel: string;
}

const TWIN_TONE: Record<TwinState, Tone> = {
  neutral: "neutral",
  not_written: "bad",
  written: "ok",
  in_review: "warn",
  rejected: "bad",
  draft: "warn",
  no_body: "neutral",
};

const STATE_TONE: Record<PrimaryState, Tone> = {
  live: "ok",
  in_review: "warn",
  rejected: "bad",
  draft: "warn",
  retired: "neutral",
  missing: "bad",
};

export interface BoardView {
  chips: { key: ChannelFilter; label: string; count: string; href: string; selected: boolean }[];
  sortOptions: { value: TemplateSort; label: string }[];
  meta: string;
  rows: RowView[];
  footnote: string;
  empty: { title: string; body: string } | null;
}

export function presentBoard(board: TemplateBoard, filters: Filters, sorted: readonly TemplateRow[]): BoardView {
  const shown = filters.channel === "all" ? sorted : sorted.filter((row) => row.channel === filters.channel);
  const { counts } = board;

  const chips: BoardView["chips"] = [
    { key: "all", label: t("notifications.filter.all"), count: formatCount(counts.templates), href: hrefFor(filters, { channel: "all", open: null, line: "primary" }), selected: filters.channel === "all" },
    ...CHANNEL_ORDER.map((channel) => ({
      key: channel,
      label: channelLabel(channel),
      count: formatCount(counts.byChannel[channel]),
      href: hrefFor(filters, { channel, open: null, line: "primary" }),
      selected: filters.channel === channel,
    })),
  ];

  const rows = shown.map((row): RowView => {
    const k = `${row.event}.${row.channel}`;
    const notSent = [
      row.volume.suppressed > 0 ? t("notifications.row.suppressed", { count: formatCount(row.volume.suppressed) }) : null,
      row.volume.failed > 0 ? t("notifications.row.failed", { count: formatCount(row.volume.failed) }) : null,
    ].filter(Boolean);
    return {
      key: k,
      event: row.event,
      channel: channelLabel(row.channel),
      firedBy: row.firedBy.length > 0 ? row.firedBy.join(" · ") : t("notifications.row.no_sender"),
      firedByTone: row.firedBy.length > 0 ? "neutral" : "warn",
      sent: formatCount(row.volume.sent),
      notSent: notSent.length > 0 ? notSent.join(" · ") : null,
      twin: t(`notifications.twin.${row.twin}` as MessageKey),
      twinTone: TWIN_TONE[row.twin],
      twinChip: row.twin === "not_written" || row.twin === "rejected",
      state: t(`notifications.state.${row.state}` as MessageKey),
      stateTone: STATE_TONE[row.state],
      // To the rail by anchor: below 1440px it sits under the list, and a row that
      // opened a template off screen would look like a row that did nothing.
      href: `${hrefFor(filters, { open: k, line: "primary" })}#template`,
      selected: filters.open === k,
      openLabel: t("notifications.row.open", { event: row.event, channel: channelLabel(row.channel) }),
    };
  });

  const footnote = [
    shown.length === counts.templates
      ? t("notifications.foot.all", { count: formatCount(counts.templates), sort: t(`notifications.sort.${filters.sort}` as MessageKey).toLowerCase() })
      : t("notifications.foot.some", { shown: formatCount(shown.length), count: formatCount(counts.templates), sort: t(`notifications.sort.${filters.sort}` as MessageKey).toLowerCase() }),
    counts.twinsLive === 0 ? t("notifications.foot.no_twins") : t("notifications.foot.twins", { count: counts.twinsLive }),
    t("notifications.foot.owed", { count: counts.owesTwin }),
    t("notifications.foot.neutral", { count: counts.neutral }),
    t("notifications.foot.paired"),
    counts.missing > 0 ? t("notifications.foot.missing", { count: counts.missing }) : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    chips,
    sortOptions: (["volume", "twin", "key"] as const).map((value) => ({ value, label: t(`notifications.sort.${value}` as MessageKey) })),
    meta: t("notifications.meta", { templates: formatCount(counts.templates), channels: formatCount(CHANNEL_ORDER.length) }),
    rows,
    footnote,
    empty:
      shown.length === 0
        ? filters.channel === "all"
          ? { title: t("notifications.empty.title"), body: t("notifications.empty.body") }
          : { title: t("notifications.empty.channel_title", { channel: channelLabel(filters.channel) }), body: t("notifications.empty.channel_body") }
        : null,
  };
}

// ── One template ──────────────────────────────────────────────────────────────

export interface Panel {
  tone: "warn" | "bad" | "neutral";
  eyebrow: string;
  body: string[];
}

export interface VariableView {
  name: string;
  used: boolean;
}

export interface HistoryRow {
  id: string;
  version: string;
  line: string;
  status: string;
  statusTone: Tone;
  by: string;
  when: string;
  note: string | null;
  canPublish: boolean;
}

export interface DetailView {
  key: string;
  event: string;
  channel: NotificationChannel;
  channelLabel: string;
  line: Line;
  lineTabs: { line: Line; label: string; href: string; selected: boolean }[] | null;
  versionsMeta: string;
  heading: string;
  variables: VariableView[];
  variablesLabel: string;
  privacyNote: string;
  dormant: string | null;
  meta: Panel | null;
  pendingId: string | null;
  twinPanel: (Panel & { href: string | null; action: string | null }) | null;
  optOut: Panel;
  history: HistoryRow[];
  /** The version `Send test to me` sends, and why not when it cannot. */
  testable: { id: string; label: string } | null;
  testBlocked: string | null;
  saveLabel: string;
  saveHint: string;
  canNeutral: boolean;
  neutralLocked: string | null;
  neutralDefault: boolean;
  basedOn: number | null;
}

const STATUS_TONE: Record<VersionView["status"], Tone> = {
  live: "ok",
  pending_meta: "warn",
  draft: "warn",
  rejected: "bad",
  retired: "neutral",
  superseded: "neutral",
};

export function presentDetail(detail: TemplateDetail, filters: Filters, now: Date, servicesInGoodsWording: number): DetailView {
  const key = `${detail.event}.${detail.channel}`;
  const whatsapp = detail.channel === "whatsapp";
  const { live, pending, rejected, head, line } = detail;

  const versionsMeta = [
    live ? t("notifications.detail.live_version", { version: String(live.version) }) : t("notifications.detail.nothing_live"),
    pending ? t("notifications.detail.pending_version", { version: String(pending.version) }) : null,
    rejected ? t("notifications.detail.rejected_version", { version: String(rejected.version) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const lineTabs =
    detail.primaryKind === "goods"
      ? (["primary", "services"] as const).map((l) => ({
          line: l,
          label: t(`notifications.line.${l}` as MessageKey),
          href: hrefFor(filters, { open: key, line: l }),
          selected: line === l,
        }))
      : null;

  const used = new Set(
    [detail.seed.body, detail.seed.subject, detail.seed.actionLabel, detail.seed.actionPath]
      .filter((part): part is string => !!part)
      .flatMap((part) => [...part.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]!)),
  );

  let meta: Panel | null = null;
  if (whatsapp && pending) {
    const submitted = pending.submittedAt;
    const first = live
      ? submitted
        ? t("notifications.meta_panel.pending_live", {
            live: String(live.version),
            pending: String(pending.version),
            submitted: formatDate(submitted),
            elapsed: formatRelative(submitted, { now }),
          })
        : t("notifications.meta_panel.pending_live_undated", { live: String(live.version), pending: String(pending.version) })
      : submitted
        ? t("notifications.meta_panel.pending_none", { pending: String(pending.version), submitted: formatDate(submitted) })
        : t("notifications.meta_panel.pending_none_undated", { pending: String(pending.version) });
    meta = { tone: "warn", eyebrow: t("notifications.meta_panel.eyebrow"), body: [first, t("notifications.meta_panel.others")] };
  } else if (whatsapp && rejected) {
    meta = {
      tone: "bad",
      eyebrow: t("notifications.meta_panel.rejected_eyebrow"),
      body: [
        t("notifications.meta_panel.rejected", {
          version: String(rejected.version),
          note: rejected.metaNote ?? t("notifications.meta_panel.no_note"),
        }),
        live ? t("notifications.meta_panel.rejected_live", { version: String(live.version) }) : t("notifications.meta_panel.rejected_none"),
      ],
    };
  } else if (whatsapp) {
    meta = { tone: "neutral", eyebrow: t("notifications.meta_panel.eyebrow"), body: [t("notifications.meta_panel.idle")] };
  }

  let twinPanel: DetailView["twinPanel"] = null;
  if (line === "primary" && detail.primaryKind === "goods" && (detail.twin === "not_written" || detail.twin === "rejected" || detail.twin === "draft")) {
    twinPanel = {
      tone: "bad",
      eyebrow: t("notifications.twin_panel.eyebrow"),
      body: [
        detail.audience === "buyer" ? t("notifications.twin_panel.body_buyer") : t("notifications.twin_panel.body_seller"),
        servicesInGoodsWording > 0
          ? t("notifications.twin_panel.measured", { count: formatCount(servicesInGoodsWording) })
          : t("notifications.twin_panel.unmeasured"),
      ],
      href: hrefFor(filters, { open: key, line: "services" }),
      action: t("notifications.twin_panel.action"),
    };
  } else if (line === "primary" && detail.twin === "in_review") {
    twinPanel = { tone: "neutral", eyebrow: t("notifications.twin_panel.eyebrow_review"), body: [t("notifications.twin_panel.in_review")], href: hrefFor(filters, { open: key, line: "services" }), action: t("notifications.twin_panel.open") };
  } else if (line === "services" && detail.primaryLive) {
    twinPanel = {
      tone: "neutral",
      eyebrow: t("notifications.twin_panel.goods_eyebrow", { version: String(detail.primaryLive.version) }),
      body: [detail.primaryLive.body],
      href: null,
      action: null,
    };
  }

  const floor = PLATFORM_FLOOR[detail.event] ?? [];
  const optOut: Panel = {
    tone: "neutral",
    eyebrow: t("notifications.opt_out.eyebrow"),
    body:
      detail.audience === "seller"
        ? [
            t("notifications.opt_out.seller"),
            floor.length > 0
              ? t("notifications.opt_out.floor_this", { channels: floor.map(channelWord).join(t("notifications.and")) })
              : t("notifications.opt_out.floor_list", {
                  // Counted, not written: this said "Two messages" over a list
                  // that had grown to three, and board `1n` adds two more.
                  count: Object.keys(PLATFORM_FLOOR).length,
                  events: formatList(
                    Object.keys(PLATFORM_FLOOR).map((event) => t(`notifications.floor_event.${event}` as MessageKey)),
                  ),
                }),
            t("notifications.opt_out.no_report"),
          ]
        : [
            t("notifications.opt_out.buyer", {
              channels: (BUYER_DEFAULT.matrix[detail.event] ?? []).map(channelWord).join(t("notifications.and")) || t("notifications.opt_out.buyer_none"),
              from: String(BUYER_DEFAULT.quiet.fromHour).padStart(2, "0"),
              to: String(BUYER_DEFAULT.quiet.toHour).padStart(2, "0"),
            }),
          ],
  };

  // Newest first, as the caption says: by when each was written, then by version within a line.
  const newestFirst = [...detail.versions].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.version - a.version || a.id.localeCompare(b.id),
  );
  const history: HistoryRow[] = newestFirst.map((v) => ({
    id: v.id,
    version: `v${v.version}`,
    line: t(`notifications.kind.${v.kind}` as MessageKey),
    status: t(`notifications.status.${v.status}` as MessageKey),
    statusTone: STATUS_TONE[v.status],
    by: v.createdBy ?? t("notifications.history.seeded"),
    when: formatDate(v.createdAt),
    note: v.metaNote,
    canPublish: v.status === "draft",
  }));

  const testTarget = whatsapp ? live : (live ?? head);
  const testable = testTarget ? { id: testTarget.id, label: t("notifications.test.label", { version: String(testTarget.version) }) } : null;
  const testBlocked = testable ? null : whatsapp ? t("notifications.test.blocked_whatsapp") : t("notifications.test.blocked_none");

  const twinExists = detail.versions.some((v) => v.kind === "services" && (v.status === "live" || v.status === "pending_meta" || v.status === "draft"));

  return {
    key,
    event: detail.event,
    channel: detail.channel,
    channelLabel: channelLabel(detail.channel),
    line,
    lineTabs,
    versionsMeta,
    heading: t("notifications.detail.heading", { event: detail.event, channel: channelLabel(detail.channel) }),
    variables: EVENT_PARAMS[detail.event].map((name) => ({ name, used: used.has(name) })),
    variablesLabel: t("notifications.detail.variables", { count: formatCount(EVENT_PARAMS[detail.event].length) }),
    privacyNote: t("notifications.detail.privacy"),
    dormant: detail.emitted ? null : t("notifications.detail.dormant"),
    meta,
    pendingId: whatsapp ? (pending?.id ?? null) : null,
    twinPanel,
    optOut,
    history,
    testable,
    testBlocked,
    saveLabel: whatsapp
      ? t("notifications.save.whatsapp", { version: String(detail.nextVersion) })
      : t("notifications.save.live", { version: String(detail.nextVersion) }),
    saveHint: whatsapp ? t("notifications.save.hint_whatsapp") : t("notifications.save.hint_live"),
    canNeutral: line === "primary",
    neutralLocked: line === "primary" && twinExists ? t("notifications.neutral.locked") : null,
    neutralDefault: detail.primaryKind === "neutral",
    basedOn: head?.version ?? null,
  };
}
