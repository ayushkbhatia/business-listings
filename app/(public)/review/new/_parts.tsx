import Link from "next/link";
import { Eyebrow, LogoTile, StatusBadge } from "@/components/display";
import { ReviewCard } from "@/components/domain";
import { Breadcrumb, Card } from "@/components/structure";
import { Check, Close } from "@/components/primitives/icons";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DIMENSIONS, type Provenance } from "@/lib/reviews/eligibility";
import { reviewAuthor, reviewRowProps } from "@/lib/reviews/row-view";
import { DIMENSION_LABEL, type ReviewFields } from "@/lib/reviews/write";
import type {
  JobCardView,
  OtherEnquiryView,
  RailRule,
  RailStep,
  ReviewWriteView,
} from "@/lib/reviews/write-view";

/**
 * Board 10f — the pieces of `/review/new`, worded already.
 *
 * No hooks and no directive: the page renders them on the server, the client
 * form renders the preview among them, and the gallery renders all of them from
 * a fixture. One set, so the three cannot drift.
 */

/** The band under the nav: where this is, and how long it stays open. */
export function ReviewBand({
  view,
  label = t("reviewwrite.crumb.label"),
}: {
  view: Pick<ReviewWriteView, "crumbs" | "band">;
  /** The trail's landmark name. The gallery names each specimen's apart. */
  label?: string;
}) {
  return (
    <div className="border-b border-line bg-paper-sunk">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-1.5 px-5 py-2.5">
        <Breadcrumb label={label} items={view.crumbs} />
        {view.band ? <p className="text-body-sm text-prose">{view.band}</p> : null}
      </div>
    </div>
  );
}

/** The title, the sentence under it, and the job the review is about — named before any question. */
export function ReviewHeader({
  view,
  headingAs = "h1",
  differentJobHref = "#other-enquiries",
}: {
  view: Pick<ReviewWriteView, "title" | "lede" | "job">;
  headingAs?: "h1" | "h2" | "h3";
  differentJobHref?: string;
}) {
  const Heading = headingAs;
  return (
    <div>
      <Heading className="font-serif text-h1-serif text-ink">{view.title}</Heading>
      {view.lede ? (
        <p className="mt-2 max-w-[var(--measure-prose)] text-prose text-prose">{view.lede}</p>
      ) : null}
      {view.job ? <JobCard job={view.job} differentJobHref={differentJobHref} /> : null}
    </div>
  );
}

function JobCard({ job, differentJobHref }: { job: JobCardView; differentJobHref: string }) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border border-line bg-card p-4">
      <LogoTile name={job.supplierName} {...(job.categoryCode ? { categoryCode: job.categoryCode } : {})} />
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-body font-medium text-ink">{job.supplierName}</p>
        <p className="mt-0.5 font-mono text-eyebrow uppercase tracking-wide text-muted">{job.meta}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {job.provenance ? <StatusBadge tone={job.provenance.tone}>{job.provenance.label}</StatusBadge> : null}
        <Link
          href={differentJobHref}
          className="rounded-tag text-body-sm text-ink underline underline-offset-2 hover:text-moss focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("reviewwrite.job.different")}
        </Link>
      </div>
    </div>
  );
}

/** A rail card with its mono heading. Headings are `h2`: the rail is part of the page's outline. */
export function RailPanel({
  title,
  id,
  sunk = false,
  children,
}: {
  title: string;
  id?: string;
  sunk?: boolean;
  children: React.ReactNode;
}) {
  /*
     A div, not a labelled section: a labelled section is a region landmark, and
     the gallery draws this page several times over — eight regions called
     *Who can review* is the duplicate-landmark failure `landmarks.spec` exists
     to catch. The `h2` carries the outline.
  */
  return (
    <div id={id} className={cn("scroll-mt-24 rounded-card border border-line p-5", sunk ? "bg-paper-sunk" : "bg-card")}>
      <Eyebrow as="h2">{title}</Eyebrow>
      <div className="mt-3">{children}</div>
    </div>
  );
}

/** *Who can review* — two things that hold and two that never do, marked in words as well as by mark. */
export function RulesPanel({ rules, id }: { rules: readonly RailRule[]; id?: string }) {
  return (
    <RailPanel title={t("reviewwrite.rules.title")} id={id ?? "who-can-review"}>
      <ul className="flex flex-col gap-3">
        {rules.map((rule) => (
          <li key={rule.text} className="flex items-start gap-2.5 text-body-sm text-prose">
            <span aria-hidden="true" className={cn("mt-0.5 shrink-0", rule.holds ? "text-moss" : "text-bad-ink")}>
              {rule.holds ? <Check size={16} /> : <Close size={16} />}
            </span>
            <span>
              <span className="sr-only">{t(rule.holds ? "reviewwrite.rules.holds" : "reviewwrite.rules.never")} </span>
              {rule.text}
            </span>
          </li>
        ))}
      </ul>
    </RailPanel>
  );
}

/** *What happens after you post*, as an ordered list. */
export function StepsPanel({ steps, id }: { steps: readonly RailStep[]; id?: string }) {
  return (
    <RailPanel title={t("reviewwrite.steps.title")} id={id ?? "after-you-post"}>
      <ol className="flex flex-col gap-4">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span
              aria-hidden="true"
              className="flex size-6 shrink-0 items-center justify-center rounded-pill border border-line-strong bg-card font-mono text-eyebrow text-muted"
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-body-sm font-medium text-ink">{step.title}</p>
              <p className="mt-0.5 text-body-sm text-prose">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </RailPanel>
  );
}

/** *Your other enquiries* — one that qualifies beside one that does not, with the reason. */
export function OthersPanel({
  others,
  id = "other-enquiries",
}: {
  others: ReviewWriteView["others"];
  id?: string;
}) {
  return (
    <RailPanel title={t("reviewwrite.other.title")} id={id} sunk>
      {others.rows.length === 0 ? (
        <p className="text-body-sm text-muted">{others.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {others.rows.map((row) => (
            <OtherRow key={row.id} row={row} />
          ))}
        </ul>
      )}
      {others.more ? (
        <p className="mt-3 text-caption text-muted">
          {others.moreHref ? (
            <Link
              href={others.moreHref}
              className="rounded-tag text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {others.more}
            </Link>
          ) : (
            others.more
          )}
        </p>
      ) : null}
    </RailPanel>
  );
}

function OtherRow({ row }: { row: OtherEnquiryView }) {
  return (
    <li>
      <Link
        href={row.href}
        className="flex items-center justify-between gap-3 rounded-card border border-line bg-card px-3.5 py-3 hover:border-line-strong focus-visible:shadow-focus focus-visible:outline-none"
      >
        <span className="min-w-0">
          <span className="line-clamp-2 text-body-sm text-ink">{row.headline}</span>
          <span className="mt-0.5 block truncate font-mono text-eyebrow uppercase tracking-wide text-muted">
            {row.meta}
          </span>
        </span>
        <span className={cn("max-w-[9rem] shrink-0 text-end text-caption", row.tone === "open" ? "text-warn-ink" : "text-muted")}>
          {row.state}
        </span>
      </Link>
    </li>
  );
}

/** The four scores under a review, with a skipped one said as skipped rather than as a zero. */
export function DimensionScores({ fields }: { fields: Pick<ReviewFields, (typeof DIMENSIONS)[number]> }) {
  return (
    <dl className="grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
      {DIMENSIONS.map((key) => (
        <div key={key} className="flex items-baseline justify-between gap-2 sm:justify-start">
          <dt className="text-caption text-muted">{t(DIMENSION_LABEL[key])}</dt>
          <dd className={cn("text-caption", fields[key] === null ? "text-muted" : "font-mono font-medium tabular-nums text-ink")}>
            {fields[key] === null ? t("review.dimension_skipped") : fields[key]}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface ReviewCopyProps {
  fields: ReviewFields;
  photoUrls: Readonly<Record<string, string>>;
  company: string | null;
  supplierName: string;
  provenance: Provenance;
  /** The day it was, or will be, posted. */
  postedAt: Date;
  sellerReply?: string | null;
  replyRemoved?: boolean;
}

/**
 * The review as board 1m's row renders it, through `reviewRowProps` — the same
 * mapping the listing uses — with the four scores beneath, which 1m counts in
 * its averages but does not print per row.
 */
export function ReviewCopy(props: ReviewCopyProps) {
  const { fields } = props;
  if (fields.overall === null) {
    return <p className="text-body-sm text-muted">{t("reviewwrite.preview.empty")}</p>;
  }
  const card = reviewRowProps({
    id: "preview",
    author: reviewAuthor(fields.showCompanyName, props.company),
    overall: fields.overall,
    createdAt: props.postedAt,
    provenance: props.provenance,
    body: fields.body.trim() || t("reviewwrite.preview.no_body"),
    photos: fields.photos.flatMap((photo, index) => {
      const url = props.photoUrls[photo.path];
      return url ? [{ id: `${index}-${photo.path}`, url, alt: null }] : [];
    }),
    sellerReply: props.sellerReply ?? null,
    replyRemoved: props.replyRemoved ?? false,
    sellerName: props.supplierName,
  });
  // No anchor on a preview: `#review-<id>` belongs to the row on the listing.
  const row = { ...card, anchorId: undefined };
  return (
    <div className="rounded-card border border-line bg-paper px-4">
      <ul>
        <ReviewCard {...row} />
      </ul>
      <div className="border-t border-line py-3">
        <DimensionScores fields={fields} />
      </div>
    </div>
  );
}

export function noticeLink(href: string, label: string) {
  return (
    <Link
      key={href}
      href={href}
      className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
    >
      {label}
    </Link>
  );
}

/** A state with no form: the rule, the day and a way out (§States: *absent, not disabled*). */
export function NoticeBody({ body }: { body: Extract<ReviewWriteView["body"], { kind: "notice" }> }) {
  return (
    <Card padded>
      <h2 className="text-body font-medium text-ink">{body.title}</h2>
      <p className="mt-1.5 max-w-[var(--measure-prose)] text-body-sm text-prose">{body.body}</p>
      {body.links.length > 0 ? (
        <p className="mt-3 flex flex-wrap gap-4">{body.links.map((link) => noticeLink(link.href, link.label))}</p>
      ) : null}
    </Card>
  );
}

export function ChooseBody({ body }: { body: Extract<ReviewWriteView["body"], { kind: "choose" }> }) {
  return (
    <Card padded>
      <p className="max-w-[var(--measure-prose)] text-body-sm text-prose">{body.body}</p>
      <ul className="mt-4 flex flex-col gap-2">
        {body.options.map((option) => (
          <li key={option.id}>
            <Link
              href={option.href}
              className="flex items-center justify-between gap-3 rounded-card border border-line bg-card px-4 py-3 text-body-sm text-ink hover:border-line-strong focus-visible:shadow-focus focus-visible:outline-none"
            >
              <span>{option.label}</span>
              <span className="text-caption text-moss">{t("reviewwrite.choose.pick")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The buyer's own copy once posted, with what they may still do to it. */
export function ReviewedBody({
  body,
  copy,
}: {
  body: Extract<ReviewWriteView["body"], { kind: "reviewed" }>;
  copy: ReviewCopyProps;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-line bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={body.status.tone} dot>
            {body.status.label}
          </StatusBadge>
        </div>
        <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-prose">{body.status.body}</p>
        {body.editHref || body.listingHref ? (
          <p className="mt-3 flex flex-wrap items-center gap-4">
            {body.editHref ? (
              <Link
                href={body.editHref}
                className="inline-flex min-h-9 items-center rounded-ctl border border-line-strong bg-card px-3.5 text-body-sm text-ink hover:bg-fill focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("reviewwrite.reviewed.edit")}
              </Link>
            ) : null}
            {body.listingHref && body.listingLabel ? noticeLink(body.listingHref, body.listingLabel) : null}
          </p>
        ) : null}
      </div>
      <div>
        <h2 className="sr-only">{t("reviewwrite.reviewed.copy_heading")}</h2>
        <ReviewCopy {...copy} />
        <p className="mt-2 text-caption text-muted">
          {t("reviewwrite.reviewed.posted_on", { date: formatDate(copy.postedAt) })}
        </p>
      </div>
    </div>
  );
}
