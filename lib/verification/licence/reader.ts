/**
 * Bytes to characters. The half of OCR that depends on a provider.
 *
 * Split from `extract.ts` on purpose: parsing a UAE licence's conventions is
 * ours and is tested without a network, and this is the seam a provider plugs
 * into. Swapping the provider changes this file and nothing else.
 */

export interface LicenceReadResult {
  /** Everything the reader could make out. `null` where it read nothing. */
  text: string | null;
  /** Names the provider in a log and in the admin queue. */
  reader: string;
  /** Why there is no text, where there is none. Never shown raw to a claimant. */
  detail?: string;
}

export interface LicenceReader {
  readonly name: string;
  /** Never throws. A reader that is down must not fail an upload. */
  read(input: { url: string; mimeType: string }): Promise<LicenceReadResult>;
}

/**
 * The reader for a deployment with no OCR provider configured.
 *
 * It reads nothing and says so, which puts board 2b's "OCR failed or low
 * confidence" state on screen: empty fields, and helper text asking the claimant
 * to type the number and expiry from the licence. That state is specified, it is
 * reachable, and it is the state every deployment is in until somebody wires a
 * provider — so it is the honest default rather than a stub that pretends.
 *
 * Deliberately *not* a production throw, unlike `resolveOtpSender`. A missing
 * OTP carrier means nobody can sign in; a missing OCR provider means two fields
 * are typed by hand. One is an outage and the other is a Tuesday.
 */
export class UnconfiguredLicenceReader implements LicenceReader {
  readonly name = "unconfigured";

  async read(): Promise<LicenceReadResult> {
    return { text: null, reader: this.name, detail: "no_ocr_provider_configured" };
  }
}

/**
 * Which reader this deployment uses.
 *
 * `LICENCE_OCR_PROVIDER` is read but no provider is registered yet; naming the
 * variable here is what makes the seam visible to whoever adds one, rather than
 * leaving them to discover the interface. An unrecognised value falls through to
 * unconfigured and warns — a typo in an environment variable should degrade to
 * typing two fields, not to a page that will not load.
 */
export function resolveLicenceReader(env: NodeJS.ProcessEnv = process.env): LicenceReader {
  const provider = env["LICENCE_OCR_PROVIDER"]?.trim();
  if (provider) {
    console.warn(
      `[verification] LICENCE_OCR_PROVIDER is set to "${provider}" and no reader is registered for it. ` +
        "Falling back to typing the licence number and expiry by hand.",
    );
  }
  return new UnconfiguredLicenceReader();
}
