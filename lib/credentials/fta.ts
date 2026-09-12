/**
 * The FTA tax agent register — board `8b-s`, and the one check on this screen.
 *
 * ## There is no register integration on this platform, and this is where it
 * would land
 *
 * The handoff says "the trade-licence register lookup already exists from
 * onboarding verification". **It does not.** What exists in
 * `lib/verification/licence/` is number normalisation and text extraction from
 * an uploaded PDF; the tier that follows is set by an `ops_lead` who looked the
 * licence up themselves. `lib/verification/review.ts` says it in as many words:
 * *"Nothing on this platform checks an ISO number against a registrar."*
 *
 * So this module is the seam and not the integration. `checkTaxAgent` is the
 * one function a real FTA client has to satisfy, it is pure of Prisma, and
 * until a register is configured it answers `register_unavailable` — which the
 * screen surfaces inline rather than converting into a failure the seller is
 * blamed for.
 *
 * Board `8b-s` Q2 asked whether a failed lookup should block the save. It does
 * not, and the reason is stronger with no register than with one: a hard block
 * on a live external call is a bad failure mode, and a hard block on a call
 * that cannot be made at all is a screen nobody can finish.
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

export type RegisterAnswer =
  | { ok: true; verifiedBy: string; verifiedOn: Date }
  /** The number is well-formed and the register does not hold it. */
  | { ok: false; reason: "not_found" }
  /** Malformed before anything was asked. */
  | { ok: false; reason: "bad_format" }
  /** No register is configured, or it did not answer. Not the seller's fault. */
  | { ok: false; reason: "register_unavailable" };

/**
 * Whether a register is wired up at all.
 *
 * An environment variable rather than a build flag, so the day the integration
 * lands it is configuration and not a deploy of this file. Absent everywhere
 * today, which is why every FTA number currently saves as a claim.
 */
export function registerConfigured(): boolean {
  return Boolean(process.env.FTA_REGISTER_URL);
}

/**
 * Ask the register. Returns what actually happened, never a flattering version.
 *
 * `now` is a parameter and never `Date.now()` in the body — the same rule
 * `credentialState` follows, because this runs inside a request.
 */
export async function checkTaxAgent(
  raw: string,
  now: Date = new Date(),
): Promise<RegisterAnswer> {
  const number = normaliseTaan(raw);
  if (number === null) return { ok: false, reason: "bad_format" };

  /*
     No register, no check. Returning `not_found` here would tell a seller with
     a perfectly good agent number that the FTA has never heard of them, which
     is a claim this platform is in no position to make.
  */
  if (!registerConfigured()) return { ok: false, reason: "register_unavailable" };

  try {
    const response = await fetch(
      `${process.env.FTA_REGISTER_URL}/tax-agents/${encodeURIComponent(number)}`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4000) },
    );
    if (response.status === 404) return { ok: false, reason: "not_found" };
    if (!response.ok) return { ok: false, reason: "register_unavailable" };
    return { ok: true, verifiedBy: "FTA tax agent register", verifiedOn: now };
  } catch {
    // A timeout, a DNS failure, a certificate the runtime does not like. None
    // of them is evidence about the seller.
    return { ok: false, reason: "register_unavailable" };
  }
}
