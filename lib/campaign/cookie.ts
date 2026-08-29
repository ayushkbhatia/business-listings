import "server-only";
import { cookies } from "next/headers";
import { ATTRIBUTION_COOKIE, decode, type Attribution } from "./attribution";

/**
 * Reading the attribution `proxy.ts` stored.
 *
 * Only the read half lives here. Writing happens in the proxy, because a page
 * component cannot modify cookies in the App Router and a tagged link can land
 * on any page rather than only a campaign one.
 */

/** What to attribute an enquiry to. Empty when the buyer arrived untagged. */
export async function readAttribution(): Promise<Attribution> {
  const jar = await cookies();
  return decode(jar.get(ATTRIBUTION_COOKIE)?.value);
}
