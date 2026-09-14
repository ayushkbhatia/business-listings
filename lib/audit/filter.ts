import { parseSubject } from "./describe";

/**
 * Board 4i — what a filter or a page link can mean, and nothing else.
 *
 * Pure, and apart from `log.ts`, so the rules for turning a query string into a
 * `where` are unit-tested without a database. Both come from a URL a person can
 * edit: anything that is not a shape this file recognises is dropped, never
 * passed through.
 */

export interface AuditFilter {
  actorId?: string;
  action?: string;
  /** `Business:clx123` for one subject, `Business` for every subject of a type. */
  subject?: string;
}

export const AUDIT_PAGE_SIZE = 50;

const SUBJECT_TYPE = /^[A-Z][A-Za-z]{1,40}$/;

/** Only what a filter can safely mean. Anything else is dropped, not interpolated. */
export function normaliseAuditFilter(raw: {
  actor?: string | null;
  action?: string | null;
  subject?: string | null;
}): AuditFilter {
  const filter: AuditFilter = {};
  const actor = raw.actor?.trim();
  if (actor && /^[0-9a-f-]{36}$/i.test(actor)) filter.actorId = actor.toLowerCase();
  const action = raw.action?.trim();
  if (action && /^[a-z_]{2,60}$/.test(action)) filter.action = action;
  const subject = raw.subject?.trim();
  if (subject && subject.length <= 200) {
    const ref = parseSubject(subject);
    if (ref && SUBJECT_TYPE.test(ref.type)) filter.subject = subject;
    else if (SUBJECT_TYPE.test(subject)) filter.subject = subject;
  }
  return filter;
}


// ── Cursors ─────────────────────────────────────────────────────────────────

export interface Cursor {
  at: Date;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.at.toISOString()}|${cursor.id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw || raw.length > 200) return null;
  try {
    const [iso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    if (!iso || !id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? null : { at, id };
  } catch {
    return null;
  }
}

