import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getActor } from "@/lib/auth/session";
import { checkRate, RATE_POLICIES, recordHit, requesterKey, type RateBucket } from "@/lib/rate-limit";
import { isBrowserEmitted, requiresSession, validateEvent } from "@/lib/telemetry/events";
import { recordEvent, recordListingView } from "@/lib/telemetry/record";
import { isSessionId } from "@/lib/telemetry/session";

/**
 * The beacon. One small batch of product events, from a browser.
 *
 * ## It always answers 204
 *
 * Whatever was dropped, and whyever it was dropped. A beacon that returns an
 * error teaches a client to retry, and there is nothing here worth retrying:
 * the events describe a moment that has already passed, and a second copy of
 * "the hub was viewed" is worse than none. `navigator.sendBeacon` cannot read a
 * status code in any case — the page is usually gone by the time this replies.
 *
 * The other half of that is silence about *what* was refused. This endpoint is
 * public and unauthenticated for one event, so an explanation is a description
 * of the checks to somebody probing them.
 *
 * ## Nothing in the body decides who anybody is
 *
 * `actorId` is resolved server-side and `businessId` is read off the actor's own
 * seat, never off the payload — a seller may emit events about their own
 * business and about no other. The single exception is `listing_viewed`, whose
 * `businessId` has to come from the body because there is no session at all; it
 * is checked against a published listing before it counts, in
 * `recordListingView`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Two caps, both on the cheap side of the work.
 *
 * A real batch is one or two events of a few dozen bytes. These are set where
 * an honest client never reaches them and a loop stops being free: the body is
 * read as text and measured before anything parses it, so an oversized post
 * costs a string and not a JSON tree.
 */
const MAX_BODY_BYTES = 4096;
const MAX_EVENTS = 10;

const bodySchema = z.object({
  sessionId: z.string().max(64).optional(),
  events: z
    .array(
      z.object({
        name: z.string().max(64),
        props: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      }),
    )
    .min(1)
    .max(MAX_EVENTS),
});

/**
 * The bucket this counts against.
 *
 * `RATE_POLICIES` owns the numbers and lives in `lib/rate-limit/policy.ts`,
 * which this change does not touch — the entry is a follow-up. `POLICED` is why
 * that is safe to ship ahead of it rather than merely broken: `checkRate` reads
 * `RATE_POLICIES[bucket]`, and a bucket with no policy would warn on every
 * beacon on a directory built to be crawled. Both lines go when the entry lands.
 */
const EVENTS_BUCKET: string = "events";
const POLICED = EVENTS_BUCKET in RATE_POLICIES;

const noContent = () => new NextResponse(null, { status: 204 });

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return noContent();

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return noContent();
  }

  const body = bodySchema.safeParse(json);
  if (!body.success) return noContent();
  const parsed = body.data;

  /*
     Keyed on the address rather than on the actor, which is the opposite of
     what `requesterKey` is normally used for and is deliberate here.

     Resolving the actor is the expensive thing this limit protects — a
     `getUser()` round trip to the auth server plus a profile read — and keying
     the limit on it would mean paying that cost on every request in order to
     decide whether to refuse the request. The storefront's `listing_viewed`
     never resolves an actor at all, and it is by far the loudest caller here.

     The cost is that a whole office shares one allowance. On a beacon that is
     the right side to be wrong on: the allowance is large, and what is lost
     when it runs out is a count, not a page.
  */
  if (POLICED) {
    const key = await requesterKey(null);
    const decision = await checkRate(EVENTS_BUCKET as RateBucket, key);
    if (!decision.allowed) return noContent();
    await recordHit(EVENTS_BUCKET as RateBucket, key);
  }

  const session = isSessionId(parsed.sessionId) ? parsed.sessionId : null;

  const accepted = parsed.events.flatMap((item) => {
    const validated = validateEvent(item.name, item.props);
    // A name the server owns — `setup_nudge_sent`, `setup_task_completed` —
    // arriving from a browser is either a stale client or somebody trying it
    // on. Either way the browser does not know the fact it is asserting.
    if (!validated.ok || !isBrowserEmitted(validated.name)) return [];
    return [validated];
  });

  /*
     One view per listing per request, however many the batch claims.

     A batch is a transport detail, not evidence of ten visits, and this is the
     one number a seller reads off their own screen. It does not make the count
     unforgeable — nothing short of an audited pipeline would — which is why
     nothing ranks on it and it is not an input to billing.
  */
  const viewed = new Set<string>();
  for (const event of accepted) {
    if (event.name !== "listing_viewed") continue;
    const businessId = event.props["businessId"];
    if (typeof businessId === "string") viewed.add(businessId);
  }

  for (const businessId of viewed) {
    await recordListingView(businessId);
  }

  const owned = accepted.filter((event) => requiresSession(event.name));
  if (owned.length === 0 || !session) return noContent();

  // Only now, and only once: an anonymous storefront beacon must not cost a
  // round trip to the auth server.
  const actor = await getActor();
  const businessId = actor?.businessId;
  if (!actor || !businessId) return noContent();

  /*
     Sequentially, not `Promise.all`. The batch is capped at ten, so the ceiling
     is ten small inserts, and events from one page life arrive with an implicit
     order that a `createdAt` collision would lose.
  */
  for (const event of owned) {
    await recordEvent({
      name: event.name,
      businessId,
      actorId: actor.id,
      sessionId: session,
      props: event.props,
    });
  }

  return noContent();
}
