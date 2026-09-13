import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { getAcceptedRecord } from "@/lib/db/queries/accepted-record";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { resolveBuyerId, trackingTokenFor } from "../../_buyer";
import { AcceptedRecordView } from "./_record";
import { ReferenceForm } from "./ReferenceForm";
import { ReportForm } from "./ReportForm";

/**
 * Board `7c` — the accepted quote record, `/enquiry/:id/accepted`.
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

export const metadata: Metadata = {
  title: t("accepted.meta_title"),
  // Private to one buyer, and every link out carries a bearer token.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function AcceptedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const tokenParam = typeof query["t"] === "string" ? query["t"] : null;

  const buyerId = await resolveBuyerId(tokenParam);
  if (!buyerId) notFound();

  const record = await getAcceptedRecord(buyerId, id);
  if (!record) notFound();

  // Null once the buyer has an account; the session carries them then.
  const token = await trackingTokenFor(buyerId);
  const withToken = (path: string) =>
    token ? `${path}${path.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}` : path;

  const base = `/enquiry/${record.enquiryId}`;

  return (
    <PublicShell nav={<DirectoryNav />} footer={<DirectoryFooter />}>
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
              { label: t("accepted.crumb.current", { ref: record.quote.ref }) },
            ]}
          />
        }
        links={{
          pdf: withToken(`${base}/accepted/pdf`),
          thread: withToken(`${base}/thread/${record.supplier.slug}`),
          review: withToken(`/review/new?enq=${record.enquiryId}`),
        }}
        referenceForm={
          <ReferenceForm enquiryId={record.enquiryId} token={token} current={record.buyerReference} />
        }
        reportForm={<ReportForm enquiryId={record.enquiryId} token={token} />}
      />
    </PublicShell>
  );
}
