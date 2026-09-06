import Link from "next/link";
import { Panel } from "@/components/structure";
import { formatBytes, formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * The rail card the board got wrong, and the correction that outranks it.
 *
 * The board offered: *"41 files are not on a product. Deleting them frees
 * 380 MB."* That conflated **unattached** with **unused**. A file with no
 * product attachment can still be referenced by an enquiry thread, your own
 * listing — or **a quote a buyer already holds**, which is a link we have
 * already sent to a customer.
 *
 * So the card states two numbers, not one: what is genuinely unreferenced and
 * safe to delete, and how many more look unattached and are held. The held ones
 * are refused outright rather than warned about, which is the same position as
 * `3h` §5's flag-not-delist, `6f`'s 301-not-404 and `4e`'s no-grace publish.
 */
export function UnreferencedCard({
  unreferenced,
  unreferencedBytes,
  quoteHeld,
}: {
  unreferenced: number;
  unreferencedBytes: number;
  quoteHeld: number;
}) {
  if (unreferenced === 0 && quoteHeld === 0) return null;

  return (
    <Panel
      eyebrow={
        /*
           `0 unreferenced · 0 B` over a card whose only real content is the
           held count reads as a card about nothing. The eyebrow names whichever
           number is actually there.
        */
        unreferenced > 0
          ? t("media.rail.unreferenced", {
              count: unreferenced,
              n: formatCount(unreferenced),
              size: formatBytes(unreferencedBytes),
            })
          : t("media.rail.held_only", { count: quoteHeld, n: formatCount(quoteHeld) })
      }
    >
      {unreferenced > 0 && (
        <p className="text-caption text-muted">{t("media.rail.unreferenced_body")}</p>
      )}

      {quoteHeld > 0 && (
        <p className={`text-caption text-body ${unreferenced > 0 ? "mt-3 border-t border-line pt-2" : ""}`}>
          {t("media.rail.held", { count: quoteHeld, n: formatCount(quoteHeld) })}
        </p>
      )}

      {unreferenced > 0 && (
        <Link
          href="/dashboard/media?used=nothing"
          className="mt-3 inline-block rounded-tag text-body-sm text-ink underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-focus"
        >
          {t("media.rail.review")}
        </Link>
      )}
    </Panel>
  );
}
