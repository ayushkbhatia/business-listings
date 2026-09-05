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
  "inbox_viewed",
  "lead_opened",
  "quote_sent",
  "outcome_marked",
  "thread_viewed",
  "message_sent",
  "follow_up_scheduled",
  "follow_up_sent",
  "follow_up_cancelled",
  "pipeline_viewed",
  "quote_extended",
  "extend_opened_from",
  "revision_started",
  "requote_started",
  "pipeline_exported",
  "unroutable_lead",
  "team_viewed",
  "invite_sent",
  "invite_resent",
  "seat_removed",
  "routing_mode_changed",
  "escalation_interval_changed",
  "cap_reached_invite_blocked",
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

  /* ── Boards 3j and 11b ──

     Nine, not the eighteen the two specs between them list. Each of these
     answers a question somebody will actually ask; the rest were left out for
     stated reasons, and the reasons are here rather than in a document nobody
     opens:

     - `composer_opened` / `composer_switched`. 3j §9 calls the second "the
       number worth watching" — whether sellers routinely turn an RFQ into a
       message, which would mean the type rule is wrong. It cannot be measured
       yet: `createEnquiry` refuses an enquiry with no lines and has one caller,
       so every enquiry is an RFQ and there is nothing to switch *from*. An
       event that can only ever report one value is a column you cannot group by.
     - `quote_line_added` and `sku_match_rate`. Both are already answerable from
       the rows — `QuoteLine.productId` being null *is* the hand-priced line —
       and a derived number measured twice is a number that will disagree.
     - `read_receipt_shown`. The useful figure is whether the buyer opened it,
       which is `Quote.readAt`. A browser event saying we drew the line adds a
       second, weaker source for a fact the database already holds.
     - `escalation_fired`. lib/enquiry/escalation-job.ts already writes a
       `NotificationDelivery` row per escalation, which is the record.
  */

  /** The inbox was rendered. `scope` and `tab` are what the funnel groups by. */
  inbox_viewed: {
    emitter: "browser",
    session: "never",
    props: { tab: "string", scope: "string", open: "number?", overdue: "number?" },
  },
  /**
   * A lead was opened from the rail.
   *
   * `band` and `position` together answer the question the ordering exists for:
   * do sellers work down the list, or do they skip the overdue rows at the top?
   */
  lead_opened: {
    emitter: "browser",
    session: "never",
    props: { band: "string", position: "number?", quoted: "boolean?" },
  },
  /**
   * A quote left the composer. Server: a browser saying a quote was sent is the
   * browser's word for it, and this one has a row behind it.
   *
   * `hoursSinceReceipt` is the number 3a's median is built from, recorded here
   * per quote so a slow week can be read without recomputing the median.
   */
  quote_sent: {
    emitter: "server",
    session: "never",
    props: {
      lines: "number",
      revision: "number",
      validityDays: "number",
      hoursSinceReceipt: "number?",
      handPriced: "number?",
    },
  },
  /**
   * A seller closed a lead.
   *
   * No amount, and there will not be one: quoted value is derived from accepted
   * quotes, and an event carrying a seller-typed figure would be the writable
   * path CLAUDE.md refuses, one layer down.
   */
  outcome_marked: {
    emitter: "server",
    session: "never",
    props: { outcome: "string", hadQuote: "boolean?", hasReason: "boolean?", source: "string?" },
  },
  /** One conversation was opened. */
  thread_viewed: {
    emitter: "browser",
    session: "never",
    props: { state: "string", messages: "number?", unread: "number?" },
  },
  /** A message was written by a person on the seller's side. */
  message_sent: {
    emitter: "server",
    session: "never",
    props: { length: "number", flagged: "boolean?" },
  },
  /**
   * The follow-up, in three parts.
   *
   * Board 11b names the reply rate as the number worth watching: the rail
   * asserts that a second nudge loses more than it wins, and if the *first*
   * one's reply rate is poor the feature is noise and should go rather than
   * double. These three are what that rate is computed from — armed, sent, and
   * the cancellations that mean the buyer answered before it had to.
   */
  follow_up_scheduled: {
    emitter: "server",
    session: "never",
    props: { hours: "number" },
  },
  follow_up_sent: {
    emitter: "server",
    session: "never",
    // `source` since board 3k: the same follow-up can be sent from the thread or
    // from the pipeline, and a second event name for one act would make the
    // reply rate 11b watches disagree with itself.
    props: { scheduled: "boolean", hoursWaited: "number?", source: "string?" },
  },
  follow_up_cancelled: {
    emitter: "server",
    session: "never",
    props: { reason: "string" },
  },

  /* ── Board 3k ──

     Six, and two props added to events board 3j already registered rather than
     a second name for the same act: a follow-up sent from the pipeline is the
     same follow-up, and `source` is what tells the two surfaces apart. Two more
     the spec lists were left out, with reasons:

     - `tab_changed`. The tabs are links, so changing one is a navigation and
       `pipeline_viewed` fires again carrying the new tab. A second event would
       double-count every tab change and disagree with the first about how many
       there were.
     - `row_opened`. A row's ref links into the thread, which already emits
       `thread_viewed`. Recording the click as well would make one arrival look
       like two.
  */

  /** The pipeline was rendered. `tab` and the two live counts group the funnel. */
  pipeline_viewed: {
    emitter: "browser",
    session: "never",
    props: { tab: "string", awaiting: "number?", expiring: "number?", all: "number?" },
  },
  /**
   * A window was pushed out.
   *
   * `timesPreviouslyExtended` is §11's number worth watching, and it points at
   * another screen: quotes routinely extended twice mean board 3j's default
   * validity is too short, and the fix belongs in the composer rather than here.
   */
  quote_extended: {
    emitter: "server",
    session: "never",
    props: {
      daysAdded: "number",
      daysRemaining: "number",
      timesPreviouslyExtended: "number",
    },
  },
  /**
   * Which surface the extend dialog was opened from.
   *
   * The expiring card exists as the replacement for a bulk follow-up button, so
   * whether anybody uses it is the question that decides if the card earns its
   * place. `queue` is board 3a's row action, which deep-links here.
   */
  extend_opened_from: {
    emitter: "browser",
    session: "never",
    props: { source: "string", daysRemaining: "number?" },
  },
  /** `Revise` — the pipeline handing back to board 3j's composer. */
  revision_started: {
    emitter: "browser",
    session: "never",
    props: { source: "string" },
  },
  /** `Re-quote` on an expired window. How long it sat dead is the interesting half. */
  requote_started: {
    emitter: "browser",
    session: "never",
    props: { daysSinceExpiry: "number?" },
  },
  /** A CSV left the account. Row count, so an empty export is visible as one. */
  pipeline_exported: {
    emitter: "server",
    session: "never",
    props: { tab: "string", rows: "number" },
  },

  /**
   * Board 7d §9's number worth watching.
   *
   * "Every one of those is a lead that arrived and went nowhere until the owner
   * picked it up, and it is the single measurement that tells you whether this
   * pair of screens works." Server-side, because the router is the only thing
   * that knows — the failure is invisible on both screens by construction, which
   * is the whole reason boards 7d and 7e are one handoff.
   *
   * `routing_off` is deliberately not recorded: a seller who chose "everyone
   * sees everything" has not suffered a routing failure, and counting it would
   * drown the three reasons that are.
   */
  unroutable_lead: {
    emitter: "server",
    session: "never",
    props: { reason: "string" },
  },

  // ── Board 7d, the team screen ─────────────────────────────────────────────

  /**
   * The screen was looked at, with the two counts that say what it showed.
   *
   * `unreachable` is the one to group by. A team where it is never zero is a
   * team whose routing is quietly skipping people, and this is the only place
   * that number is visible before it turns into an `unroutable_lead`.
   */
  team_viewed: {
    emitter: "browser",
    session: "required",
    props: { seats: "number?", invites: "number?", unreachable: "number?" },
  },
  /** An invitation left. `scoped` is 7d §9's "branch scope", as a boolean. */
  invite_sent: {
    emitter: "server",
    session: "never",
    props: { role: "string", scoped: "boolean" },
  },
  /** The same offer, again. Distinct from a first send: it counts a delivery
   * that did not arrive, which is what the resend control exists for. */
  invite_resent: {
    emitter: "server",
    session: "never",
    props: { expired: "boolean" },
  },
  /**
   * A seat taken back, and what happened to what it was holding.
   *
   * `openLeads` is the count that moved and `movedTo` says where — `seat` or
   * `queue`. 7d §9 asks for "open leads reassigned to", and the id of a
   * colleague is not a dimension anything can group by, so it is the shape of
   * the destination rather than the person.
   */
  seat_removed: {
    emitter: "server",
    session: "never",
    props: { openLeads: "number", movedTo: "string" },
  },
  /** From and to, because the interesting question is which way sellers move. */
  routing_mode_changed: {
    emitter: "server",
    session: "never",
    props: { from: "string", to: "string" },
  },
  escalation_interval_changed: {
    emitter: "server",
    session: "never",
    props: { fromMinutes: "number", toMinutes: "number" },
  },
  /**
   * The invitation the plan refused.
   *
   * Not a funnel step — it is the measurement of a wall a paying seller walked
   * into, and 7d §3 makes the wall a designed state precisely so this is rare.
   * If it is common the cap is wrong, not the seller.
   */
  cap_reached_invite_blocked: {
    emitter: "server",
    session: "never",
    props: { plan: "string", cap: "number" },
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
