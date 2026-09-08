import { Delta } from "@/components/display";
import { formatCount, formatDate, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Attribution, RawFactors } from "@/lib/analytics/attribution";
import type { Delta as DeltaValue } from "@/lib/analytics/model";
import type { WeightKey } from "@/lib/search/ranking";

/**
 * The `3a`/`3l` amendment's component — a rank, a movement, and why.
 *
 * Drawn once and placed twice, which is the amendment's own first requirement
 * and this project's most repeated defect. Board `3a`'s card carries a rank
 * among businesses in a category and emirate; board `3l`'s panel carries a rank
 * for a phrase a buyer typed. **Two different numbers, one rendering** — a
 * seller who reads `#2 of 34` on one screen and a differently-shaped `#2` on the
 * other has to work out whether they mean the same kind of thing.
 *
 * The two placements own their own table shapes, because one has a volume
 * column and the other has a category label. What they share is the part a
 * seller compares across tabs: the value cell, and the sentence beneath it.
 *
 * ## The reason attaches to its row
 *
 * `3l` shipped with the explanation floating in a note under the table, which
 * reads correctly while exactly one row has one and cannot say which row it
 * means as soon as two do. Attaching it is what makes this reusable rather than
 * duplicated, and it is a change to a screen that has already shipped.
 *
 * ## Read, never written
 *
 * Position and attribution are derived. There is no control here that changes a
 * number, and no seller-editable field behind either of them.
 */

export type PositionState = "ranked" | "not_ranked" | "not_measured";

export interface PositionValueProps {
  state: PositionState;
  /** One-based. Null in both absence states. */
  rank: number | null;
  /**
   * The size of the ranked set.
   *
   * Renders whenever it is known, because `#3` in a category holding five is
   * flattery and the cold start is the state this platform launches in. Null
   * only on a query row written before the amendment gave that table a
   * denominator; those rows show their rank alone rather than borrowing today's.
   */
  total: number | null;
  movement: DeltaValue;
}

export function PositionValue({ state, rank, total, movement }: PositionValueProps) {
  /*
     Two absences, two renderings, and they are not interchangeable.

     `Not ranked` is a fact about the results: buyers searched it and this
     listing was not there. `Not measured` is a fact about us: we have not
     ranked the category, so we do not know. Collapsing them tells a seller
     something untrue in whichever direction the collapse went.
  */
  if (state === "not_ranked" || rank === null) {
    return (
      <span className="text-caption text-muted">
        {t(state === "not_measured" ? "position.not_measured" : "position.not_ranked")}
      </span>
    );
  }

  return (
    <span className="text-ink">
      <span className="tabular-nums">
        {total === null
          ? `#${formatCount(rank)}`
          : t("position.rank", { rank: formatCount(rank), total: formatCount(total) })}
      </span>{" "}
      <Delta delta={movement} better="down" />
    </span>
  );
}

export interface PositionReasonProps {
  reason: Attribution;
  /** Needed by the commercial sentence, which names the category it was bought for. */
  categoryName?: string;
  /** State 06 renders the night we last ranked it, or says we never have. */
  lastMeasured?: Date | null;
  state?: PositionState;
}

/**
 * The sentence under a row, or nothing.
 *
 * A reason is optional and its absence is finished, not pending. A held
 * position has none. A rise caused by somebody else's decline has none. A rank
 * and a movement with nothing beneath them is a complete state, and drawing a
 * placeholder there would be padding a row to fill a shape.
 */
export function PositionReason({
  reason,
  categoryName,
  lastMeasured,
  state,
}: PositionReasonProps) {
  const body = sentence(reason, categoryName, lastMeasured, state);
  if (!body) return null;
  return <p className="mt-1 text-caption leading-relaxed text-body-ink">{body}</p>;
}

function sentence(
  reason: Attribution,
  categoryName: string | undefined,
  lastMeasured: Date | null | undefined,
  state: PositionState | undefined,
): string | null {
  // State 06 explains itself rather than sitting blank: the seller learns that
  // the silence is ours and when it started, not that they have vanished.
  if (state === "not_measured") {
    return lastMeasured
      ? t("position.not_measured_why", { date: formatDate(lastMeasured) })
      : t("position.not_measured_ever");
  }
  if (state === "not_ranked") return t("position.not_ranked_why");

  switch (reason.kind) {
    case "none":
      return null;

    case "seller":
      return t(reason.direction === "up" ? "attribution.seller.up" : "attribution.seller.down", {
        places: t("attribution.places", { count: reason.places }),
        factor: t(`factors.${reason.factor}`),
        trend: t(reason.trend === "up" ? "attribution.trend.up" : "attribution.trend.down"),
        before: factorValue(reason.factor, reason.before),
        after: factorValue(reason.factor, reason.after),
      });

    case "platform":
      return t("attribution.platform", { date: formatDate(reason.on) });

    case "commercial":
      /*
         Named as a purchase, which is less comfortable than letting a
         five-place fall stand unexplained and is the only version that does not
         let a seller mourn a position they never earned. The second form is for
         a boost that predates the nightly job, where the earned rank is simply
         not recoverable — the first clause is worth saying without it.
      */
      return reason.earnedRank === null
        ? t("attribution.commercial_unknown", {
            category: categoryName ?? "",
            date: formatDate(reason.endedOn),
          })
        : t("attribution.commercial", {
            category: categoryName ?? "",
            date: formatDate(reason.endedOn),
            rank: formatCount(reason.earnedRank),
          });

    case "competitor":
      // No instruction and no offer. This is the commonest fall on the board,
      // and ending it with something to fix fires an improvement prompt every
      // time on a decline the seller did not cause.
      return t("attribution.competitor", {
        count: reason.count,
        factor: t(`factors.${reason.factor}`),
      });

    case "multiple":
      if (reason.factor === null) {
        return t(
          reason.direction === "up"
            ? "attribution.multiple.up_no_leader"
            : "attribution.multiple.down_no_leader",
          { count: formatCount(reason.count) },
        );
      }
      return t(
        reason.direction === "up" ? "attribution.multiple.up" : "attribution.multiple.down",
        {
          count: formatCount(reason.count),
          factor: t(`factors.${reason.factor}`),
          // The adverb, not the verb: "…, up from 4 h to 1 d 7 h".
          trend: t(
            reason.trend === "up" ? "attribution.direction.up" : "attribution.direction.down",
          ),
          before: factorValue(reason.factor, reason.before),
          after: factorValue(reason.factor, reason.after),
        },
      );

    case "unexplained":
      // Never invents a cause. The date is read from the history rather than
      // hardcoded, so it is the prune boundary for an old listing and the
      // seller's own first night for a new one.
      return t("attribution.unexplained", { date: formatDate(reason.historyStarts) });

    default:
      return null;
  }
}

/**
 * One factor, in the units the seller measures it in.
 *
 * The normalised 0..1 score is what the ranker consumed and is meaningless in a
 * sentence: *"your measured reply time fell from 1 to 0.2"* describes an
 * internal scale nobody outside this file has seen. These are the raw values.
 */
function factorValue(factor: WeightKey, raw: RawFactors): string {
  switch (factor) {
    case "responseTime":
      return raw.responseTimeMedianMs === null
        ? t("factors.value.unmeasured")
        : formatDuration(raw.responseTimeMedianMs);
    case "specCompleteness":
      return raw.specCompleteness === null
        ? t("factors.value.unmeasured")
        : t("factors.value.ratio", { percent: formatCount(Math.round(raw.specCompleteness * 100)) });
    case "verificationTier":
      return t("factors.value.tier", { tier: formatCount(raw.verificationTier) });
    case "planTier":
      return t("factors.value.multiplier", { multiplier: raw.planMultiplier.toFixed(2) });
    case "distance":
      return raw.distanceKm === null
        ? t("factors.value.unmeasured")
        : `${formatCount(Math.round(raw.distanceKm))} km`;
    default:
      return t("factors.value.unmeasured");
  }
}
