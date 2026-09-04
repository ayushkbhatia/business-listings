/**
 * A trade licence number, normalised against the authority that issued it.
 *
 * Board 2b asks for the authority prefix to be enforced, and `docs/data-model.md`
 * gives the shape: `DED-618402`. What arrives from a claimant does not look like
 * that. A person reading a licence off a wall types `618402`; OCR reads
 * `DED 618402` or `DED–618402` with an en dash; a PRO pastes `ded-618402`.
 * All four are the same licence.
 *
 * So this is a normaliser rather than a validator that says no. The only thing
 * genuinely refused is a number that names a *different* authority from the one
 * on the record — `SHJ-618402` submitted against a DED listing is not a typo, it
 * is a claim about a different licence, and silently rewriting the prefix would
 * hide exactly the mismatch a reviewer needs to see.
 *
 * Pure. The register's own value is never rewritten from this; see
 * `ClaimSubmission.statedLicenceNumber` for why a claim does not edit its own
 * evidence.
 */

/** Every dash a keyboard, a PDF or an OCR pass can produce. */
const DASHES = /[-–—‒―_/\\]+/g;

export type LicenceNumberResult =
  | { ok: true; value: string; hadPrefix: boolean }
  | { ok: false; reason: "empty" | "no_digits" | "wrong_authority"; found?: string };

/**
 * `authority` is the one on the licence record — `Business.licenceAuthority`.
 *
 * Returns the canonical `AUTHORITY-DIGITS`, whether the claimant typed the
 * prefix themselves, or a refusal naming what was found.
 */
export function normaliseLicenceNumber(
  input: string,
  authority: string,
): LicenceNumberResult {
  const cleaned = input.trim().replace(DASHES, "-").replace(/\s+/g, " ").toUpperCase();
  if (!cleaned) return { ok: false, reason: "empty" };

  /*
     Split on the first run of digits, so the prefix is whatever came before it.
     Matching a list of thirty-six authority codes would refuse a licence from
     the thirty-seventh free zone the day it opens, and the record already
     carries the authority — this only has to agree with it.
  */
  const match = /^([A-Z]*)[\s-]*([0-9][0-9\s-]*)$/.exec(cleaned);
  if (!match) return { ok: false, reason: "no_digits" };

  const prefix = match[1] ?? "";
  const digits = (match[2] ?? "").replace(/[\s-]/g, "");
  if (!digits) return { ok: false, reason: "no_digits" };

  const expected = authority.trim().toUpperCase();

  if (prefix && prefix !== expected) {
    /*
       A different authority is a different licence, not a mistyped one. The
       claimant may be right and the register wrong — that happens, and it is a
       thing for a person to look at — but this screen cannot decide it, and
       rewriting the prefix to match would erase the disagreement.
    */
    return { ok: false, reason: "wrong_authority", found: prefix };
  }

  return { ok: true, value: `${expected}-${digits}`, hadPrefix: prefix.length > 0 };
}

/**
 * True where two licence numbers name the same licence.
 *
 * Compared on the digits and the authority rather than character by character,
 * so a claimant who typed `618402` against a stored `DED-618402` is not recorded
 * as having corrected anything. A correction should mean a correction.
 */
export function sameLicenceNumber(a: string, b: string, authority: string): boolean {
  const left = normaliseLicenceNumber(a, authority);
  const right = normaliseLicenceNumber(b, authority);
  return left.ok && right.ok && left.value === right.value;
}
