/**
 * A seller seat before there is a way to sign in as one.
 *
 * Handoff 2 builds the seller side (step 1) before auth (step 2), on the
 * README's own sequencing: the quote model is far easier to get right while the
 * enquiry is a fixture. That leaves one gap — the dashboard needs to know which
 * business it is acting for.
 *
 * This fills it, and is designed so it cannot survive contact with production:
 *
 *   - `NODE_ENV === "production"` returns null before reading anything.
 *   - It is opt-in. No `DEV_SELLER_SLUG`, no impersonation, even locally.
 *   - It resolves a real seeded owner, so an audit row written during
 *     development names a user that exists rather than a placeholder.
 *
 * Step 2 replaces the call sites with a session and deletes this file. Until
 * then `isDevSeller` is on the context so a screen can say so out loud.
 */
import type { Actor } from "./roles";

export interface DevSellerRequest {
  slug: string;
}

/** Null unless a developer has explicitly asked for it, on a non-production build. */
export function devSellerRequest(env: NodeJS.ProcessEnv = process.env): DevSellerRequest | null {
  if (env["NODE_ENV"] === "production") return null;
  const slug = env["DEV_SELLER_SLUG"]?.trim();
  if (!slug) return null;
  return { slug };
}

export interface DevSellerRow {
  userId: string;
  roles: Actor["roles"];
  businessId: string;
}

export function actorFromDevSeller(row: DevSellerRow): Actor {
  return { id: row.userId, roles: row.roles, businessId: row.businessId };
}
