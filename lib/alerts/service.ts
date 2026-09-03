import "server-only";
import { prisma } from "@/lib/db/client";
import { createProvisionalIdentity } from "@/lib/auth/flow";
import { normaliseIdentifier } from "@/lib/auth/identity";
import type { Emirate } from "@/lib/db/generated/enums";

/**
 * Criterion 8 — "a zero-result alert fires when a matching product is later
 * listed."
 *
 * The end of the flywheel, and the only mechanism that turns a failed search
 * into a future enquiry. `ZeroResultQuery` has recorded the gap since handoff 1
 * and the CRM has worked it from the other end since handoff 4; this is what
 * closes it.
 *
 * Two decisions worth stating.
 *
 * **It fires once.** A second notification for the same alert is a subscription
 * nobody asked for, and the database refuses the half-written state — the check
 * constraint requires `notified_at` and `matched_product_id` to be set together
 * or not at all.
 *
 * **It matches conservatively.** A buyer who asked for a stainless DN100 UL/FM
 * valve and is emailed about a plastic elbow will not trust the next one. Every
 * meaningful word of the query has to appear in the product's search text, and
 * the category and emirate filters they had set still apply.
 */

export type AlertRefusal =
  | "no_identity"
  | "query_too_short"
  /** A restock watch on a product that is no longer listed. */
  | "not_found";

export type AlertResult =
  | { ok: true; alertId: string }
  | { ok: false; error: AlertRefusal; message: string };

/**
 * Words short enough to appear in anything are dropped before matching.
 *
 * "in", "for", "a" — a query that matched on those would match everything, and
 * the first false alert is the one that loses the buyer.
 */
const MIN_TOKEN = 3;

/**
 * Split a query into the words worth matching on.
 *
 * Length alone is the wrong rule for this trade. "UL", "FM", "PN" and "DN" are
 * two characters and carry more meaning than anything else in the sentence —
 * an alert for "stainless DN100 UL/FM" that dropped UL and FM would match any
 * stainless DN100, which is precisely the false positive the whole conservative
 * match exists to avoid.
 *
 * So a short token survives when the buyer wrote it in capitals or it carries a
 * digit. "in" and "of" do not; "UL" and "PN16" do.
 */
export function tokensOf(query: string): string[] {
  return query
    .split(/[^\p{L}\p{N}"']+/u)
    .map((token) => token.trim())
    .filter((token) => {
      if (token.length >= MIN_TOKEN) return true;
      if (token.length < 2) return false;
      return /\d/.test(token) || token === token.toUpperCase();
    })
    .map((token) => token.toLowerCase());
}

export interface CreateAlertInput {
  query: string;
  categoryId?: string | null;
  emirate?: Emirate | null;
  zeroResultQueryId?: string | null;
  /** An existing buyer, where they are signed in. */
  userId?: string | null;
  /** Otherwise a phone or an email, and a provisional identity is made. */
  contact?: string | null;
  fullName?: string | null;
}

/**
 * Set an alert from a zero-result page.
 *
 * Most people who reach one have no account — that is the nature of a search
 * that found nothing — so this takes a contact and mints the same provisional
 * identity the RFQ flow does rather than demanding a signup first.
 */
export async function createAlert(input: CreateAlertInput): Promise<AlertResult> {
  const query = input.query.trim();
  if (tokensOf(query).length === 0) {
    return {
      ok: false,
      error: "query_too_short",
      message: "A few words of what you are looking for, so we know what to watch for.",
    };
  }

  let userId = input.userId ?? null;
  if (!userId) {
    const contact = input.contact?.trim();
    if (!contact) {
      return {
        ok: false,
        error: "no_identity",
        message: "A mobile number or an email address, so we have somewhere to tell you.",
      };
    }
    const identity = normaliseIdentifier(contact);
    if (!identity) {
      return {
        ok: false,
        error: "no_identity",
        message: "A UAE mobile number like 050 123 4567, or an email address.",
      };
    }
    /*
       `createProvisionalIdentity` takes a phone, because that is what the RFQ
       flow collects and what OTP needs. An email alert is a real thing to want
       and there is no provisional-by-email path yet — so it is refused with the
       reason rather than accepted and quietly never delivered.
    */
    if (identity.kind !== "phone") {
      return {
        ok: false,
        error: "no_identity",
        message:
          "A mobile number for now. Email alerts need an account, and signing in is at the top of the page.",
      };
    }
    const provisional = await createProvisionalIdentity({
      phone: identity.value,
      fullName: input.fullName?.trim() || null,
    });
    if (!provisional) {
      return {
        ok: false,
        error: "no_identity",
        message: "A UAE mobile number like 050 123 4567.",
      };
    }
    userId = provisional.userId;
  }

  const alert = await prisma.productAlert.create({
    data: {
      query,
      categoryId: input.categoryId ?? null,
      emirate: input.emirate ?? null,
      zeroResultQueryId: input.zeroResultQueryId ?? null,
      userId,
    },
    select: { id: true },
  });

  return { ok: true, alertId: alert.id };
}

/**
 * Watch one product for coming back into stock.
 *
 * Board 1e criterion 7. A `ProductAlert` with a `productId` and no query: the
 * buyer is not asking "tell me if anyone lists something like this", they are
 * asking about *this* line from *this* seller, which is a stronger promise and
 * the one the button on an out-of-stock card makes.
 *
 * Idempotent per buyer and product. Pressing it twice is a buyer checking they
 * pressed it, not a request for two messages.
 */
export async function watchProduct(input: {
  productId: string;
  /** Raw, as typed. Normalised here exactly as `createAlert` does. */
  contact?: string | undefined;
  fullName?: string | undefined;
  userId?: string | undefined;
}): Promise<AlertResult> {
  const product = await prisma.product.findFirst({
    where: {
      id: input.productId,
      status: { not: "draft" },
      business: { suspendedAt: null, publishedAt: { not: null } },
    },
    select: { id: true },
  });
  if (!product) {
    return {
      ok: false,
      error: "not_found",
      message: "That product is no longer listed.",
    };
  }

  let userId = input.userId;
  if (!userId) {
    const contact = input.contact?.trim();
    if (!contact) {
      return {
        ok: false,
        error: "no_identity",
        message: "A mobile number, so we have somewhere to tell you.",
      };
    }
    const identity = normaliseIdentifier(contact);
    if (identity?.kind !== "phone") {
      return {
        ok: false,
        error: "no_identity",
        message:
          "A UAE mobile number like 050 123 4567. Email alerts need an account, and signing in is at the top of the page.",
      };
    }
    const provisional = await createProvisionalIdentity({
      phone: identity.value,
      fullName: input.fullName?.trim() || null,
    });
    if (!provisional) {
      return {
        ok: false,
        error: "no_identity",
        message: "A UAE mobile number like 050 123 4567.",
      };
    }
    userId = provisional.userId;
  }

  const existing = await prisma.productAlert.findFirst({
    where: { productId: product.id, userId, notifiedAt: null },
    select: { id: true },
  });
  if (existing) return { ok: true, alertId: existing.id };

  const alert = await prisma.productAlert.create({
    // Empty query on purpose. The product is the subject; putting its name here
    // would make the gap report count a search nobody typed.
    data: { query: "", productId: product.id, userId },
    select: { id: true },
  });

  return { ok: true, alertId: alert.id };
}

export interface SweepResult {
  open: number;
  fired: { alertId: string; productId: string; query: string }[];
}

/**
 * Match products listed since an alert was set against the open alerts.
 *
 * Runs on the scheduled job beside the others. Not on product creation: a
 * seller importing four hundred rows would otherwise fire four hundred
 * matches inside one request, and the buyer would get whichever one happened
 * to be first rather than the best.
 */
export async function sweepAlerts(now: Date = new Date()): Promise<SweepResult> {
  const open = await prisma.productAlert.findMany({
    where: { notifiedAt: null },
    select: {
      id: true,
      query: true,
      categoryId: true,
      emirate: true,
      createdAt: true,
      userId: true,
      productId: true,
    },
  });

  const fired: SweepResult["fired"] = [];

  for (const alert of open) {
    /*
       A restock watch is a different question and gets a different answer.

       The query branch below asks "has anything like this been listed since
       they asked". This one asks "is that specific line back", which is
       answered by the product's own availability rather than by matching text.
       Before this, a watch with no query fell through the token check and sat
       open forever — which is why the check constraint refuses a row that is
       neither.
    */
    if (alert.productId) {
      const back = await prisma.product.findFirst({
        where: {
          id: alert.productId,
          status: "live",
          availability: { not: "out_of_stock" },
          business: { suspendedAt: null, publishedAt: { not: null }, mergedIntoId: null },
        },
        select: { id: true },
      });
      if (!back) continue;

      await prisma.productAlert.update({
        where: { id: alert.id },
        // Together, or the check constraint refuses the row. The match is the
        // watched product itself — there was never another candidate.
        data: { notifiedAt: now, matchedProductId: back.id },
      });
      fired.push({ alertId: alert.id, productId: back.id, query: alert.query });
      continue;
    }

    const tokens = tokensOf(alert.query);
    if (tokens.length === 0) continue;

    /*
       Every token, not any. A buyer who asked for "stainless DN100 UL/FM" and
       is told about a plastic elbow because it matched "100" will not open the
       next one — and there is exactly one next one.

       Listed after the alert was set, because the point is that something
       changed. A product that was already there when they searched is one the
       search should have found, and telling them about it now would be
       admitting the search was wrong rather than that the market moved.
    */
    const product = await prisma.product.findFirst({
      where: {
        status: "live",
        createdAt: { gt: alert.createdAt, lte: now },
        AND: tokens.map((token) => ({ searchText: { contains: token, mode: "insensitive" as const } })),
        ...(alert.categoryId ? { categoryId: alert.categoryId } : {}),
        business: {
          suspendedAt: null,
          publishedAt: { not: null },
          mergedIntoId: null,
          ...(alert.emirate
            ? { locations: { some: { emirate: alert.emirate, published: true } } }
            : {}),
        },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!product) continue;

    await prisma.productAlert.update({
      where: { id: alert.id },
      // Together, or the check constraint refuses the row.
      data: { notifiedAt: now, matchedProductId: product.id },
    });

    fired.push({ alertId: alert.id, productId: product.id, query: alert.query });
  }

  return { open: open.length, fired };
}
