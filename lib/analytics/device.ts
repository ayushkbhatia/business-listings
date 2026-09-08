import type { DeviceKind } from "@/lib/db/generated/client";

/**
 * Three buckets, from a user-agent string. Board `3l`'s device split.
 *
 * Pure and deliberately coarse. A device string is a fingerprinting surface,
 * and the only question any screen asks of it is whether the buyer web needs a
 * mobile pass — which three buckets answer. Nothing here records a model, an
 * operating system version or a screen size, because nothing reads one.
 *
 * ## Tablet is checked first, and that is the whole subtlety
 *
 * Every tablet user-agent on the market also says `Mobile` somewhere, or says
 * `Macintosh` while being an iPad. Checking mobile first buckets every tablet
 * as a phone and the split stops meaning anything — 68% mobile is an argument
 * for a mobile pass only if it is actually phones.
 *
 * ## An unknown agent is a desktop
 *
 * Not a fourth bucket. A split with an `unknown` slice invites the reader to
 * wonder what is in it, and the honest answer — a browser we did not recognise,
 * on a page a crawler never reaches — is a rounding error next to the three.
 * The crawler gate upstream is what keeps bots out; this is not that gate.
 */
export function deviceFrom(userAgent: string | null | undefined): DeviceKind {
  if (!userAgent) return "desktop";
  const ua = userAgent.toLowerCase();

  /*
     Tablets, before phones.

     `ipad` is the obvious one and it is not enough: iPadOS 13 and later send a
     desktop Safari agent that says `macintosh`, and the only thing separating it
     from a real Mac is that it reports touch points. A server has no touch
     points to read, so an iPad in desktop mode counts as a desktop here — which
     is what it is asking to be treated as, and is the direction to be wrong in
     for a question about layout.
  */
  if (/ipad|android(?!.*mobile)|tablet|kindle|silk|playbook/.test(ua)) return "tablet";

  // `mobi` rather than `mobile`: Opera Mini and a few others use the short form,
  // and every phone agent contains one or the other.
  if (/mobi|iphone|ipod|windows phone|blackberry|bb10|opera mini/.test(ua)) return "mobile";

  return "desktop";
}
