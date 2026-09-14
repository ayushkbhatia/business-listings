/**
 * How long an SMS is, the way a carrier counts it. Board 12g `B8`.
 *
 * *"SMS bodies are 160 characters, no exceptions."* True only while every
 * character is in the GSM-7 alphabet. One character outside it — an em dash, a
 * curly apostrophe, an Arabic letter — and the whole message is encoded UCS-2,
 * where a single segment holds 70. The seeded in-app copy uses em dashes freely;
 * the same sentence pasted into an SMS would be billed as three segments to
 * eight sellers per enquiry, and nothing on the editor would have said so.
 *
 * So the limit is 160 or 70 depending on what was typed, and the editor says
 * which, and why. Characters from GSM-7's extension table (`{`, `}`, `[`, `]`,
 * `~`, `\`, `|`, `^`, `€`) are legal and cost two.
 *
 * Measured on the rendered message rather than the template: `{area}` is six
 * characters in the body and twenty-four in "Dubai Investments Park 2". The
 * caller renders with `sampleParams`, which is deliberately long-valued.
 *
 * Pure.
 */

const BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const EXTENDED = "^{}\\[~]|€";

export const SMS_GSM_LIMIT = 160;
export const SMS_UNICODE_LIMIT = 70;

export interface SmsLength {
  /** Characters as the carrier counts them: extension-table characters are two. */
  units: number;
  /** The single-segment limit for this encoding. */
  limit: typeof SMS_GSM_LIMIT | typeof SMS_UNICODE_LIMIT;
  encoding: "gsm7" | "unicode";
  /** The first characters that forced UCS-2, deduplicated, for the editor to name. */
  offending: string[];
  fits: boolean;
}

export function smsLength(text: string): SmsLength {
  let units = 0;
  const offending = new Set<string>();

  for (const char of text) {
    if (BASIC.includes(char)) units += 1;
    else if (EXTENDED.includes(char)) units += 2;
    else offending.add(char);
  }

  if (offending.size > 0) {
    // UCS-2 counts code units, so a character outside the BMP is two.
    const length = text.length;
    return {
      units: length,
      limit: SMS_UNICODE_LIMIT,
      encoding: "unicode",
      offending: [...offending].slice(0, 5),
      fits: length <= SMS_UNICODE_LIMIT,
    };
  }

  return { units, limit: SMS_GSM_LIMIT, encoding: "gsm7", offending: [], fits: units <= SMS_GSM_LIMIT };
}
