/**
 * Criterion 9 — "campaign pages preserve UTM through to the enquiry and
 * attribute it in admin".
 *
 * The hard part is "through to". A visitor who lands on `/lp/summer-hvac` may
 * read two guides, browse a trade page and send an enquiry twenty minutes
 * later; by then the query string is long gone. Threading it through every link
 * would be fragile and would also put campaign tags in every shared URL, which
 * is somebody else's attribution, not ours.
 *
 * So it is a first-party cookie, written by `proxy.ts` on the first tagged
 * request and read once when an enquiry is created.
 *
 * It has to be the proxy rather than the campaign page: a page component cannot
 * modify cookies in the App Router — Next refuses with "cookies can only be
 * modified in a Server Action or Route Handler" — and a tagged link can point
 * at a guide or a trade page as easily as at `/lp/...`, so capturing it in one
 * place catches all of them.
 *
 * **What is stored:** three UTM values, and the campaign slug where they landed
 * on one of ours. Nothing identifying, nothing about the person, and nothing
 * the inbound link did not already declare in the address bar. `utm_content`
 * and `utm_term` are dropped on the way in rather than stored and ignored.
 *
 * Pure so the parsing, the window and the first-touch rule are testable without
 * a request.
 */

export const ATTRIBUTION_COOKIE = "bl_attr";

/**
 * Thirty days.
 *
 * Long enough to cover a buyer who reads a guide in June and specifies a job in
 * July, short enough that a campaign is not still claiming credit a quarter
 * later. It is a marketing convention rather than a discovered number, and it
 * is here as one constant so changing it is one edit.
 */
export const ATTRIBUTION_MAX_AGE_S = 30 * 86_400;

export interface Attribution {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  /**
   * The `/lp/<slug>` they entered on, where they entered on one of ours.
   *
   * A slug rather than an id, because this is written by the proxy — which runs
   * before any database client exists. `createEnquiry` resolves it to a
   * `Campaign` row, and a slug that no longer matches one simply resolves to
   * null rather than failing the enquiry.
   */
  campaignSlug: string | null;
}

export const EMPTY: Attribution = {
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  campaignSlug: null,
};

/** A UTM value is a short label. Anything else is somebody probing. */
const VALUE = /^[\w .\-|+%]{1,64}$/;

function clean(value: string | string[] | undefined): string | null {
  const one = Array.isArray(value) ? value[0] : value;
  if (typeof one !== "string") return null;
  const trimmed = one.trim();
  if (trimmed === "" || !VALUE.test(trimmed)) return null;
  return trimmed;
}

/**
 * Read attribution out of a query string.
 *
 * Returns null when there is nothing worth storing, so a caller can tell
 * "arrived untagged" from "arrived tagged with nothing" and leave an existing
 * cookie alone rather than overwriting it with blanks.
 */
export function fromSearchParams(
  params: Record<string, string | string[] | undefined>,
  campaignSlug: string | null = null,
): Attribution | null {
  const utmSource = clean(params["utm_source"]);
  const utmMedium = clean(params["utm_medium"]);
  const utmCampaign = clean(params["utm_campaign"]);

  if (!utmSource && !utmMedium && !utmCampaign && !campaignSlug) return null;
  return { utmSource, utmMedium, utmCampaign, campaignSlug };
}

/** Serialise for the cookie. Compact, and readable in a devtools panel. */
export function encode(attribution: Attribution): string {
  return JSON.stringify([
    attribution.utmSource,
    attribution.utmMedium,
    attribution.utmCampaign,
    attribution.campaignSlug,
  ]);
}

/**
 * Parse a cookie value.
 *
 * Anything unexpected reads as no attribution rather than throwing. A cookie is
 * attacker-controlled input, and an enquiry that fails to send because somebody
 * pasted junk into one is a worse outcome than an enquiry with no source on it.
 */
export function decode(raw: string | undefined): Attribution {
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    const [source, medium, campaign, slug] = parsed;
    return {
      utmSource: typeof source === "string" ? clean(source) : null,
      utmMedium: typeof medium === "string" ? clean(medium) : null,
      utmCampaign: typeof campaign === "string" ? clean(campaign) : null,
      // The same slug shape the `campaign` table's check constraint enforces.
      campaignSlug:
        typeof slug === "string" && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && slug.length <= 64
          ? slug
          : null,
    };
  } catch {
    return EMPTY;
  }
}

/** Whether there is anything to record. */
export function isEmpty(attribution: Attribution): boolean {
  return (
    attribution.utmSource === null &&
    attribution.utmMedium === null &&
    attribution.utmCampaign === null &&
    attribution.campaignSlug === null
  );
}

/**
 * First touch wins.
 *
 * A visitor who arrives on a campaign, then comes back a week later through an
 * organic search, was won by the campaign — the second visit is the campaign
 * working. Last-touch would credit the search engine for demand somebody else
 * created, which is the argument every attribution model has, settled here in
 * one direction and written down.
 */
export function merge(existing: Attribution, incoming: Attribution | null): Attribution {
  if (!incoming) return existing;
  if (!isEmpty(existing)) return existing;
  return incoming;
}
