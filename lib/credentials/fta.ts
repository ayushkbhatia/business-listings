import { resolveTarget } from "@/lib/db/target-url";
import { fixtureRecord, fixtureUnreachable } from "./fta-fixture";
import {
  FTA_REGISTER_SOURCE,
  registerRecordSchema,
  type RegisterFetch,
  type UnavailableCause,
} from "./register-fetch";

/**
 * The FTA tax agent register — board `8b-s`'s one check, and board `4c-s`'s
 * right-hand column.
 *
 * ## There is no register integration on this platform, and this is where it
 * lands
 *
 * `8b-s`'s handoff said the trade-licence lookup already existed from
 * onboarding verification. It does not: `lib/verification/licence/` is number
 * normalisation and text extraction, and the tier that follows is set by an
 * `ops_lead` who looked the licence up themselves. The FTA publishes no API a
 * platform can call either. So this module is the seam and the contract:
 * `fetchTaxAgent` answers from whatever `FTA_REGISTER_URL` names, speaking the
 * body `registerRecordSchema` describes, and until something is configured it
 * answers `unavailable · not_configured` — which every screen says plainly
 * rather than converting into a failure somebody is blamed for.
 *
 * ## What changed at `4c-s`
 *
 * `8b-s`'s version returned `ok` on any 200 and threw the body away. A register
 * that answered for the number under a different company's name verified the
 * credential anyway — the check compared nothing. This returns the whole read,
 * `./compare.ts` decides whether it matches, and the caller keeps the read.
 */

/**
 * A Tax Agent Approval Number, as the FTA issues them.
 *
 * Digits only, and the length is not pinned: TAANs in circulation run to
 * different lengths and a validator that refused a real one would be worse than
 * no validator at all. What this catches is the wrong *shape* — a licence
 * number typed into the agent field, an email address, a sentence.
 */
export function normaliseTaan(value: string): string | null {
  const digits = value.replace(/[\s-]/g, "");
  if (!/^\d{4,15}$/.test(digits)) return null;
  return digits;
}

export type RegisterMode = "http" | "fixture" | "off";

/**
 * Which register answers, if any.
 *
 * An environment variable rather than a build flag, so the day an integration
 * lands it is configuration and not a deploy of this file. `fixture` is the
 * stand-in in `./fta-fixture.ts`, and it is honoured only against a loopback
 * database outside a production deployment — the same two conditions
 * `lib/dev/guard.ts` puts on `/dev`, restated here because that module is
 * server-only and this one is read by unit tests. Anywhere else a fixture reads
 * as no register at all.
 */
export function registerMode(env: NodeJS.ProcessEnv = process.env): RegisterMode {
  const value = env["FTA_REGISTER_URL"]?.trim() ?? "";
  if (value === "") return "off";
  if (value === "fixture") {
    const target = resolveTarget(env);
    return env["VERCEL_ENV"] !== "production" && target?.isLoopback === true ? "fixture" : "off";
  }
  return /^https?:\/\//.test(value) ? "http" : "off";
}

export function registerConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return registerMode(env) !== "off";
}

/** Four seconds, then the read is unavailable. A seller's save is waiting on it. */
const TIMEOUT_MS = 4000;

function unavailable(asked: string, now: Date, cause: UnavailableCause, httpStatus?: number): RegisterFetch {
  return {
    v: 1,
    asked,
    fetchedAt: now.toISOString(),
    source: FTA_REGISTER_SOURCE,
    outcome: "unavailable",
    cause,
    ...(httpStatus === undefined ? {} : { httpStatus }),
  };
}

/**
 * Ask the register about one well-formed number. Returns what actually
 * happened, never a flattering version — a timeout is not a "not found", and a
 * body that does not parse is not a match.
 *
 * `now` is a parameter and never `Date.now()` in the body, because the read's
 * timestamp is the one a reviewer is shown and the one freshness is judged by.
 */
export async function fetchTaxAgent(
  number: string,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Promise<RegisterFetch> {
  const asked = number;
  const mode = registerMode(env);
  if (mode === "off") return unavailable(asked, now, "not_configured");

  if (mode === "fixture") {
    if (fixtureUnreachable(asked)) return unavailable(asked, now, "timeout");
    const record = fixtureRecord(asked);
    return record
      ? { v: 1, asked, fetchedAt: now.toISOString(), source: FTA_REGISTER_SOURCE, outcome: "found", record }
      : { v: 1, asked, fetchedAt: now.toISOString(), source: FTA_REGISTER_SOURCE, outcome: "not_found" };
  }

  const base = env["FTA_REGISTER_URL"]!.trim().replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetcher(`${base}/tax-agents/${encodeURIComponent(asked)}`, {
      headers: {
        accept: "application/json",
        ...(env["FTA_REGISTER_TOKEN"] ? { authorization: `Bearer ${env["FTA_REGISTER_TOKEN"]}` } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    // A timeout, a DNS failure, a certificate the runtime does not like. None
    // of them is evidence about the seller.
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return unavailable(asked, now, timedOut ? "timeout" : "network");
  }

  if (response.status === 404) {
    return { v: 1, asked, fetchedAt: now.toISOString(), source: FTA_REGISTER_SOURCE, outcome: "not_found" };
  }
  if (!response.ok) return unavailable(asked, now, "http_status", response.status);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return unavailable(asked, now, "bad_response", response.status);
  }
  const parsed = registerRecordSchema.safeParse(body);
  if (!parsed.success) return unavailable(asked, now, "bad_response", response.status);

  return { v: 1, asked, fetchedAt: now.toISOString(), source: FTA_REGISTER_SOURCE, outcome: "found", record: parsed.data };
}
