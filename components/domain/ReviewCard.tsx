import { Card } from "@/components/structure";
import { Eyebrow, RatingMarks, StatusBadge, type StatusTone } from "@/components/display";
import { cn } from "@/lib/cn";

/**
 * One review, wherever a review is shown.
 *
 * Component 67. It exists because the storefront's Reviews section needed the
 * markup that `/b/[slug]/reviews` had inline, and the alternative was two
 * renderings of the same record.
 *
 * The inventory's own note on `Thread` says why that is not acceptable: *"a
 * buyer and a seller reading different renderings of the same record is the one
 * thing a record must never do."* A review shown one way on the reviews page and
 * another way inside a storefront section is the same failure, and the two would
 * drift the first time somebody changed one.
 *
 * Deliberately not passed a Prisma row. The reviews page and the section reach
 * the data by different routes, and a component that takes the shape of one
 * query is a component that breaks when the other one changes.
 *
 * ## What board 1m added
 *
 * The provenance badge, the rating marks, the photo strip and the `row`
 * variant. All optional: the storefront section renders the same component
 * without them and gets exactly what it got before, which is the point of
 * putting them here rather than in a second component.
 *
 * `row` is the reviews page's own presentation — a 1px divider rather than a
 * card, because forty cards down a page is forty boxes and the list stops
 * reading as one list. It is a variant on this component and not a sibling
 * file, per §09.3.
 */

export interface ReviewPhoto {
  id: string;
  url: string;
  alt: string;
}

export interface ReviewCardProps {
  /** Already resolved: the company name, the buyer's name, or the anonymous label. */
  author: string;
  /** Already formatted to one decimal — the caller owns the locale. */
  rating: string;
  /** The same rating as a number, for the marks. Omit to render no marks. */
  ratingValue?: number;
  /** The whole rating as a sentence, e.g. "Rated 4 out of 5". */
  ratingLabel?: string;
  /** Already formatted. */
  date: string;
  body: string;
  /**
   * How this review earned its place, as a word and a tone.
   *
   * Never a bare colour and never the word "purchase": nothing is purchased on
   * this platform, so "Accepted quote" is the strongest thing it can prove and
   * "Verified enquiry" is the rung below it.
   */
  provenance?: { label: string; tone: StatusTone };
  /** Up to a handful. 66×52 on the board; a 2-up grid below 768. */
  photos?: readonly ReviewPhoto[];
  sellerReply?: string | null;
  /** Mono eyebrow above the reply. Names the supplier by display name. */
  replyLabel: string;
  /**
   * Heading level for the author line, where the surrounding page needs one.
   * Off by default: the reviews page has a list and a heading per row would be
   * a heading per row.
   */
  as?: "article" | "li";
  /** `card` in a storefront section, `row` down the reviews page. */
  variant?: "card" | "row";
}

export function ReviewCard({
  author,
  rating,
  ratingValue,
  ratingLabel,
  date,
  body,
  provenance,
  photos,
  sellerReply,
  replyLabel,
  as = "article",
  variant = "card",
}: ReviewCardProps) {
  const marks =
    ratingValue !== undefined && ratingLabel !== undefined ? (
      <RatingMarks value={ratingValue} label={ratingLabel} size="sm" />
    ) : null;

  const inner = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <p className="text-body-sm font-medium text-ink">{author}</p>
          {provenance && (
            <StatusBadge tone={provenance.tone} size="sm">
              {provenance.label}
            </StatusBadge>
          )}
        </div>
        <span className="font-mono text-eyebrow tabular-nums text-muted">
          {/*
             The marks carry the rating on the reviews page, so the numeral
             beside the date would be the same figure twice. On a card with no
             marks it is the only rating there is, and it stays.
          */}
          {marks ? date : `${rating} · ${date}`}
        </span>
      </div>

      {marks && <div className="mt-2">{marks}</div>}

      {/*
         Never truncated behind a "read more". Board 1m: a review a buyer has to
         expand is a review they do not read, and the long ones are the useful
         ones.
      */}
      <p className="mt-2 max-w-[var(--measure-prose)] text-prose text-prose">{body}</p>

      {photos && photos.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {photos.map((photo) => (
            /*
               The box is fixed and clips. An object that has gone missing from
               storage should degrade to an empty frame the row can absorb, not
               to alt text spilling down the page — the review is the content
               here and the photograph is corroboration.
            */
            <li key={photo.id} className="overflow-hidden sm:w-[66px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.url}
                alt={photo.alt}
                loading="lazy"
                className="h-[52px] w-full rounded-chip border border-line bg-paper-sunk object-cover sm:w-[66px]"
              />
            </li>
          ))}
        </ul>
      )}

      {sellerReply && (
        /*
         * The seller's reply is inside the review, not beside it. A reply
         * rendered as a sibling reads as a second opinion; rendered inside, it
         * reads as an answer — which is what it is, and what makes a bad review
         * with a good reply worth more than no review at all.
         */
        <div className="mt-3 rounded-chip border-s-2 border-brand bg-paper-sunk p-3">
          {/*
             `Eyebrow` rather than the `text-faint` this carried when it was
             extracted. That token is 2.70:1 on a card against a 4.5:1 floor and
             is pinned in docs/contrast.md; the reviews page renders this label
             once per reply, which would have added a row of nodes to that list.
          */}
          <Eyebrow>{replyLabel}</Eyebrow>
          <p className="mt-1 text-body-sm text-body">{sellerReply}</p>
        </div>
      )}
    </>
  );

  if (variant === "row") {
    const Tag = as;
    return <Tag className="border-b border-line py-5 last:border-b-0">{inner}</Tag>;
  }

  return <Card as={as}>{inner}</Card>;
}

/**
 * A review held for a moderation decision.
 *
 * One neutral line where the row would be — no body, no rating, no reviewer.
 * Board 1m rules out the alternative in as many words: leaving it visible with
 * a warning attached publishes the complaint and the doubt at once, which is
 * worse for the seller than taking it down and worse for the buyer than showing
 * it. It is out of every average on the page while it stands.
 *
 * Rendered here rather than in the page because it is a member of the same
 * list, and a list whose items come from two files is a list that gets two
 * paddings.
 */
export function ReviewHeldRow({
  label,
  as = "li",
  variant = "row",
}: {
  label: string;
  as?: "article" | "li";
  variant?: "card" | "row";
}) {
  const Tag = as;
  const className = cn(
    "text-body-sm text-muted",
    variant === "row" ? "border-b border-line py-5 last:border-b-0" : "",
  );
  return <Tag className={className}>{label}</Tag>;
}
