import type { Metadata } from "next";
import { after } from "next/server";
import { notFound } from "next/navigation";
import { PublicShell } from "@/components/structure";
import { DirectoryFooter } from "@/app/(public)/_chrome";
import { ViewerNav } from "@/app/(public)/_account-menu";
import { loadNegotiation } from "@/lib/messaging/negotiation-server";
import { markThreadRead } from "@/lib/messaging/service";
import { markSellerQuotesRead } from "@/lib/messaging/receipts";
import { t } from "@/lib/i18n";
import { resolveBuyerId, trackingTokenFor } from "../../../_buyer";
import { actorFor } from "@/lib/auth/actor";
import { mayAcceptQuote } from "@/lib/auth/guards";
import { acceptErrorMessage } from "../../../_errors";
import { buildNegotiationView } from "./_build";
import { NegotiationLayout } from "./_view";
import { BuyerNegotiation } from "./NegotiationClient";

/**
 * Board `10h` — the negotiation thread, buyer side.
 *
 * *A fan-out with no reply channel is a price list, not a negotiation.* The rail
 * is the enquiry — every supplier it went to, in the four states a fan-out
 * actually produces, silence included — and the open thread is one of them: its
 * messages, its revisions as priced tables with the old figure struck through,
 * files sent either way, and the accept, stated in full before it is offered.
 *
 * `:id` is the enquiry's reference or its id; `:seller` is the business slug, so
 * a link shared with a colleague is readable and the supplier is already public.
 * A buyer with no account reaches it by the claim token their enquiry carries;
 * a missing enquiry, somebody else's, and a supplier it never went to are all a
 * 404, so the route is not an oracle for which references exist.
 */
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string; seller: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (query: Record<string, string | string[] | undefined>, key: string) =>
  typeof query[key] === "string" ? query[key] : null;

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const { id, seller } = await params;
  const buyerId = await resolveBuyerId(one(await searchParams, "t"));
  const negotiation = buyerId ? await loadNegotiation(buyerId, id, seller) : null;
  return {
    title: negotiation
      ? t("negotiation.meta_title", { supplier: negotiation.supplier.displayName })
      : t("thread.heading"),
    // Private to one buyer, and every link out of it carries a bearer token.
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function NegotiationThreadPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id, seller } = await params;
  const query = await searchParams;

  const buyerId = await resolveBuyerId(one(query, "t"));
  if (!buyerId) notFound();

  const negotiation = await loadNegotiation(buyerId, id, seller);
  if (!negotiation) notFound();

  const { enquiry, supplier } = negotiation;

  /*
     Receipts, after the response. Board 11b §6 for the revisions and board
     `10h` for the messages, and scoped to this supplier either way: opening one
     conversation is evidence about that supplier's words and no others, and
     stamping the three competing threads would make their receipts a lie.
  */
  after(async () => {
    await markSellerQuotesRead(enquiry.id, supplier.id, buyerId);
    await markThreadRead(enquiry.id, supplier.id, { side: "buyer", buyerId });
  });

  const token = await trackingTokenFor(buyerId);
  // Read once, so every relative label on the page measures from one instant.
  const now = new Date();
  const view = buildNegotiationView(negotiation, {
    now,
    token,
    acceptError: acceptErrorMessage(one(query, "error") ?? undefined),
    // Build plan 9.4: asked the way `acceptQuote` asks it, of the record.
    mayAccept: mayAcceptQuote(await actorFor(buyerId)),
  });

  return (
    <PublicShell nav={<ViewerNav />} footer={<DirectoryFooter />} bleed>
      <NegotiationLayout {...view.layout}>
        <BuyerNegotiation {...view.thread} />
      </NegotiationLayout>
    </PublicShell>
  );
}
