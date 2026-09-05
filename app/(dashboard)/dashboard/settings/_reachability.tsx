import Link from "next/link";
import { StatusBadge, type StatusTone } from "@/components/display";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { SeatReachability } from "@/lib/team/reachability";

/**
 * Board 7e §3 — can this seat be reached.
 *
 * The mirror of board 7d's `REACHABLE ON` column, from the other side, and the
 * card that makes the matrix above it deliverable: a `GOES TO` of "the assigned
 * seat" means nothing if that seat has no verified channel.
 *
 * It replaced the board's `Why WhatsApp is default-on` card, which carried an
 * unsourced cross-seller claim — *sellers who enable WhatsApp alerts reply 3.4×
 * faster than those on email only.* Same class as the claims cut from boards 3j
 * and 3k. There is a real version of that sentence and it is on board 7d §5,
 * out of the seller's own record.
 *
 * ## Kinds, never addresses
 *
 * Board 7d §6.1: "not show one seat's numbers to another seat." An owner needs
 * to know that Fatima is on email only — that is what lets them fix a team that
 * cannot be reached — and does not need her mobile number. Nothing in this
 * component receives an address.
 */
export function ReachabilityRail({
  rows,
}: {
  rows: readonly { userId: string; name: string; isYou: boolean; reach: SeatReachability }[];
}) {
  return (
    <Panel title={t("reach.heading")} description={t("reach.privacy")} padded={false}>
      <div className="overflow-x-auto contain-paint">
        <table className="w-full min-w-[30rem] border-collapse text-left">
          <caption className="sr-only">{t("reach.caption")}</caption>
          <thead>
            <tr className="bg-paper-sunk">
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                {t("reach.col.seat")}
              </th>
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                {t("reach.col.channels")}
              </th>
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                {t("reach.col.state")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId} className="border-t border-line">
                <th scope="row" className="px-3 py-2 text-left text-body-sm font-normal text-ink">
                  {row.name}
                  {row.isYou && (
                    <span className="ml-1.5 font-mono text-eyebrow uppercase text-faint">
                      {t("team.you")}
                    </span>
                  )}
                </th>
                <td className="px-3 py-2 text-body-sm text-ink">
                  {row.reach.verified.length === 0 ? (
                    <span className="text-muted">{t("reach.none")}</span>
                  ) : (
                    row.reach.verified
                      .map((kind) => t(`channels.kind.${kind}` as "channels.kind.whatsapp"))
                      .join(" · ")
                  )}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge tone={toneFor(row.reach)} size="sm" shape="chip">
                    {stateFor(row.reach)}
                  </StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-1 border-t border-line px-3 py-2.5">
        <p className="max-w-prose text-caption text-muted">{t("reach.rule")}</p>
        <Link
          href="/dashboard/team"
          className="text-caption underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-focus"
        >
          {t("team.title")}
        </Link>
      </div>
    </Panel>
  );
}

function stateFor(reach: SeatReachability): string {
  if (reach.suspended) return t("reach.state.suspended");
  // Finance, and anybody else who cannot open an enquiry. Not a fault: 7d §2
  // says a Finance seat is never a routing target, whatever it has verified.
  if (!reach.canTakeLeads) return t("reach.state.not_lead_seat");
  if (reach.verified.length === 0) return t("reach.state.none");
  return reach.slowOnly ? t("reach.state.slow") : t("reach.state.ok");
}

function toneFor(reach: SeatReachability): StatusTone {
  if (reach.suspended) return "bad";
  if (!reach.canTakeLeads) return "neutral";
  if (reach.verified.length === 0) return "bad";
  return reach.slowOnly ? "warn" : "ok";
}
