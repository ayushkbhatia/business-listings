import { formatDate, formatList } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import type { NoticeResult, Rail, RailStep } from "./dunning-rail";

/**
 * The rail's sentences — one function for board 3m and board 12i, so the seller
 * and the person they ring read the same words about the same step.
 *
 * Every sentence about a notice is about a delivery row. A step with no row
 * says nothing was recorded rather than implying a send (spec S3: *"No
 * sentence on the banner refers to a message that has no delivery row"*).
 */

export type StepTone = "ok" | "warn" | "bad" | "neutral";

export interface StepLine {
  key: RailStep["key"];
  /** `Day 3 · Email`. */
  label: string;
  /** What happened, or what will. */
  text: string;
  tone: StepTone;
  /** A notice that reached nobody links to where a seller fixes that. */
  needsChannel: boolean;
}

const channelWord = (channel: string) => t(`notifications.channel_word.${channel}` as MessageKey);

export const RESULT_TONE: Record<NoticeResult, StepTone> = {
  delivered: "ok",
  deferred: "warn",
  pending: "neutral",
  failed: "bad",
  no_template: "bad",
  skipped: "neutral",
};

/** The reason a notice did not arrive, in the console's own words. */
export function reasonText(reason: string | null): string {
  if (!reason) return t("notifications.reason.unrecorded");
  const key = `notifications.reason.${reason}` as MessageKey;
  const text = t(key);
  return text === key ? reason : text;
}

/** Who reads the rail. Staff read "the seller cancelled" where a seller reads "you cancelled". */
export type RailAudience = "seller" | "staff";

function noticeText(step: RailStep, audience: RailAudience): { text: string; tone: StepTone; needsChannel: boolean } {
  if (step.state === "not_after_cancel") {
    return {
      text: t(audience === "staff" ? "billing.rail.staff.not_after_cancel" : "billing.rail.not_after_cancel"),
      tone: "neutral",
      needsChannel: false,
    };
  }
  if (step.state === "upcoming") {
    return {
      text: t(step.key === "final_notice" ? "billing.rail.final_upcoming" : "billing.rail.notice_upcoming", { when: formatDate(step.at) }),
      tone: "neutral",
      needsChannel: false,
    };
  }
  const result = step.result ?? "skipped";
  if (step.deliveries.length === 0) {
    // The stage moved and nothing was written: a run from before notices were sent (S6).
    return { text: t("billing.rail.no_record", { when: formatDate(step.at) }), tone: "neutral", needsChannel: false };
  }
  if (result === "delivered") {
    const sentAt = step.deliveries.find((d) => d.status === "sent")?.sentAt ?? step.at;
    return {
      text: t(step.recipientName ? "billing.rail.sent_to" : "billing.rail.sent", {
        channels: formatList(step.deliveredOn.map(channelWord)),
        who: step.recipientName ?? "",
        when: formatDate(sentAt),
      }),
      tone: "ok",
      needsChannel: false,
    };
  }
  if (result === "deferred") {
    const until = step.deliveries.find((d) => d.status === "deferred")?.scheduledFor;
    return { text: t("billing.rail.deferred", { when: until ? formatDate(until) : formatDate(step.at) }), tone: "warn", needsChannel: false };
  }
  if (result === "pending") return { text: t("billing.rail.pending"), tone: "neutral", needsChannel: false };
  return {
    text: t("billing.rail.not_delivered", { reason: reasonText(step.failureReason) }),
    tone: "warn",
    needsChannel: result === "skipped" || result === "failed",
  };
}

export function railLines(
  rail: Rail,
  input: { gatewayLive: boolean; cancelled: boolean; audience?: RailAudience },
): StepLine[] {
  const audience = input.audience ?? "seller";
  return rail.steps.map((step): StepLine => {
    const label = t(`billing.rail.step.${step.key}` as MessageKey, { day: String(step.day) });
    if (step.key === "card") {
      return {
        key: step.key,
        label,
        text: step.retried
          ? t("billing.rail.card_tried", { when: formatDate(step.at) })
          : input.gatewayLive
            ? t("billing.rail.card_not_yet")
            : t("billing.rail.card_no_gateway"),
        tone: "neutral",
        needsChannel: false,
      };
    }
    if (step.key === "drop") {
      return {
        key: step.key,
        label,
        text:
          step.state === "done"
            ? t("billing.rail.drop_done", { when: formatDate(step.at) })
            : t(
                input.cancelled
                  ? audience === "staff"
                    ? "billing.rail.staff.drop_cancelled"
                    : "billing.rail.drop_cancelled"
                  : "billing.rail.drop_upcoming",
                { when: formatDate(step.at) },
              ),
        tone: step.state === "done" ? "neutral" : "warn",
        needsChannel: false,
      };
    }
    return { key: step.key, label, ...noticeText(step, audience) };
  });
}
