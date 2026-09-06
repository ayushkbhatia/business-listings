import Link from "next/link";
import { Panel } from "@/components/structure";
import { buttonClassName } from "@/components/primitives";
import type { Coverage, LibraryRow, ProposedField } from "@/lib/spec/library";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 4e's 352px rail — three cards, and one absent button.
 *
 * ## The draft card no longer offers a grace period
 *
 * The board's card read: publishing v4 "will leave 88,410 products with two
 * empty required fields until sellers fill them", with `Publish with 60-day
 * grace` beneath it. Board `3h` §6 — exported before this screen was specced —
 * is that additive platform changes land **not required**, so nothing is left
 * in violation and there is nothing to postpone. The copy here says what
 * publishing actually does, and then says that requiring a field is a separate
 * action, because that is the sentence the board's single button was hiding.
 *
 * The primary action is `Review blast radius`, not publish. Publishing happens
 * inside the review — the `3h` §8 pending-changes model applied to the admin
 * side of the same data.
 *
 * ## The coverage card is the top of a worklist, not the worklist
 *
 * 322 rows is a tab. The card is its top three, ranked by products already
 * listed in a subcategory with no template — the products that exist and cannot
 * be filtered.
 *
 * ## The proposed-fields card has no `Promote`
 *
 * The board's was one click into a definition 412 sellers already have their
 * own version of — 7 labels, 3 types, 2 unit conventions between them, so there
 * is no single value for a button to write. §7 replaces it with a merge behind
 * a preview that creates a **dictionary attribute** and maps the seller fields
 * whose type and unit match. The dictionary has a nav item, a header button and
 * no board in the 95, so there is nowhere for that merge to write; per the
 * handoff's Q2 it is deferred and the merge is deferred with it. What ships is
 * the spread, which is the fact that makes promotion a merge — and a row
 * stating it is honest whether or not the action exists yet.
 */

export function DraftCard({ drafts }: { drafts: readonly LibraryRow[] }) {
  const first = drafts[0];
  // Absent with nothing pending rather than empty — board 4e's `No drafts`
  // state. The tab still reads `0`; a card that renders "nothing here" is a
  // card that has to be read before it can be dismissed.
  if (!first || first.draftVersion === null) return null;

  return (
    <Panel
      eyebrow={t("admin.spec.draft.eyebrow", {
        version: String(first.draftVersion),
        name: first.name,
      })}
    >
      <p className="font-mono text-eyebrow uppercase text-muted">
        {t("admin.spec.draft.count", { count: drafts.length, n: formatCount(drafts.length) })}
      </p>
      <p className="mt-2 text-body-sm text-body">
        {t("admin.spec.draft.lands", { count: first.clones, n: formatCount(first.clones) })}
      </p>
      <p className="mt-2 border-t border-line pt-2 text-caption text-muted">
        {t("admin.spec.draft.requiring")}
      </p>
      <Link
        href={`/admin/spec-library/${first.id}#review`}
        className={`${buttonClassName({ block: true })} mt-3`}
      >
        {t("admin.spec.draft.review", { count: first.clones, n: formatCount(first.clones) })}
      </Link>
    </Panel>
  );
}

export function CoverageCard({ coverage }: { coverage: Coverage }) {
  const top = coverage.gaps.slice(0, 3);
  return (
    <Panel
      eyebrow={t("admin.spec.coverage.eyebrow", {
        count: coverage.gaps.length,
        n: formatCount(coverage.gaps.length),
      })}
    >
      <p className="text-caption text-muted">{t("admin.spec.coverage.body")}</p>
      {top.length === 0 ? (
        <p className="mt-2 text-body-sm text-body">{t("admin.spec.coverage.none")}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {top.map((gap) => (
            <li key={gap.id} className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-body-sm text-ink">{gap.name}</span>
                <span className="block font-mono text-eyebrow uppercase tabular-nums text-muted">
                  {t("admin.spec.coverage.counts", {
                    products: formatCount(gap.products),
                    count: gap.listings,
                    n: formatCount(gap.listings),
                  })}
                </span>
              </span>
              {gap.held ? (
                <span className="shrink-0 rounded-chip border border-line px-2 py-0.5 font-mono text-eyebrow uppercase text-muted">
                  {t("admin.spec.coverage.held")}
                </span>
              ) : (
                <Link
                  href={`/admin/spec-library?view=coverage#${gap.slug}`}
                  className={`${buttonClassName({ variant: "secondary", size: "sm" })} shrink-0`}
                >
                  {t("admin.spec.coverage.create")}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {top.some((gap) => gap.held) && (
        <p className="mt-3 border-t border-line pt-2 text-caption text-muted">
          {t("admin.spec.coverage.held_why", {
            name: top.find((gap) => gap.held)?.name ?? "",
          })}
        </p>
      )}
    </Panel>
  );
}

export function ProposedCard({ proposals }: { proposals: readonly ProposedField[] }) {
  return (
    <Panel eyebrow={t("admin.spec.proposed.eyebrow")}>
      <p className="text-caption text-muted">{t("admin.spec.proposed.body")}</p>
      {proposals.length === 0 ? (
        <p className="mt-2 text-body-sm text-body">{t("admin.spec.proposed.empty")}</p>
      ) : (
        <>
          <ul className="mt-3 flex flex-col gap-2">
            {proposals.slice(0, 3).map((proposal) => (
              <li key={proposal.id}>
                <span className="block text-body-sm text-ink">{proposal.sampleLabel}</span>
                <span className="block font-mono text-eyebrow uppercase tabular-nums text-muted">
                  {t("admin.spec.proposed.spread", {
                    count: proposal.businesses,
                    n: formatCount(proposal.businesses),
                    labels: formatCount(proposal.labels),
                    types: formatCount(proposal.types),
                  })}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-line pt-2 text-caption text-muted">
            {t("admin.spec.proposed.no_merge")}
          </p>
        </>
      )}
    </Panel>
  );
}
