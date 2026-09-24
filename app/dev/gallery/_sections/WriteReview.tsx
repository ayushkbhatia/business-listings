import {
  ChooseBody,
  NoticeBody,
  OthersPanel,
  ReviewBand,
  ReviewedBody,
  ReviewHeader,
  RulesPanel,
  StepsPanel,
} from "@/app/(public)/review/new/_parts";
import { ReviewWriteForm } from "@/app/(public)/review/new/ReviewWriteForm";
import { buildReviewWrite, type ReviewWriteData } from "@/lib/reviews/write-view";
import { t } from "@/lib/i18n";
import { Section, States } from "../_kit";
import {
  REVIEW_WRITE_NOW,
  anonymousReview,
  chooseSupplier,
  drawnReview,
  editReview,
  emptyReview,
  notEligible,
  notPermitted,
  notYetOpen,
  reviewedEditable,
  reviewedFixed,
  reviewedHeld,
  reviewedRemoved,
  reviewedReplied,
  windowClosed,
} from "./review-write-fixture";

/**
 * Board 10f — `/review/new`, in every state §States names and the ones the build
 * found beside them.
 *
 * Every specimen is facts run through `buildReviewWrite`, the route's own path,
 * on one fixed clock. The form is drawn with `live` off: nothing saves, uploads
 * or posts, and it renders no landmark, so eight copies of the page do not put
 * eight regions of one name in front of the landmarks spec.
 */
function Specimen({ data, name, flash = null }: { data: ReviewWriteData; name: string; flash?: "posted" | "saved" | null }) {
  const view = buildReviewWrite(data, { now: REVIEW_WRITE_NOW, token: null, flash });
  const ids = (key: string) => `${name}-${key}`;
  const rules = <RulesPanel rules={view.rules} id={ids("who-can-review")} />;
  const bottom = (
    <>
      {view.steps ? <StepsPanel steps={view.steps} id={ids("after-you-post")} /> : null}
      <OthersPanel others={view.others} id={ids("other-enquiries")} />
    </>
  );
  const header = <ReviewHeader view={view} headingAs="h3" differentJobHref={`#${ids("other-enquiries")}`} />;

  return (
    <div className="w-full overflow-hidden rounded-card border border-line bg-paper">
      <ReviewBand view={view} label={`${t("reviewwrite.crumb.label")} · ${name}`} />
      <div className="grid gap-[var(--gutter)] px-5 py-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {data.kind === "form" ? (
          <ReviewWriteForm
            mode={data.mode}
            enquiryId={data.enquiry.id}
            businessId={data.supplier.id}
            reviewId={data.reviewId}
            token={null}
            initial={data.fields}
            photoUrls={data.photoUrls}
            company={data.company}
            supplierName={data.supplier.displayName}
            supplierListed={data.supplier.listed}
            provenance={data.provenance}
            postedAt={REVIEW_WRITE_NOW.toISOString()}
            draftSavedAt={data.draftSavedAt?.toISOString() ?? null}
            cancelHref={data.mode === "edit" ? "#write-review" : null}
            header={header}
            railTop={rules}
            railBottom={bottom}
            live={false}
            idPrefix={name}
          />
        ) : (
          <>
            <div className="min-w-0">
              {header}
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
            <div className="flex min-w-0 flex-col gap-4">
              {rules}
              {bottom}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function WriteReviewGallery() {
  return (
    <Section id="write-review" title="Write a review" note="board 10f · /review/new?enq=">
      <States label="draft in progress · as drawn" stack>
        <Specimen data={drawnReview()} name="drawn" />
      </States>
      <States label="eligible, no draft · post disabled" stack>
        <Specimen data={emptyReview()} name="empty" />
      </States>
      <States label="confirmed enquiry · no company on the account" stack>
        <Specimen data={anonymousReview()} name="anonymous" />
      </States>
      <States label="editing inside 14 days" stack>
        <Specimen data={editReview()} name="edit" />
      </States>
      <States label="already reviewed · editable" stack>
        <Specimen data={reviewedEditable()} name="reviewed" flash="posted" />
      </States>
      <States label="seller has replied · read-only" stack>
        <Specimen data={reviewedReplied()} name="replied" />
      </States>
      <States label="after 14 days · fixed" stack>
        <Specimen data={reviewedFixed()} name="fixed" />
      </States>
      <States label="held in moderation" stack>
        <Specimen data={reviewedHeld()} name="held" />
      </States>
      <States label="removed by staff" stack>
        <Specimen data={reviewedRemoved()} name="removed" />
      </States>
      <States label="window closed · form absent" stack>
        <Specimen data={windowClosed()} name="closed" />
      </States>
      <States label="not eligible · no reply, no acceptance" stack>
        <Specimen data={notEligible()} name="refused" />
      </States>
      <States label="account cannot write reviews · staff role, no buyer role (build plan 9.4)" stack>
        <Specimen data={notPermitted()} name="not-permitted" />
      </States>
      <States label="several suppliers replied · choose one" stack>
        <Specimen data={chooseSupplier()} name="choose" />
      </States>
      <States label="engagement · reviews not open yet" stack>
        <Specimen data={notYetOpen()} name="not-yet-open" />
      </States>
    </Section>
  );
}
