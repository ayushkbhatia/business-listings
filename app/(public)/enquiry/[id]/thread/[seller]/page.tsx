import { after } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Panel, PublicShell } from "@/components/structure";
import type { ThreadMessageView } from "@/components/domain";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { prisma } from "@/lib/db/client";
import { getThread } from "@/lib/messaging/service";
import { toThreadQuotes } from "@/lib/messaging/thread-view";
import { formatAED, formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { markSellerQuotesRead } from "@/lib/messaging/receipts";
import { resolveBuyerId, trackingTokenFor } from "../../../_buyer";
import { BuyerThread } from "./ThreadClient";

/**
 * Board 10h — the buyer's view of one thread.
 *
 * `:seller` is the business slug rather than an id: a buyer sharing this link
 * with a colleague should not be pasting an opaque cuid, and the slug is
 * already public.
 */
export const dynamic = "force-dynamic";

export default async function BuyerThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; seller: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, seller } = await params;
  const query = await searchParams;
  const token = typeof query["t"] === "string" ? query["t"] : null;

  const buyerId = await resolveBuyerId(token);
  if (!buyerId) notFound();

  // Scoped to the buyer in the same query, so somebody else's enquiry and a
  // missing one are the same answer.
  const enquiry = await prisma.enquiry.findFirst({
    where: { id, buyerId },
    select: { id: true, ref: true, closesAt: true, contactReleasedToBusinessId: true },
  });
  if (!enquiry) notFound();

  const business = await prisma.business.findFirst({
    where: { slug: seller, recipients: { some: { enquiryId: id } } },
    select: { id: true, slug: true, displayName: true },
  });
  if (!business) notFound();

  const [messages, quotes] = await Promise.all([
    getThread(id, business.id),
    prisma.quote.findMany({
      where: { enquiryId: id, businessId: business.id, status: { not: "draft" } },
      orderBy: { revision: "asc" },
      select: { id: true, ref: true, revision: true, lines: { select: { qty: true, unitPrice: true } } },
    }),
  ]);
  if (!messages) notFound();

  /*
     Board 11b §6. Scoped to this supplier: opening one conversation is evidence
     about their revisions and no others, and stamping the three competing quotes
     the buyer has not looked at would make the seller's receipt a lie in the
     other direction.
  */
  after(() => markSellerQuotesRead(id, business.id, buyerId));

  const quoteViews = toThreadQuotes(
    quotes.map((q) => ({
      id: q.id,
      ref: q.ref,
      revision: q.revision,
      lines: q.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice.toString() })),
    })),
    (aed) => formatAED(aed),
    {
      down: (amount, percent) => t("thread.delta_down", { amount, percent }),
      up: (amount, percent) => t("thread.delta_up", { amount, percent }),
      same: t("thread.delta_same"),
    },
  );

  const carry = await trackingTokenFor(buyerId);
  // Read once, so every relative label on this page measures from one instant.
  const now = new Date();
  const closed =
    enquiry.closesAt.getTime() < now.getTime() &&
    enquiry.contactReleasedToBusinessId !== business.id;

  const view: ThreadMessageView[] = messages.map((message) => {
    const quote = message.quoteRevisionId ? quoteViews.get(message.quoteRevisionId) : undefined;
    return {
      id: message.id,
      body: message.body,
      fromMe: !message.fromSeller,
      senderLabel: message.fromSeller ? business.displayName : t("lead.buyer"),
      at: formatDateTime(message.createdAt),
      flagged: message.flagged,
      ...(quote ? { quote } : {}),
    };
  });

  return (
    <PublicShell nav={<DirectoryNav />} footer={<DirectoryFooter />}>
      <div className="mx-auto w-full max-w-[46rem] px-[var(--section-pad)] py-8">
        <p className="font-mono text-eyebrow uppercase text-faint">
          {t("enquiry.ref", { ref: enquiry.ref })}
        </p>
        <h1 className="mt-2 font-serif text-h1-serif text-ink">
          {t("thread.with_supplier", { supplier: business.displayName })}
        </h1>

        {/* Every revision, so the buyer can see the price move even if the
            seller never wrote a message about it. */}
        {quotes.length > 1 ? (
          <div className="mt-5">
            <Panel title={t("lead.previous_quotes")}>
              <ul className="space-y-2">
                {quotes.map((quote) => {
                  const view = quoteViews.get(quote.id)!;
                  return (
                    <li key={quote.id} className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-mono text-body-sm text-muted">{view.ref}</span>
                      <span className="flex items-baseline gap-2">
                        {view.previousTotalLabel ? (
                          <s className="font-mono text-caption text-muted">{view.previousTotalLabel}</s>
                        ) : null}
                        <span className="font-mono text-body-sm tabular-nums text-ink">
                          {view.totalLabel}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </div>
        ) : null}

        <div className="mt-5">
          <Panel title={t("thread.heading")}>
            {closed ? (
              <p className="mb-3 rounded-ctl border border-line bg-paper-sunk px-3 py-2 text-body-sm text-muted">
                {t("thread.closed")}
              </p>
            ) : null}
            <BuyerThread
              enquiryId={enquiry.id}
              businessId={business.id}
              supplierName={business.displayName}
              messages={view}
              token={carry}
              readOnly={closed}
            />
          </Panel>
        </div>

        <p className="mt-4">
          <Link
            href={carry ? `/enquiry/${enquiry.id}?t=${carry}` : `/enquiry/${enquiry.id}`}
            className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("thread.back_to_enquiry")}
          </Link>
        </p>
      </div>
    </PublicShell>
  );
}
