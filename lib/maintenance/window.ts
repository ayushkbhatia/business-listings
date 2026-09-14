import { z } from "zod";
import { parseUaePhone, formatPhone, toE164 } from "@/lib/format/phone";
import { formatClock, formatDateShort, UAE_TIME_ZONE } from "@/lib/format";
import {
  SYSTEM_ROUTES,
  SYSTEM_STATES,
  SYSTEMS,
  type SystemKey,
  type SystemState,
} from "./systems";

/**
 * Board 13e — the maintenance window record.
 *
 * The handoff's data model is `window = { endsAt, minutes, affected }`, "set
 * before the work starts, baked into the page at deploy or held in the edge
 * config — not queried". This is that record, with the four things the board's
 * build notes and states table needed from it and the sketch did not carry:
 *
 * - **`startsAt`.** The record is set before the work, so the proxy has to know
 *   when to begin. `minutes` is then derived from the two ends rather than
 *   stored beside them — a stored duration is a third number that can disagree.
 * - **`work`.** The page's sentence names the work (*planned work on the search
 *   index*), and the kind of work decides how much of the site goes down: work
 *   on the database takes down every page, work on one system takes down the
 *   routes of the systems it marks down.
 * - **`whatsapp`, optional.** The one string on the board that "cannot be
 *   written by design". It lives in the record, set by whoever staffs the line
 *   for that window, and the page draws no contact card without it — B6: a
 *   number nobody answers is worse than no number.
 * - **`id`**, so a log line can say which window it is about.
 *
 * Nothing here reads a database or the network. Parsing is pure, so the proxy,
 * the ops check script and the gallery all read a record the same way.
 */

export const WORK_KINDS = ["search_index", "notification_job", "database"] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

/** Work that takes every page down, rather than the routes of the systems it names. */
export const SITE_WIDE_WORK: ReadonlySet<WorkKind> = new Set(["database"]);

/** Longer than this is not planned work a 503 should front. Google reads a 503 held for days as gone. */
export const MAX_WINDOW_MS = 24 * 60 * 60_000;

/**
 * How long past its end time a window keeps being served.
 *
 * Two hours over a planned window is an incident, and the states table is plain
 * that this page is not the incident page: *"using it for an incident is a lie
 * the visitor can check"*. Past this, the record is treated as lifted and logged
 * — a forgotten record must not hold the whole directory at 503 overnight.
 */
export const OVERRUN_GRACE_MS = 2 * 60 * 60_000;

/** Retry-After once the end time has passed and no new one is set. */
export const OVERRUN_RETRY_S = 5 * 60;

/** Retry-After never tells a crawler to come back sooner than this. */
export const MIN_RETRY_S = 60;

const rowSchema = z.strictObject({
  system: z.enum(SYSTEMS),
  state: z.enum(SYSTEM_STATES),
});

const recordSchema = z
  .strictObject({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{2,63}$/, "id is lowercase letters, digits and hyphens, 3 to 64 long — for example 2026-09-20-search-index"),
    work: z.enum(WORK_KINDS),
    startsAt: z.iso.datetime({ offset: true, error: "startsAt is an ISO time with its zone, for example 2026-09-20T02:20:00+04:00" }),
    endsAt: z.iso.datetime({ offset: true, error: "endsAt is an ISO time with its zone, for example 2026-09-20T03:00:00+04:00" }),
    affected: z.array(rowSchema).min(1).max(SYSTEMS.length),
    whatsapp: z.string().trim().min(1).optional(),
  })
  .superRefine((record, ctx) => {
    const starts = Date.parse(record.startsAt);
    const ends = Date.parse(record.endsAt);
    if (ends <= starts) {
      ctx.addIssue({ code: "custom", path: ["endsAt"], message: "endsAt has to be after startsAt" });
    } else if (ends - starts > MAX_WINDOW_MS) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "a window runs 24 hours at most — longer is an outage, not planned work, and a 503 held that long gets pages dropped from search",
      });
    }

    const seen = new Set<SystemKey>();
    for (const [i, row] of record.affected.entries()) {
      if (seen.has(row.system)) {
        ctx.addIssue({ code: "custom", path: ["affected", i, "system"], message: `${row.system} is listed twice` });
      }
      seen.add(row.system);
    }

    const stateOf = (system: SystemKey) => record.affected.find((r) => r.system === system)?.state;
    const down = record.affected.filter((r) => r.state === "down");

    if (record.work === "search_index" && stateOf("search") !== "down") {
      ctx.addIssue({ code: "custom", path: ["affected"], message: "work on the search index has to list search as down" });
    }
    if (record.work === "notification_job" && stateOf("notifications") !== "down") {
      ctx.addIssue({ code: "custom", path: ["affected"], message: "work on the notification job has to list notifications as down" });
    }

    if (SITE_WIDE_WORK.has(record.work)) {
      // Every page is down, so no row may say a page-owning system is running.
      for (const [i, row] of record.affected.entries()) {
        if (row.state === "running") {
          ctx.addIssue({
            code: "custom",
            path: ["affected", i, "state"],
            message: `work on the ${record.work} takes every page down, so ${row.system} cannot be listed as running`,
          });
        }
      }
    } else {
      // "A status list that is all red is a status list nobody believes."
      if (down.length === record.affected.length) {
        ctx.addIssue({
          code: "custom",
          path: ["affected"],
          message: "list at least one system that keeps running — an all-down list is the database state, and it is work kind database",
        });
      }
      if (!down.some((r) => SYSTEM_ROUTES[r.system].length > 0)) {
        ctx.addIssue({
          code: "custom",
          path: ["affected"],
          message: "no page is taken down, so the page would never be served — mark a system with pages as down",
        });
      }
    }

    if (record.whatsapp !== undefined) {
      const parsed = parseUaePhone(record.whatsapp);
      if (!parsed || parsed.kind !== "mobile") {
        ctx.addIssue({
          code: "custom",
          path: ["whatsapp"],
          message: `whatsapp has to be a UAE mobile, which is what WhatsApp needs — for example +971 50 118 4400. "${record.whatsapp}" is ${parsed ? `a ${parsed.kind} number` : "not a UAE number"}`,
        });
      }
    }
  });

export type MaintenanceRecord = z.input<typeof recordSchema>;

export interface MaintenanceRow {
  system: SystemKey;
  state: SystemState;
}

export interface MaintenanceWindow {
  id: string;
  work: WorkKind;
  startsAt: Date;
  endsAt: Date;
  affected: readonly MaintenanceRow[];
  /** E.164. Null when nobody is staffing a line for this window. */
  whatsapp: string | null;
}

export type ParseResult = { ok: true; window: MaintenanceWindow } | { ok: false; errors: string[] };

/** A record from JSON text or an already-parsed value. Never throws. */
export function parseWindow(input: unknown): ParseResult {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, errors: ["the record is not valid JSON"] };
    }
  }

  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) =>
        issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
      ),
    };
  }

  const record = parsed.data;
  return {
    ok: true,
    window: {
      id: record.id,
      work: record.work,
      startsAt: new Date(record.startsAt),
      endsAt: new Date(record.endsAt),
      affected: record.affected,
      whatsapp: record.whatsapp === undefined ? null : toE164(record.whatsapp),
    },
  };
}

/**
 * - `upcoming` — recorded, not started. The site is served normally.
 * - `active` — between the two ends.
 * - `overrun` — past the end time, within the grace. The page stops saying
 *   *back at 03:00* and says it is running past it.
 * - `lapsed` — past the grace. Treated as lifted.
 */
export type WindowPhase = "upcoming" | "active" | "overrun" | "lapsed";

export function phaseAt(window: MaintenanceWindow, now: Date): WindowPhase {
  const t = now.getTime();
  if (t < window.startsAt.getTime()) return "upcoming";
  if (t < window.endsAt.getTime()) return "active";
  if (t < window.endsAt.getTime() + OVERRUN_GRACE_MS) return "overrun";
  return "lapsed";
}

/** Minutes the window was planned to last. */
export function plannedMinutes(window: MaintenanceWindow): number {
  return Math.round((window.endsAt.getTime() - window.startsAt.getTime()) / 60_000);
}

/**
 * Seconds for `Retry-After`.
 *
 * Until the end time, the time left to it. Past it, five minutes: there is no
 * end to count to, and the record may move at any moment.
 */
export function retryAfterSeconds(window: MaintenanceWindow, now: Date): number {
  const left = window.endsAt.getTime() - now.getTime();
  if (left <= 0) return OVERRUN_RETRY_S;
  return Math.max(MIN_RETRY_S, Math.ceil(left / 1000));
}

export function stateOf(window: MaintenanceWindow, system: SystemKey): SystemState | null {
  return window.affected.find((row) => row.system === system)?.state ?? null;
}

/**
 * The sentence that does the real work — *enquiries already sent are safe and
 * suppliers are still being notified* — is two claims, and each is a row. It
 * renders only when the window itself lists both systems as running, and is
 * removed rather than left standing otherwise (states table: everything down).
 */
export function trustHolds(window: MaintenanceWindow): boolean {
  return stateOf(window, "quotes") === "running" && stateOf(window, "notifications") === "running";
}

/** What the page draws, resolved once so the document is string assembly and nothing else. */
export interface MaintenanceView {
  phase: Exclude<WindowPhase, "lapsed">;
  work: WorkKind;
  /** `03:00`, in Gulf Standard Time. */
  endClock: string;
  /** `21 Sep` when the end falls on another Dubai day than the request, else null. */
  endDay: string | null;
  endsAtIso: string;
  minutes: number;
  rows: readonly MaintenanceRow[];
  trust: boolean;
  retryAfter: number;
  whatsapp: { display: string; href: string } | null;
}

export function viewAt(window: MaintenanceWindow, now: Date): MaintenanceView {
  const phase = phaseAt(window, now);
  const sameDay =
    formatDateShort(window.endsAt, { timeZone: UAE_TIME_ZONE }) === formatDateShort(now, { timeZone: UAE_TIME_ZONE });

  return {
    // A lapsed window is never served; the view reads it as its last served state.
    phase: phase === "lapsed" ? "overrun" : phase,
    work: window.work,
    endClock: formatClock(window.endsAt),
    endDay: sameDay ? null : formatDateShort(window.endsAt),
    endsAtIso: window.endsAt.toISOString(),
    minutes: plannedMinutes(window),
    rows: window.affected,
    trust: trustHolds(window),
    retryAfter: retryAfterSeconds(window, now),
    whatsapp: window.whatsapp
      ? { display: formatPhone(window.whatsapp), href: `https://wa.me/${window.whatsapp.slice(1)}` }
      : null,
  };
}
