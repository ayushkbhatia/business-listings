import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { NotificationEvent as EVENTS_THIS_BUILD_READS } from "@/lib/db/generated/enums";
import type { NotificationChannel, NotificationEvent } from "@/lib/db/generated/enums";
import { absoluteUrl, siteUrl } from "@/lib/site";
import { CHANNELS, draftProblems, type DraftInput, type TemplateRefusal } from "./draft";
import { EVENT_AUDIENCE, EVENT_PARAMS, EVENT_SOURCES, isEmitted, sampleParams, type Audience } from "./params";
import { render } from "./render";
import { resolveNotificationSenders } from "./senders";
import {
  headOf,
  lineOf,
  liveOf,
  nextVersion,
  pendingOf,
  primaryKind,
  primaryState,
  rejectedOf,
  twinState,
  type Line,
  type PrimaryState,
  type TemplateKind,
  type TemplateStatus,
  type TwinState,
} from "./template-lines";

/**
 * Board 12g — notification templates.
 *
 * The words the platform sends, over a mechanism that is already live:
 * `lib/notify/service.ts` and `events.ts` read these rows and send what they
 * say. So every edit is a new version rather than an overwrite — a delivery row
 * points at the version that produced it, and editing in place would make what
 * a seller was sent last week become what the template says today — and every
 * one is audited.
 *
 * Four rules this file holds, each a build note:
 *
 *   - `B1` Volume is a query over `NotificationDelivery`. Nothing here stores a count.
 *   - `B2` A body may use only what its event supplies, and names none it may never carry (`B3`).
 *   - `B4` A WhatsApp save goes to Meta and never touches the live copy. Email, SMS and
 *          in-app are live on save.
 *   - `B5` A goods body and its services twin are two lines, and *no trade-kind
 *          language* is a third state that owes nothing.
 */

const LOCALE = "en";
const WINDOW_DAYS = 30;
const DAY = 86_400_000;
/** `Send test to me` is a real send — on WhatsApp, a billed one. Five in ten minutes per person. */
const TEST_LIMIT = 5;
const TEST_WINDOW_MS = 10 * 60_000;

export { CHANNELS, type TemplateRefusal } from "./draft";

// ── Refusals ──────────────────────────────────────────────────────────────────

export type TemplateResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: TemplateRefusal; detail?: Record<string, string> };

function refuse(error: TemplateRefusal, detail?: Record<string, string>): { ok: false; error: TemplateRefusal; detail?: Record<string, string> } {
  return detail ? { ok: false, error, detail } : { ok: false, error };
}

/** Thrown inside an audited transaction so a write that matched nothing is not audited. */
class Refused extends Error {
  constructor(
    readonly error: TemplateRefusal,
    readonly detail?: Record<string, string>,
  ) {
    super(error);
  }
}

// ── The list ──────────────────────────────────────────────────────────────────

export interface TemplateVolume {
  /** Sent to a real recipient in the window. Never a test. */
  sent: number;
  /** Not sent on purpose: a channel switched off, no verified address, no template. */
  suppressed: number;
  failed: number;
  /** About a services brief, and sent through a goods body because no twin was live. */
  servicesInGoodsWording: number;
}

export interface TemplateRow {
  event: NotificationEvent;
  channel: NotificationChannel;
  audience: Audience;
  firedBy: readonly string[];
  /** False where nothing in the codebase sends the event. */
  emitted: boolean;
  state: PrimaryState;
  twin: TwinState;
  liveVersion: number | null;
  pendingVersion: number | null;
  volume: TemplateVolume;
}

export interface TemplateBoard {
  rows: TemplateRow[];
  since: Date;
  /** Every figure below is a count of `rows`, so the header and the table cannot disagree. */
  counts: {
    templates: number;
    byChannel: Record<NotificationChannel, number>;
    owesTwin: number;
    neutral: number;
    twinsLive: number;
    missing: number;
  };
}

type Row = {
  id: string;
  event: NotificationEvent;
  channel: NotificationChannel;
  kind: TemplateKind;
  version: number;
  status: TemplateStatus;
};

const key = (event: string, channel: string) => `${event}.${channel}`;

/**
 * Every template, one row per event and channel, with its volume.
 *
 * A pair is on the list when it has any version, **or** when something fired
 * the event on that channel in the window and found no template — the
 * `missing` state. That is `FIRED BY`'s second direction: *"a screen that sends
 * something with no template here is a message nobody has read"*, and the
 * delivery log already records it as `no_live_template`, so it is read rather
 * than asserted.
 */
export async function templateBoard(now: Date = new Date()): Promise<TemplateBoard> {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY);
  /*
     Only the events this build's client can read. A board that adds an event
     applies its enum value and its templates before the merge that sends them
     (`docs/deployments.md` § Ordering), and the deployed client cannot
     deserialize a row carrying a value its schema lacks — Prisma refuses the
     whole read (*Value 'quote_declined' not found in enum*), and this board
     500s until the new code is live. Scoped in the query, rows the running
     code cannot send stay off the board until the deploy that can.
  */
  const known = { in: Object.values(EVENTS_THIS_BUILD_READS) };

  const [rows, grouped, orphaned] = await Promise.all([
    prisma.notificationTemplate.findMany({
      where: { locale: LOCALE, event: known },
      select: { id: true, event: true, channel: true, kind: true, version: true, status: true },
      orderBy: [{ event: "asc" }, { channel: "asc" }, { kind: "asc" }, { version: "desc" }, { id: "asc" }],
    }),
    prisma.notificationDelivery.groupBy({
      by: ["templateId", "status", "tradeKind"],
      where: { createdAt: { gte: since }, test: false, templateId: { not: null } },
      _count: { _all: true },
    }),
    prisma.notificationDelivery.groupBy({
      by: ["event", "channel"],
      where: { createdAt: { gte: since }, test: false, templateId: null, event: known },
      _count: { _all: true },
    }),
  ]);

  const byPair = new Map<string, Row[]>();
  const pairOf = new Map<string, string>();
  for (const row of rows) {
    const k = key(row.event, row.channel);
    const list = byPair.get(k) ?? [];
    list.push(row);
    byPair.set(k, list);
    pairOf.set(row.id, k);
  }

  const volume = new Map<string, TemplateVolume>();
  const bump = (k: string): TemplateVolume => {
    const v = volume.get(k) ?? { sent: 0, suppressed: 0, failed: 0, servicesInGoodsWording: 0 };
    volume.set(k, v);
    return v;
  };
  const kindOf = new Map(rows.map((row) => [row.id, row.kind]));
  for (const group of grouped) {
    const k = group.templateId ? pairOf.get(group.templateId) : undefined;
    if (!k) continue;
    const v = bump(k);
    const n = group._count._all;
    if (group.status === "sent") {
      v.sent += n;
      if (group.tradeKind === "services" && kindOf.get(group.templateId!) === "goods") v.servicesInGoodsWording += n;
    } else if (group.status === "skipped") v.suppressed += n;
    else if (group.status === "failed") v.failed += n;
  }
  // Deliveries with no template are suppressions by definition: nothing could be rendered.
  for (const group of orphaned) bump(key(group.event, group.channel)).suppressed += group._count._all;

  const pairs = new Set([...byPair.keys(), ...orphaned.map((g) => key(g.event, g.channel))]);

  const out: TemplateRow[] = [...pairs].map((k) => {
    const [event, channel] = k.split(".") as [NotificationEvent, NotificationChannel];
    const versions = byPair.get(k) ?? [];
    return {
      event,
      channel,
      audience: EVENT_AUDIENCE[event],
      firedBy: EVENT_SOURCES[event],
      emitted: isEmitted(event),
      state: primaryState(versions),
      twin: twinState(versions),
      liveVersion: liveOf(versions, "primary")?.version ?? null,
      pendingVersion: pendingOf(versions, "primary")?.version ?? null,
      volume: volume.get(k) ?? { sent: 0, suppressed: 0, failed: 0, servicesInGoodsWording: 0 },
    };
  });

  const byChannel = Object.fromEntries(CHANNELS.map((c) => [c, out.filter((r) => r.channel === c).length])) as Record<
    NotificationChannel,
    number
  >;

  return {
    rows: out,
    since,
    counts: {
      templates: out.length,
      byChannel,
      owesTwin: out.filter((r) => r.twin !== "neutral" && r.twin !== "written" && r.twin !== "no_body").length,
      neutral: out.filter((r) => r.twin === "neutral").length,
      twinsLive: out.filter((r) => r.twin === "written").length,
      missing: out.filter((r) => r.state === "missing").length,
    },
  };
}

export type TemplateSort = "volume" | "key" | "twin";

/**
 * The list's order. Volume first, as drawn, and ties broken on the key so the
 * order is total — a list that reshuffles equal rows between two loads is a
 * list somebody cannot scan twice.
 */
export function sortRows(rows: readonly TemplateRow[], sort: TemplateSort): TemplateRow[] {
  const byKey = (a: TemplateRow, b: TemplateRow) =>
    a.event.localeCompare(b.event) || CHANNELS.indexOf(a.channel) - CHANNELS.indexOf(b.channel);
  const owes = (r: TemplateRow) => (r.twin === "neutral" || r.twin === "written" || r.twin === "no_body" ? 1 : 0);
  return [...rows].sort((a, b) => {
    if (sort === "volume") return b.volume.sent - a.volume.sent || byKey(a, b);
    if (sort === "twin") return owes(a) - owes(b) || b.volume.sent - a.volume.sent || byKey(a, b);
    return byKey(a, b);
  });
}

// ── One template ──────────────────────────────────────────────────────────────

export interface VersionView {
  id: string;
  kind: TemplateKind;
  line: Line;
  version: number;
  status: TemplateStatus;
  subject: string | null;
  body: string;
  actionLabel: string | null;
  actionPath: string | null;
  metaTemplateName: string | null;
  metaNote: string | null;
  submittedAt: Date | null;
  decidedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
}

export interface TemplateDetail {
  event: NotificationEvent;
  channel: NotificationChannel;
  audience: Audience;
  firedBy: readonly string[];
  emitted: boolean;
  /** What the event supplies. The declaration lives in `params.ts`, bound to the call sites by type. */
  variables: readonly string[];
  line: Line;
  primaryKind: "goods" | "neutral" | null;
  twin: TwinState;
  live: VersionView | null;
  pending: VersionView | null;
  rejected: VersionView | null;
  /** The newest version in the line being edited, for the stale-save check. */
  head: VersionView | null;
  /** What the editor opens with. */
  seed: Pick<VersionView, "subject" | "body" | "actionLabel" | "actionPath" | "metaTemplateName">;
  nextVersion: number;
  versions: VersionView[];
  /** The live primary body, for a twin being written from scratch to be read beside. */
  primaryLive: VersionView | null;
  /** The origin samples link to, so a preview's link is this deployment's. */
  origin: string;
}

export async function templateDetail(
  event: NotificationEvent,
  channel: NotificationChannel,
  line: Line,
): Promise<TemplateDetail | null> {
  if (!(event in EVENT_PARAMS) || !(CHANNELS as readonly string[]).includes(channel)) return null;

  const rows = await prisma.notificationTemplate.findMany({
    where: { event, channel, locale: LOCALE },
    orderBy: [{ kind: "asc" }, { version: "desc" }, { id: "asc" }],
  });

  const authors = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.createdById).filter((id): id is string => !!id))] } },
        select: { id: true, fullName: true, email: true },
      })
    ).map((user) => [user.id, user.fullName ?? user.email ?? null]),
  );

  const views: VersionView[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    line: lineOf(row.kind),
    version: row.version,
    status: row.status,
    subject: row.subject,
    body: row.body,
    actionLabel: row.actionLabel,
    actionPath: row.actionPath,
    metaTemplateName: row.metaTemplateName,
    metaNote: row.metaNote,
    submittedAt: row.submittedAt,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    createdBy: row.createdById ? (authors.get(row.createdById) ?? null) : null,
  }));

  const live = liveOf(views, line);
  const pending = pendingOf(views, line);
  const rejected = rejectedOf(views, line);
  const head = headOf(views, line);
  const primaryLive = liveOf(views, "primary") ?? headOf(views, "primary");
  /*
     The editor opens on the words most likely to be edited next: what is with
     Meta, else what Meta refused, else what sends, else the newest. A twin with
     no rows opens on the goods body it has to replace — the brief is to rewrite
     those words for a different trade, and a blank box would hide what they were.
  */
  const opener = pending ?? rejected ?? live ?? head ?? (line === "services" ? primaryLive : null);

  return {
    event,
    channel,
    audience: EVENT_AUDIENCE[event],
    firedBy: EVENT_SOURCES[event],
    emitted: isEmitted(event),
    variables: EVENT_PARAMS[event],
    line,
    primaryKind: primaryKind(views),
    twin: twinState(views),
    live,
    pending,
    rejected,
    head,
    seed: {
      subject: opener?.subject ?? null,
      body: opener?.body ?? "",
      actionLabel: opener?.actionLabel ?? null,
      actionPath: opener?.actionPath ?? null,
      metaTemplateName:
        channel === "whatsapp" ? suggestMetaName(event, line, nextVersion(views, line), views) : null,
    },
    nextVersion: nextVersion(views, line),
    versions: views,
    primaryLive: line === "services" ? primaryLive : null,
    origin: siteUrl(),
  };
}

/**
 * A Meta template name nobody has used yet: `bl_<event>[_services]_v<n>`.
 *
 * Meta approves a name and its wording together, so a new wording under an old
 * name is either refused or — worse — approved as an edit to the template every
 * earlier version was sent under. A fresh name per submission is the safe
 * default, and staff can still type another.
 */
function suggestMetaName(event: string, line: Line, version: number, views: readonly VersionView[]): string {
  const used = new Set(views.map((v) => v.metaTemplateName).filter(Boolean));
  let n = version;
  let name = `bl_${event}${line === "services" ? "_services" : ""}_v${n}`;
  while (used.has(name)) name = `bl_${event}${line === "services" ? "_services" : ""}_v${++n}`;
  return name;
}

// ── Saving a version ──────────────────────────────────────────────────────────

export interface SaveVersionInput {
  actor: Actor;
  event: NotificationEvent;
  channel: NotificationChannel;
  line: Line;
  /** Primary line only: the body says nothing about trade kind. */
  neutral?: boolean;
  subject?: string | null;
  body: string;
  actionLabel?: string | null;
  actionPath?: string | null;
  metaTemplateName?: string | null;
  /** The newest version in the line when the editor opened. A save against an older head is refused. */
  basedOn: number | null;
  reason: string;
}

/**
 * Save a new version. `B4`: WhatsApp goes to Meta, everything else goes live.
 *
 * - **WhatsApp.** The new version is `pending_meta`. The live version is not
 *   touched and keeps sending until Meta's approval is recorded. A version
 *   already with Meta in the same line is `superseded` — `Q1`: v5 takes v4's
 *   place in the queue, and there is never more than one pending version of a
 *   body to approve by mistake.
 * - **Email, SMS, in-app.** The new version is `live`, the previous live one is
 *   `retired`, and any draft is `superseded`, in one transaction.
 *
 * Serialised per template by an advisory lock, and refused as `stale` when the
 * newest version is not the one the editor opened on: two people saving the
 * same body would otherwise each create a version, and the second would retire
 * the first without either of them seeing it.
 */
export async function saveTemplateVersion(
  input: SaveVersionInput,
): Promise<TemplateResult<{ id: string; version: number; status: TemplateStatus }>> {
  assertCan(input.actor, "notification.template.write");
  if (!(input.event in EVENT_PARAMS) || !(CHANNELS as readonly string[]).includes(input.channel)) return refuse("not_found");

  const draft: DraftInput = {
    event: input.event,
    channel: input.channel,
    subject: input.channel === "email" ? input.subject?.trim() || null : null,
    body: input.body.trim(),
    actionLabel: input.actionLabel?.trim() || null,
    actionPath: input.actionPath?.trim() || null,
    metaTemplateName: input.channel === "whatsapp" ? input.metaTemplateName?.trim() || null : null,
  };
  const problem = draftProblems(draft, siteUrl())[0];
  if (problem) return refuse(problem.error, problem.detail);

  const whatsapp = input.channel === "whatsapp";
  const kind: TemplateKind = input.line === "services" ? "services" : input.neutral ? "neutral" : "goods";
  const action = whatsapp ? "notification_template_submitted" : "notification_template_saved";

  try {
    const saved = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`notification_template:${input.event}:${input.channel}`}))`;

      const rows = await tx.notificationTemplate.findMany({
        where: { event: input.event, channel: input.channel, locale: LOCALE },
        select: { id: true, kind: true, version: true, status: true, body: true, subject: true, actionLabel: true, actionPath: true, metaTemplateName: true },
        orderBy: [{ kind: "asc" }, { version: "desc" }, { id: "asc" }],
      });

      const head = headOf(rows, input.line);
      if ((head?.version ?? null) !== input.basedOn) throw new Refused("stale", { version: String(head?.version ?? 0) });

      if (input.line === "services") {
        if (primaryKind(rows) !== "goods") throw new Refused("twin_without_goods_body");
      } else if (kind === "neutral") {
        const twin = rows.find((r) => r.kind === "services" && r.status !== "retired" && r.status !== "superseded" && r.status !== "rejected");
        if (twin) throw new Refused("neutral_with_twin");
      }

      if (
        head &&
        head.kind === kind &&
        head.body === draft.body &&
        (head.subject ?? null) === draft.subject &&
        (head.actionLabel ?? null) === draft.actionLabel &&
        (head.actionPath ?? null) === draft.actionPath &&
        (!whatsapp || head.metaTemplateName === draft.metaTemplateName)
      ) {
        throw new Refused("unchanged");
      }

      // A twin identical to the goods body it replaces is the goods body again, under a services label.
      if (!head && input.line === "services") {
        const goods = liveOf(rows, "primary");
        if (goods && goods.body === draft.body && (goods.subject ?? null) === draft.subject) throw new Refused("unchanged");
      }

      if (whatsapp && draft.metaTemplateName) {
        /*
           Across every template, not only this one. Meta holds one wording per
           name for the whole business account, so `bl_quote_accepted_v2` reused
           on another event is the same collision as reusing it here.
        */
        const clash = await tx.notificationTemplate.findFirst({
          where: { channel: "whatsapp", metaTemplateName: draft.metaTemplateName, NOT: { body: draft.body } },
          select: { id: true },
        });
        if (clash) throw new Refused("meta_name_taken", { name: draft.metaTemplateName });
      }

      const version = nextVersion(rows, input.line);
      const now = new Date();
      const sameLine = rows.filter((r) => lineOf(r.kind) === input.line);

      return staffMutation(
        {
          actor: input.actor,
          capability: "notification.template.write",
          action,
          subject: `NotificationTemplate:${input.event}.${input.channel}.${input.line}`,
          reason: input.reason,
          tx,
        },
        async () => {
          // A version with Meta or a draft nobody published, replaced by this one before either sent.
          const replaced = sameLine.filter((r) => r.status === "pending_meta" || r.status === "draft");
          if (replaced.length > 0) {
            await tx.notificationTemplate.updateMany({ where: { id: { in: replaced.map((r) => r.id) } }, data: { status: "superseded" } });
          }
          const previousLive = liveOf(sameLine, input.line);
          if (!whatsapp && previousLive) {
            await tx.notificationTemplate.updateMany({
              where: { id: { in: sameLine.filter((r) => r.status === "live").map((r) => r.id) } },
              data: { status: "retired" },
            });
          }
          const created = await tx.notificationTemplate.create({
            data: {
              event: input.event,
              channel: input.channel,
              locale: LOCALE,
              kind,
              version,
              status: whatsapp ? "pending_meta" : "live",
              subject: draft.subject,
              body: draft.body,
              actionLabel: draft.actionLabel,
              actionPath: draft.actionPath,
              metaTemplateName: draft.metaTemplateName,
              submittedAt: whatsapp ? now : null,
              createdById: input.actor.id,
            },
            select: { id: true, version: true, status: true },
          });
          return {
            result: created,
            before: {
              live: previousLive ? `v${previousLive.version}` : null,
              superseded: replaced.map((r) => `v${r.version}`),
            },
            after: { version: `v${created.version}`, kind, status: created.status },
          };
        },
      );
    });
    return { ok: true, id: saved.id, version: saved.version, status: saved.status };
  } catch (error) {
    if (error instanceof Refused) return refuse(error.error, error.detail);
    throw error;
  }
}

// ── Meta's answer ─────────────────────────────────────────────────────────────

export interface MetaDecisionInput {
  actor: Actor;
  templateId: string;
  decision: "approved" | "rejected";
  /** Meta's reason, required on a rejection and shown against the draft. */
  metaNote?: string | null;
  reason: string;
}

/**
 * Record what Meta decided about a pending WhatsApp version.
 *
 * A person records it because there is no Meta integration to do so: Bird
 * relays sends, not template reviews. The audit row says who read Meta's answer
 * and typed it in. An approval puts the version live and retires the one it
 * replaces; a rejection keeps the live version sending and puts Meta's reason
 * beside the refused words.
 *
 * Conditional on the version still being `pending_meta`, inside the audited
 * transaction: two people recording at once get one decision and one refusal,
 * and the refusal writes no audit row.
 */
export async function recordMetaDecision(
  input: MetaDecisionInput,
): Promise<TemplateResult<{ status: TemplateStatus }>> {
  assertCan(input.actor, "notification.template.write");
  const note = input.metaNote?.trim() ?? "";
  if (input.decision === "rejected" && note.length < 4) return refuse("rejection_needs_note");

  const template = await prisma.notificationTemplate.findUnique({
    where: { id: input.templateId },
    select: { id: true, event: true, channel: true, kind: true, version: true, status: true, locale: true },
  });
  if (!template || template.channel !== "whatsapp") return refuse("not_found");
  const line = lineOf(template.kind);

  try {
    const status = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`notification_template:${template.event}:${template.channel}`}))`;
      return staffMutation(
        {
          actor: input.actor,
          capability: "notification.template.write",
          action: input.decision === "approved" ? "notification_meta_approved" : "notification_meta_rejected",
          subject: `NotificationTemplate:${template.event}.${template.channel}.${line}`,
          reason: input.reason,
          tx,
        },
        async () => {
          const now = new Date();
          const moved = await tx.notificationTemplate.updateMany({
            where: { id: template.id, status: "pending_meta" },
            data:
              input.decision === "approved"
                ? { status: "live", decidedAt: now, metaNote: null }
                : { status: "rejected", decidedAt: now, metaNote: note },
          });
          if (moved.count === 0) throw new Refused("not_pending");

          let retired: number[] = [];
          if (input.decision === "approved") {
            const previous = await tx.notificationTemplate.findMany({
              where: {
                event: template.event,
                channel: template.channel,
                locale: template.locale,
                kind: line === "services" ? "services" : { in: ["goods", "neutral"] },
                status: "live",
                NOT: { id: template.id },
              },
              select: { id: true, version: true },
            });
            retired = previous.map((p) => p.version);
            if (previous.length > 0) {
              await tx.notificationTemplate.updateMany({ where: { id: { in: previous.map((p) => p.id) } }, data: { status: "retired" } });
            }
          }
          const next: TemplateStatus = input.decision === "approved" ? "live" : "rejected";
          return {
            result: next,
            before: { version: `v${template.version}`, status: "pending_meta", live: retired.map((v) => `v${v}`) },
            after: { version: `v${template.version}`, status: next, ...(note ? { metaNote: note } : {}) },
          };
        },
      );
    });
    return { ok: true, status };
  } catch (error) {
    if (error instanceof Refused) return refuse(error.error, error.detail);
    throw error;
  }
}

/**
 * Put a draft live, or send a WhatsApp draft to Meta.
 *
 * The editor never makes a draft — a save is live or pending — so this is for
 * the rows that arrive as drafts from elsewhere: the seed and any version from
 * before this board.
 */
export async function publishDraft(
  actor: Actor,
  templateId: string,
  reason: string,
): Promise<TemplateResult<{ status: TemplateStatus }>> {
  assertCan(actor, "notification.template.write");
  const template = await prisma.notificationTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, event: true, channel: true, kind: true, version: true, locale: true, metaTemplateName: true },
  });
  if (!template) return refuse("not_found");
  const whatsapp = template.channel === "whatsapp";
  if (whatsapp && !template.metaTemplateName) return refuse("whatsapp_needs_meta_name");
  const line = lineOf(template.kind);

  try {
    const status = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`notification_template:${template.event}:${template.channel}`}))`;
      return staffMutation(
        {
          actor,
          capability: "notification.template.write",
          action: whatsapp ? "notification_template_submitted" : "notification_template_published",
          subject: `NotificationTemplate:${template.event}.${template.channel}.${line}`,
          reason,
          tx,
        },
        async () => {
          const next: TemplateStatus = whatsapp ? "pending_meta" : "live";
          const lineKinds = line === "services" ? (["services"] as const) : (["goods", "neutral"] as const);
          const scope = { event: template.event, channel: template.channel, locale: template.locale, kind: { in: [...lineKinds] } };
          const moved = await tx.notificationTemplate.updateMany({
            where: { id: template.id, status: "draft" },
            data: whatsapp ? { status: "pending_meta", submittedAt: new Date() } : { status: "live" },
          });
          if (moved.count === 0) throw new Refused("not_draft");
          if (whatsapp) {
            await tx.notificationTemplate.updateMany({ where: { ...scope, status: "pending_meta", NOT: { id: template.id } }, data: { status: "superseded" } });
          } else {
            await tx.notificationTemplate.updateMany({ where: { ...scope, status: "live", NOT: { id: template.id } }, data: { status: "retired" } });
          }
          return { result: next, before: { version: `v${template.version}`, status: "draft" }, after: { version: `v${template.version}`, status: next } };
        },
      );
    });
    return { ok: true, status };
  } catch (error) {
    if (error instanceof Refused) return refuse(error.error, error.detail);
    throw error;
  }
}

// ── Send test to me ───────────────────────────────────────────────────────────

/**
 * `B10`: the real version through the real carrier, to the person asking.
 *
 * *"A preview that renders in the browser proves nothing about WhatsApp."* So
 * this renders the saved version with `sampleParams` — `render()` and its guards
 * run exactly as they would for a seller — hands it to the configured sender,
 * and records a delivery row marked `test`, which no volume on the console
 * counts.
 *
 * `Q5`, answered: on WhatsApp it is a billed template send. That is why it is
 * held at the ops-lead rung, throttled per person, and refused for a version
 * Meta has not approved — the carrier would refuse it anyway, after charging
 * nobody and telling nobody why.
 *
 * Not audited: it changes nothing anybody else receives. The delivery row is its
 * record, with the staff member as recipient.
 */
export async function sendTestToMe(
  actor: Actor,
  templateId: string,
  now: Date = new Date(),
): Promise<TemplateResult<{ channel: NotificationChannel; delivered: boolean; detail: string | null }>> {
  assertCan(actor, "notification.template.write");
  const template = await prisma.notificationTemplate.findUnique({ where: { id: templateId } });
  if (!template) return refuse("not_found");
  if (template.channel === "whatsapp" && template.status !== "live") return refuse("test_needs_approval");

  const recent = await prisma.notificationDelivery.count({
    where: { test: true, recipientUserId: actor.id, createdAt: { gte: new Date(now.getTime() - TEST_WINDOW_MS) } },
  });
  if (recent >= TEST_LIMIT) return refuse("test_throttled", { limit: String(TEST_LIMIT), minutes: String(TEST_WINDOW_MS / 60_000) });

  const me = await prisma.user.findUnique({ where: { id: actor.id }, select: { id: true, email: true, phone: true } });
  if (!me) return refuse("test_no_address");
  const to = template.channel === "in_app" ? me.id : template.channel === "email" ? me.email : me.phone;
  if (!to) return refuse("test_no_address", { channel: template.channel });

  const sender = resolveNotificationSenders()[template.channel];
  if (!sender) return refuse("test_no_carrier", { channel: template.channel });

  const rendered = render(template, sampleParams(template.event, siteUrl()));
  const result = await sender.send({
    channel: template.channel,
    to,
    subject: rendered.subject,
    body: rendered.body,
    actionLabel: rendered.actionLabel,
    actionUrl: rendered.actionPath ? absoluteUrl(rendered.actionPath) : null,
    metaTemplateName: template.metaTemplateName,
    recipientUserId: me.id,
  });

  await prisma.notificationDelivery.create({
    data: {
      templateId: template.id,
      event: template.event,
      channel: template.channel,
      status: result.delivered ? "sent" : "failed",
      recipientUserId: me.id,
      tradeKind: template.kind === "neutral" ? null : template.kind,
      reason: result.detail ?? null,
      sentAt: result.delivered ? now : null,
      test: true,
    },
  });

  return { ok: true, channel: template.channel, delivered: result.delivered, detail: result.detail ?? null };
}
