import { NextResponse, type NextRequest } from "next/server";
import { assertCanEditProduct } from "@/lib/auth/guards";
import { exportCatalogue } from "@/lib/products/export";
import { recordEvent } from "@/lib/telemetry/record";
import { getSellerSeat } from "../../_shell";

/**
 * Board `3f` §1's `Export ▾`, built by `11d` because it is half of a round trip.
 *
 * `3f` shipped without it and `3h` §6 recorded the export as one-way until this
 * board existed. `3f` Q3 asked whether it produces the file the mapper can read
 * back; `lib/import/round-trip.ts` is the answer, and both halves take their
 * column names from it rather than agreeing by hand.
 *
 * A route rather than a server action, because the result is a download and an
 * action returns a value. It resolves the seat the way every dashboard page
 * does, so a signed-out request gets the same nothing a page would.
 *
 * ## It carries no prices
 *
 * Not as a filter — there is no price on a product to leave out. Non-negotiable
 * 1. That is worth saying here because the sibling export one directory over,
 * `/dashboard/quotes/export`, is full of them and is `no-store` for exactly that
 * reason. This one is a seller's own catalogue, which is public information
 * about their own listings, and it is still `no-store`: it is generated per
 * request against a live catalogue and a cached copy would be a stale one.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const seat = await getSellerSeat();
  if (!seat) return new NextResponse(null, { status: 404 });
  try {
    assertCanEditProduct(seat.actor);
  } catch {
    return new NextResponse(null, { status: 403 });
  }

  /*
     A selection, when the seller exported one from the catalogue's bulk bar.
     Re-scoped by `exportCatalogue`'s own `businessId` filter rather than
     trusted: ids arrive in a query string, and a query string is a suggestion.
  */
  const ids = request.nextUrl.searchParams
    .getAll("id")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value !== "");

  const file = await exportCatalogue({
    businessId: seat.businessId,
    origin: request.nextUrl.origin,
    ...(ids.length > 0 ? { productIds: ids } : {}),
  });

  await recordEvent({
    name: "catalogue_exported",
    businessId: seat.businessId,
    actorId: seat.actor.id,
    // Row count, so an export that produced nothing is visible as one rather
    // than as a seller who never tried.
    props: { rows: file.rows, selection: ids.length > 0 },
  });

  return new NextResponse(file.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
