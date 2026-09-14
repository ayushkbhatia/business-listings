import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PublicShell } from "@/components/structure";
import { DirectoryFooter } from "@/app/(public)/_chrome";
import { ViewerNav } from "@/app/(public)/_account-menu";
import { signInHref } from "@/lib/auth/next-path";
import { t } from "@/lib/i18n";
import { loadReviewWrite } from "@/lib/reviews/write-server";
import { buildReviewWrite, reviewHref } from "@/lib/reviews/write-view";
import { resolveBuyerId, trackingTokenFor } from "@/app/(public)/enquiry/_buyer";
import {
  ChooseBody,
  NoticeBody,
  OthersPanel,
  ReviewBand,
  ReviewedBody,
  ReviewHeader,
  RulesPanel,
  StepsPanel,
} from "./_parts";
import { ReviewWriteForm } from "./ReviewWriteForm";

/**
 * Board 10f — `/review/new?enq=`. The only screen that creates a review, and the
 * one that enforces the gate.
 *
 * **`B1`**: who may review what is resolved on the server from the enquiry
 * (`loadReviewWrite`), and a buyer the gate refuses is shown the reason and the
 * way back — never a form that rejects on submit. The HTTP status of that
 * refusal is 200 rather than the board's 403: `forbidden.tsx` takes no props in
 * this Next, so a 403 could not carry the reason, and the reason is the part of
 * `B1` a buyer reads. The page is `noindex` either way.
 *
 * Signed out and holding no claim token, there is nobody to check the gate for,
 * so the visitor is sent to sign in and brought back — the review-request email
 * lands a claimed buyer here, and a 404 is what that link used to get.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("review.meta_title"),
  robots: { index: false, follow: false },
  // A claim token rides in the query string; it is not handed to the next site.
  referrer: "no-referrer",
};

export default async function WriteReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);

  const enquiryParam = one("enq");
  const tokenParam = one("t") ?? null;

  const buyerId = await resolveBuyerId(tokenParam);
  if (!buyerId) {
    const here = enquiryParam ? `/review/new?enq=${encodeURIComponent(enquiryParam)}` : "/account/enquiries";
    redirect(signInHref(here));
  }
  if (!enquiryParam) redirect("/account/enquiries");

  const now = new Date();
  const token = await trackingTokenFor(buyerId);
  const data = await loadReviewWrite({
    buyerId,
    enquiry: enquiryParam,
    about: one("about") ?? null,
    edit: one("edit") === "1",
    now,
  });
  const flash = one("posted") ? "posted" : one("saved") ? "saved" : null;
  const view = buildReviewWrite(data, { now, token, flash });

  const rules = <RulesPanel rules={view.rules} />;
  const bottom = (
    <>
      {view.steps ? <StepsPanel steps={view.steps} /> : null}
      <OthersPanel others={view.others} />
    </>
  );

  return (
    <PublicShell bleed nav={<ViewerNav />} footer={<DirectoryFooter />}>
      <ReviewBand view={view} />
      <div className="mx-auto grid w-full max-w-7xl gap-[var(--gutter)] px-5 py-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {data.kind === "form" ? (
          <ReviewWriteForm
            mode={data.mode}
            enquiryId={data.enquiry.id}
            businessId={data.supplier.id}
            reviewId={data.reviewId}
            token={token}
            initial={data.fields}
            photoUrls={data.photoUrls}
            company={data.company}
            supplierName={data.supplier.displayName}
            supplierListed={data.supplier.listed}
            provenance={data.provenance}
            postedAt={now.toISOString()}
            draftSavedAt={data.draftSavedAt?.toISOString() ?? null}
            cancelHref={data.mode === "edit" ? reviewHref(data.enquiry.ref, token) : null}
            header={<ReviewHeader view={view} />}
            railTop={rules}
            railBottom={bottom}
          />
        ) : (
          <>
            <div className="min-w-0">
              <ReviewHeader view={view} />
              <div className="mt-5">
                {view.body.kind === "notice" ? <NoticeBody body={view.body} /> : null}
                {view.body.kind === "choose" ? <ChooseBody body={view.body} /> : null}
                {view.body.kind === "reviewed" && data.kind === "reviewed" ? (
                  <ReviewedBody
                    body={view.body}
                    copy={{
                      fields: data.review.fields,
                      photoUrls: data.review.photoUrls,
                      company: data.company,
                      supplierName: data.supplier.displayName,
                      provenance: data.provenance,
                      postedAt: data.review.createdAt,
                      sellerReply: data.review.sellerReply,
                      replyRemoved: data.review.replyRemoved,
                    }}
                  />
                ) : null}
              </div>
            </div>
            <aside aria-label={t("reviewwrite.rail_label")} className="flex min-w-0 flex-col gap-4">
              {rules}
              {bottom}
            </aside>
          </>
        )}
      </div>
    </PublicShell>
  );
}
