/**
 * The events this product may emit, and what each one is allowed to carry.
 *
 * Pure: no database, no `server-only`. The route validates against this table,
 * `lib/telemetry/record.ts` writes against it, and the client component reads
 * one fact off it — whether the event needs a session. One table, three
 * readers, so the three cannot disagree about what an event is.
 *
 * ## Why the set is closed
 *
 * `ContactReveal.surface` is the argument. It was typed `String` with a doc
 * comment saying "e.g. `storefront` or `search_results`", nothing checked it,
 * and call sites drifted into per-listing values. Grouping by it now returns
 * one row per storefront, which means the column answers no question at all —
 * a free-text dimension is a dimension you cannot aggregate.
 *
 * So a name that is not in `EVENT_NAMES` is refused rather than stored, and a
 * prop key that the event does not declare is dropped rather than kept. Adding
 * an event is an edit here, which is the point: the edit is where somebody
 * decides what the new name means and whether an existing one already meant it.
 *
 * ## Emitter, and why half of these are not the browser's to send
 *
 * `emitter` is not a permission detail, it is the difference between a
 * measurement and a claim. The browser owns *attention* facts — a screen was
 * looked at, a task was opened, a tab went away — and nothing on the server
 * knows them. The server owns *state* facts: a task actually completed, a
 * concierge row exists, a nudge went out, a link in it was followed. A state
 * fact taken from a browser is the browser's word for it, and CLAUDE.md's rule
 * is that derived numbers are measured rather than claimed. `/api/events` drops
 * anything marked `server`.
 */

export const EVENT_NAMES = [
  "setup_hub_viewed",
  "setup_task_started",
  "setup_task_completed",
  "setup_hub_abandoned",
  "concierge_requested",
  "setup_nudge_sent",
  "setup_nudge_opened",
  "setup_completed",
  "setup_done_viewed",
  "setup_done_exit",
  "setup_done_redirected",
  "listing_viewed",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** A prop is one scalar. Nothing nested: `props` is grouped by, not read. */
export type EventPropValue = string | number | boolean;
export type EventProps = Record<string, EventPropValue>;

/**
 * What a caller may hand over. Wider than `EventProps` by one `undefined`, so
 * an event shape with optional keys is assignable without every caller
 * stripping its own absent values first.
 */
export type EventPropsInput = Readonly<Record<string, EventPropValue | undefined>>;

/**
 * A prop's type, with `?` for optional. A required prop that is missing refuses
 * the whole event; an optional one that is missing is simply absent.
 */
type PropToken = "string" | "number" | "boolean" | "string?" | "number?" | "boolean?";

interface EventDefinition {
  emitter: "browser" | "server";
  /**
   * `required` — the event belongs to one page life and is useless without the
   * id that groups it. `never` — this event must not carry one, and the route
   * enforces that rather than trusting a client to leave it out.
   */
  session: "required" | "never";
  props: Record<string, PropToken>;
}

/**
 * How long a prop string may be.
 *
 * A task id is a slug. Sixty-four characters is generous for one and far too
 * short to smuggle anything through a public endpoint into a Json column that
 * nothing escapes on the way out.
 */
export const MAX_PROP_LENGTH = 64;

export const EVENT_SPECS = {
  /** The hub was rendered. `score` is what board 8a wants the funnel keyed on. */
  setup_hub_viewed: {
    emitter: "browser",
    session: "required",
    props: { score: "number?", tasksRemaining: "number?" },
  },
  /** A task was opened. Started, not finished — the pair is the drop-off. */
  setup_task_started: {
    emitter: "browser",
    session: "required",
    props: { task: "string" },
  },
  /**
   * Written where the task's own row lands, not where a button was clicked.
   * A browser saying a task is done is a claim; the service knows.
   */
  setup_task_completed: {
    emitter: "server",
    session: "required",
    props: { task: "string", score: "number?" },
  },
  /**
   * The tab went away with the hub still unfinished. The one board 8a is
   * actually about: *what score are sellers at when they give up.*
   */
  setup_hub_abandoned: {
    emitter: "browser",
    session: "required",
    props: { score: "number?", tasksRemaining: "number?", msOnScreen: "number?" },
  },
  /** A `CatalogueImportRequest` row exists. Emitted by the service that made it. */
  concierge_requested: {
    emitter: "server",
    session: "required",
    props: { requestId: "string?", feeAed: "number?" },
  },
  /** The nudge job sent one. There is no browser in this event at all. */
  setup_nudge_sent: {
    emitter: "server",
    session: "required",
    props: { channel: "string", task: "string?" },
  },
  /** The link in it was followed, which the redirect handler knows and no page does. */
  setup_nudge_opened: {
    emitter: "server",
    session: "required",
    props: { channel: "string", task: "string?" },
  },
  /**
   * Every setup task closed, for the first time. Board 8e §7.
   *
   * Server-emitted, because it is a state fact: the browser can say a screen was
   * looked at and cannot say the work is finished. It is written where the
   * transition is detected — the hub, on the render that finds nothing open —
   * and the `completedAt` stamp beside it is what makes it once-only.
   *
   * `hours` is the number §7 says is worth watching: first hub view to
   * completion. 8a estimates twenty minutes of work, so a median of four days
   * says the tasks are not the problem and the nudge sequence is.
   *
   * The completion *order* is deliberately not carried here. `setup_task_completed`
   * already writes one row per task with its own timestamp, so the order is a
   * `GROUP BY` away — and a second copy of the same fact is a second thing to
   * get wrong.
   */
  setup_completed: {
    emitter: "server",
    session: "required",
    props: { hours: "number?", score: "number?" },
  },
  /** The completion screen was rendered. Attention, so the browser owns it. */
  setup_done_viewed: {
    emitter: "browser",
    session: "required",
    props: { score: "number?" },
  },
  /**
   * Which way they left. §1 gives the screen two exits and they mean different
   * things: the dashboard is "carry on", the storefront is "let me look at what
   * I just built". Worth telling apart.
   */
  setup_done_exit: {
    emitter: "browser",
    session: "required",
    props: { to: "string" },
  },
  /**
   * Somebody reached `/dashboard/setup/done` and was sent away. The route knows
   * why and no browser does, which is the whole reason this is server-emitted:
   * `tasks_open` means the precondition failed, `already_seen` means the
   * once-only rule fired, `suspended` means a completion screen was about to be
   * rendered over a hidden listing.
   *
   * A rising `already_seen` is the signal that something is linking here —
   * an email, a bookmark, a stale tab — which §1 says must not exist.
   */
  setup_done_redirected: {
    emitter: "server",
    session: "required",
    props: { reason: "string" },
  },
  /**
   * A public storefront was looked at.
   *
   * The odd one out, deliberately. It writes a `listing_view_day` increment and
   * no `product_event` row, and `session: "never"` is how that stays true: an
   * anonymous visitor is counted, never followed. `businessId` travels in props
   * because every other event takes its business from the actor's own seat, so
   * the request body has no business field for anyone to aim.
   */
  listing_viewed: {
    emitter: "browser",
    session: "never",
    props: { businessId: "string" },
  },
} as const satisfies Record<EventName, EventDefinition>;

/*
   The TypeScript shape of each event's props, derived from the table above
   rather than written out beside it. Two declarations of the same fact drift,
   and the one that drifts is always the one nothing checks.
*/
type Scalar<T> = T extends `string${string}`
  ? string
  : T extends `number${string}`
    ? number
    : boolean;

type OptionalKey<P> = { [K in keyof P]: P[K] extends `${string}?` ? K : never }[keyof P];
type RequiredKey<P> = Exclude<keyof P, OptionalKey<P>>;

type PropsOf<P> = { [K in RequiredKey<P>]: Scalar<P[K]> } & {
  [K in OptionalKey<P>]?: Scalar<P[K]>;
};

/** `EventPropsFor<"setup_nudge_sent">` is `{ channel: string; task?: string }`. */
export type EventPropsFor<N extends EventName> = PropsOf<(typeof EVENT_SPECS)[N]["props"]>;

export function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && (EVENT_NAMES as readonly string[]).includes(value);
}

/** May a browser send this one, or is it the server's to write? */
export function isBrowserEmitted(name: EventName): boolean {
  return EVENT_SPECS[name].emitter === "browser";
}

/**
 * Does this event belong to a session?
 *
 * Read by the client component as well as by the route, so a page that only
 * emits `listing_viewed` never mints an id in the first place. An identifier
 * that is minted and then discarded server-side is still an identifier that
 * existed in the visitor's tab.
 */
export function requiresSession(name: EventName): boolean {
  return EVENT_SPECS[name].session === "required";
}

export type EventValidation =
  | { ok: true; name: EventName; props: EventProps }
  | { ok: false; error: "unknown_name" | "bad_props"; detail: string };

/**
 * Take a name and an unknown bag of props; give back only what the event
 * declares.
 *
 * Unknown keys are dropped rather than refused, and that asymmetry is
 * deliberate: a client left behind by a deploy will keep sending a prop that
 * has since been removed, and refusing the event would lose the fact along with
 * the stale key. An unknown *name* is refused, because a name is the fact.
 */
export function validateEvent(name: string, props: unknown): EventValidation {
  if (!isEventName(name)) return { ok: false, error: "unknown_name", detail: name.slice(0, 64) };

  const source: Record<string, unknown> =
    props !== null && typeof props === "object" && !Array.isArray(props)
      ? (props as Record<string, unknown>)
      : {};

  const spec: Record<string, PropToken> = EVENT_SPECS[name].props;
  const kept: EventProps = {};

  for (const [key, token] of Object.entries(spec)) {
    const optional = token.endsWith("?");
    const type = optional ? token.slice(0, -1) : token;
    const value = source[key];

    if (value === undefined || value === null) {
      if (optional) continue;
      return { ok: false, error: "bad_props", detail: `${name}.${key} is missing` };
    }

    const wellTyped =
      (type === "string" && typeof value === "string" && value.length <= MAX_PROP_LENGTH) ||
      (type === "number" && typeof value === "number" && Number.isFinite(value)) ||
      (type === "boolean" && typeof value === "boolean");

    if (!wellTyped) {
      if (optional) continue;
      return { ok: false, error: "bad_props", detail: `${name}.${key} is not a ${type}` };
    }

    kept[key] = value as EventPropValue;
  }

  return { ok: true, name, props: kept };
}
