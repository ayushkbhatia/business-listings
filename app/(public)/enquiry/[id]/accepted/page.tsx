import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { getAcceptedRecord } from "@/lib/db/queries/accepted-record";
import { t } from "@/lib/i18n";
import { DirectoryFooter } from "@/app/(public)/_chrome";
import { ViewerNav } from "@/app/(public)/_account-menu";
import { resolveBuyerId, trackingTokenFor } from "../../_buyer";
import { AcceptedRecordView } from "./_record";
import { ReferenceForm } from "./ReferenceForm";
import { ReportForm } from "./ReportForm";

/**
 * Boards `7c` and `7c-s` — the accepted record, `/enquiry/:id/accepted`.
 *
 * One route for both shapes, chosen by what was accepted rather than by a
 * second URL: a quote renders its lines and their total; a proposal renders what
 * was agreed — a basis, a term with its dates, the exclusions — and no total.
 * `_record.tsx` makes the choice from the record, so a link a buyer was sent
 * before either board existed still opens the right page.
 *
 * The end of the enquiry flow, and the page that states what the platform is
 * not. A buyer sent one requirement to several suppliers, compared what came
 * back, accepted one — and this is what they hold afterwards: who to call, where
 * to collect from, what was agreed, and where our part stops.
 *
 * ## The route stays where it is
 *
 * The handoff names `/account/enquiries/:id/accepted` and says the board and
 * `docs/routes.md` agree on it. They do not: `docs/routes.md` has registered
 * `/enquiry/:id/accepted` since handoff 1, and every acceptance redirect, email
 * and test links it. More to the point, most buyers have no account — the claim
 * token in `?t=` is how they reach their own enquiry — so an `/account/` path
 * would lock out the buyer the page is for. Board `7a` gates accounts; this
 * record is reachable by whoever `resolveBuyerId` says owns it.
 *
 * `B6` is enforced by the loader, not here: a null record and somebody else's
 * enquiry are the same 404.
 */
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * One read per request for the metadata and the page. Keyed on the id and the
 * token as strings, so `cache` can match them.
 */
const loadRecord = cache(async (id: string, tokenParam: string | null) => {
  const buyerId = await resolveBuyerId(tokenParam);
  if (!buyerId) return null;
  const record = await getAcceptedRecord(buyerId, id);
  return record ? { buyerId, record } : null;
});

const tokenOf = (query: Record<string, string | string[] | undefined>) =>
  typeof query["t"] === "string" ? query["t"] : null;

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const loaded = await loadRecord((await params).id, tokenOf(await searchParams));
  return {
    // Board `7c-s`: the tab names what the buyer holds.
    title: loaded?.record.quote.proposal ? t("accepted.meta_title_proposal") : t("accepted.meta_title"),
    // Private to one buyer, and every link out carries a bearer token.
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function AcceptedPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { id } = await params;
  const loaded = await loadRecord(id, tokenOf(await searchParams));
  if (!loaded) notFound();
  const { buyerId, record } = loaded;

  // Null once the buyer has an account; the session carries them then.
  const token = await trackingTokenFor(buyerId);
  const withToken = (path: string) =>
    token ? `${path}${path.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}` : path;

  const base = `/enquiry/${record.enquiryId}`;

  return (
    <PublicShell nav={<ViewerNav />} footer={<DirectoryFooter />}>
      <AcceptedRecordView
        record={record}
        now={new Date()}
        breadcrumb={
          <Breadcrumb
            label={t("accepted.breadcrumb")}
            items={[
              // A claim-token buyer has no inbox to go back to; a signed-in one does.
              ...(token ? [] : [{ label: t("accepted.crumb.enquiries"), href: "/account/enquiries" }]),
              { label: record.ref, href: withToken(base) },
              {
                label: record.quote.proposal
                  ? t("accepted.crumb.current_proposal", { ref: record.quote.ref })
                  : t("accepted.crumb.current", { ref: record.quote.ref }),
              },
            ]}
          />
        }
        links={{
          pdf: withToken(`${base}/accepted/pdf`),
          thread: withToken(`${base}/thread/${record.supplier.slug}`),
          review: withToken(`/review/new?enq=${record.enquiryId}`),
          /*
             Board `7c-s` Q3: a renewal is a new brief, never an extension of this
             record. To the same firm through `1h-s`'s pinned brief — its service
             where still live — or to the trade. No token: `/rfq/new` is public,
             and a brief is a new enquiry with its own.
          */
          rebrief: record.work
            ? {
                supplier: `/rfq/new?${new URLSearchParams({
                  to: record.supplier.slug,
                  ...(record.work.serviceSlug ? { service: record.work.serviceSlug } : {}),
                })}`,
                others: record.work.tradeSlug
                  ? `/rfq/new?${new URLSearchParams({ category: record.work.tradeSlug, kind: "services" })}`
                  : null,
              }
            : null,
        }}
        referenceForm={
          <ReferenceForm enquiryId={record.enquiryId} token={token} current={record.buyerReference} />
        }
        reportForm={<ReportForm enquiryId={record.enquiryId} token={token} />}
      />
    </PublicShell>
  );
}
