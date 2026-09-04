/**
 * The per-tab session id, and everything it deliberately is not.
 *
 * `ProductEvent.sessionId` exists for one reason: three events from one page
 * life have to be groupable, or "viewed the hub, opened a task, left" is three
 * unrelated rows and no duration can be measured between them.
 *
 * ## No cookie, no storage, no persistence of any kind
 *
 * It lives in a module-level variable in the tab and dies with the tab. Not
 * `localStorage`, not `sessionStorage`, not a cookie — and that is the decision
 * that keeps `/api/events` out of consent territory rather than a detail of it.
 * An id written to storage is an identifier stored on the visitor's device,
 * which is what a consent banner is about; an id held in a JavaScript variable
 * for the life of a page is not, because a reload produces a different one and
 * there is nothing to read back. docs/telemetry.md sets out the full argument
 * and what would have to change if this ever stopped being true.
 *
 * A consequence worth stating plainly: two visits by the same person are two
 * sessions and nothing joins them. That is the point, not a limitation to fix
 * later. The joinable identity is `actorId`, which only exists once somebody
 * has signed in and is set only on events that carry a session.
 *
 * Pure — no `server-only`, because the client component imports it.
 */

/** Twelve base-36 characters: 36^12, which is more than enough to not collide. */
export const SESSION_ID_LENGTH = 12;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const PATTERN = new RegExp(`^[a-z0-9]{${SESSION_ID_LENGTH}}$`);

let minted: string | null = null;

/** A fresh one. Exported so a test can make an id without touching the cache. */
export function mintSessionId(): string {
  const bytes = new Uint8Array(SESSION_ID_LENGTH);
  const source = globalThis.crypto;

  if (source && typeof source.getRandomValues === "function") {
    source.getRandomValues(bytes);
  } else {
    // Nothing here is a secret — the id groups rows and grants nothing — so a
    // weaker source is a worse id rather than a vulnerability. Not throwing
    // matters more: a page must never fail to render because a counter could
    // not find an entropy source.
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }

  let out = "";
  for (const byte of bytes) out += ALPHABET.charAt(byte % ALPHABET.length);
  return out;
}

/**
 * This tab's id, minted on first use.
 *
 * The cache is skipped when there is no `window`, and that guard is the whole
 * reason this function exists rather than a bare module constant. A module-level
 * variable on the server is per *process*, not per request: called during a
 * render, one id would be handed to every visitor that server instance touched,
 * and the grouping the column exists for would silently become "everyone who
 * hit this container". Minting a throwaway instead means such a call is merely
 * useless rather than wrong — and callers should be in an effect anyway.
 */
export function sessionId(): string {
  if (typeof window === "undefined") return mintSessionId();
  if (minted === null) minted = mintSessionId();
  return minted;
}

/** Shape only. Nothing is looked up, because there is nothing to look it up in. */
export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && PATTERN.test(value);
}
