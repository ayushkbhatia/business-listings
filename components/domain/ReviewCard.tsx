import { Card } from "@/components/structure";

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
 */

export interface ReviewCardProps {
  /** Already resolved: the company name, the buyer's name, or the anonymous label. */
  author: string;
  /** Already formatted to one decimal — the caller owns the locale. */
  rating: string;
  /** Already formatted. */
  date: string;
  body: string;
  sellerReply?: string | null;
  /** Mono eyebrow above the reply. */
  replyLabel: string;
  /**
   * Heading level for the author line, where the surrounding page needs one.
   * Off by default: the reviews page has a list and a heading per row would be
   * a heading per row.
   */
  as?: "article" | "li";
}

export function ReviewCard({
  author,
  rating,
  date,
  body,
  sellerReply,
  replyLabel,
  as = "article",
}: ReviewCardProps) {
  return (
    <Card as={as}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-body-sm text-ink">{author}</p>
        <span className="font-mono text-eyebrow tabular-nums text-muted">
          {rating} · {date}
        </span>
      </div>

      <p className="mt-2 max-w-[var(--measure-prose)] text-prose text-prose">{body}</p>

      {sellerReply && (
        /*
         * The seller's reply is inside the review, not beside it. A reply
         * rendered as a sibling reads as a second opinion; rendered inside, it
         * reads as an answer — which is what it is, and what makes a bad review
         * with a good reply worth more than no review at all.
         */
        <div className="mt-3 rounded-chip border-s-2 border-brand bg-paper-sunk p-3">
          <p className="font-mono text-eyebrow uppercase text-faint">{replyLabel}</p>
          <p className="mt-1 text-body-sm text-body">{sellerReply}</p>
        </div>
      )}
    </Card>
  );
}
