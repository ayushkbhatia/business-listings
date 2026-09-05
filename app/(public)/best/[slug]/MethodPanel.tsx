import { Eyebrow } from "@/components/display";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { Criterion } from "@/lib/seo/curated";

/**
 * Board 6b §2 — the method panel, and the reason anyone reads this page.
 *
 * *"Every 'best of' list in this market is sold. This one is not, and the entire
 * value of the page rests on that difference being verifiable by a reader who
 * assumes we are lying."* Which is why the method is printed in the hero rather
 * than buried in a policy page.
 *
 * ## It renders from the list's own record
 *
 * Not from a config file and not from live data. §2: *"If the criteria for a
 * given list differ, the panel differs — it is a record of how *this* list was
 * chosen, not a statement of general policy."* Acceptance 10 tests exactly that,
 * and general policy lives on `/verification-policy`.
 *
 * ## The "Never" row is the point of the panel
 *
 * Three Required and one Never. A rule about what does **not** count is the one
 * a reader most wants stated and the one every competitor omits, so it is not a
 * footnote — it renders in `--coral`, the only place on the page that colour
 * appears, because the reader should find it before they find anything else.
 *
 * There is no `weighted` kind. The one weighted criterion was the site visit,
 * withdrawn on 5 Sep, and nothing replaced it — see `criteria.ts`.
 */
export function MethodPanel({
  criteria,
  label,
  auditedAt,
}: {
  criteria: readonly Criterion[];
  /** Already localised by the caller: the labels carry numbers from the rules. */
  label: (criterion: Criterion) => string;
  auditedAt: Date | null;
}) {
  if (criteria.length === 0) return null;

  return (
    <aside
      aria-labelledby="how-we-chose"
      className="w-full shrink-0 rounded-card border border-ink-line bg-ink-raised p-5 lg:w-[300px]"
    >
      <Eyebrow as="h2" onInk id="how-we-chose">
        {t("best.how_we_chose")}
      </Eyebrow>

      {/*
         A description list, because that is what it is: a term and its verdict.
         A table would imply columns that mean something across rows, and there
         is only ever one value per criterion.
      */}
      <dl className="mt-3.5 flex flex-col gap-2.5">
        {criteria.map((criterion) => (
          <div key={criterion.key} className="flex items-baseline justify-between gap-4">
            <dt className="text-caption text-on-ink">{label(criterion)}</dt>
            <dd
              className={cn(
                "shrink-0 text-caption",
                criterion.kind === "never" ? "text-bad-on-ink" : "text-moss-on-ink",
              )}
            >
              {criterion.kind === "never" ? t("best.kind.never") : t("best.kind.required")}
            </dd>
          </div>
        ))}
      </dl>

      {auditedAt && (
        /*
           §2's last line, and §3's whole argument in one sentence: the page does
           not promise its numbers are current, it says when they were measured.
           A dated figure a reader can check is worth more than a live figure
           they cannot.
        */
        <p className="mt-4 border-t border-ink-line pt-3.5 text-caption leading-relaxed text-on-ink-muted">
          {t("best.measured_on", { date: formatDate(auditedAt) })}
        </p>
      )}
    </aside>
  );
}
