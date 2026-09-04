import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { Alert, Eyebrow } from "@/components/display";
import { t } from "@/lib/i18n";
import { EMIRATES } from "@/lib/uae";
import { findClaimMatches, VISIBLE_MATCHES, type ClaimCandidate } from "@/lib/onboarding/claim";
import { recordClaimSearch } from "@/lib/onboarding/search-log";
import { ClaimMatchList, type ClaimMatchRow } from "./ClaimMatchList";

/**
 * What a search returned — the results card, or the honest absence of one.
 *
 * The three states are genuinely different and are drawn as three things:
 *
 *   - **An exact licence match.** One row under a mono `EXACT LICENCE MATCH`
 *     line. A licence number identifies one record, so alternatives beside it
 *     would only invite somebody to pick a wrong one.
 *   - **Similar names.** Up to six rows with the count in the header, the rest
 *     expanding in place.
 *   - **Nothing.** No results card at all, and the add-new card promoted. Never
 *     an empty card and never "0 matches" as a heading — a zero rendered as a
 *     result is a worse answer than no result.
 *
 * This component is the async half of the page, behind its own Suspense
 * boundary. The search runs here, so the skeleton in the fallback is a real
 * loading state and the shell above it has already painted.
 */

export async function ClaimResults({
  query,
  signedIn,
}: {
  query: string;
  signedIn: boolean;
}) {
  const matches = await findClaimMatches(query);

  /*
     Logged before anything renders, whatever came back.
     A search that returns nothing is a supplier we do not have, and that is the
     same recruitment signal as a buyer's zero-result search. See
     lib/onboarding/search-log.ts for why it lands in two tables.
  */
  await recordClaimSearch(query, matches.total);

  if (matches.kind === "none") {
    return (
      <>
        <p className="mt-6 max-w-prose text-body-sm text-body">{t("claim.no_results")}</p>
        <AddBusinessCard signedIn={signedIn} promoted />
      </>
    );
  }

  const rows = toRows(matches.results, signedIn);
  const anyClaimed = matches.results.some((r) => r.claimStatus === "claimed");

  /*
     One string for the eyebrow and for the region's name. Two would drift, and
     a landmark announced as "1 possible match" over a card headed
     "EXACT LICENCE MATCH" tells two people two different things about the same
     card.
  */
  const heading =
    matches.kind === "exact_licence"
      ? t("claim.exact_licence")
      : t("claim.matches_head", { count: matches.total });

  return (
    <>
      <section
        aria-label={heading}
        className="mt-6 overflow-hidden rounded-card-lg border border-line bg-card"
      >
        <div className="border-b border-line bg-paper-sunk px-4 py-3">
          <Eyebrow>{heading}</Eyebrow>
        </div>

        <ClaimMatchList rows={rows} visible={VISIBLE_MATCHES} />
      </section>

      {/*
        Only where somebody is actually looking at a claimed row. The dispute
        route is not a general disclaimer; it is the answer to the worst moment
        in this flow, and it belongs beside the moment.
      */}
      {anyClaimed && (
        <div className="mt-3">
          <Alert tone="info">{t("claim.dispute_note")}</Alert>
        </div>
      )}

      {/*
        Stated on the screen where the promise is made. Claiming inherits
        history, not trust: the reviews and the enquiries carry over, and the
        badge is still earned at the next step with the licence in hand.
      */}
      <p className="mt-3 max-w-prose text-caption text-muted">{t("claim.not_trust")}</p>

      <AddBusinessCard signedIn={signedIn} />
    </>
  );
}

/**
 * The board's row action table, in one place.
 *
 * | Unclaimed, best match  | This is us       | primary   |
 * | Unclaimed, others      | This is us       | secondary |
 * | Already claimed        | Report a dispute | secondary |
 *
 * The primary goes to the first *unclaimed* row rather than to the first row.
 * A dispute is a fallback path and should never be the loudest control on a
 * screen; where every match is already claimed the results card carries no
 * primary at all and the add-new card takes it.
 */
function toRows(candidates: readonly ClaimCandidate[], signedIn: boolean): ClaimMatchRow[] {
  const best = candidates.find((c) => c.claimStatus !== "claimed")?.id ?? null;

  return candidates.map((candidate) => {
    const claimed = candidate.claimStatus === "claimed";
    return {
      id: candidate.id,
      /*
         Board 2a and the details panel on `1d` are the only two surfaces a
         legal trade name belongs on, and this is the one that could not work
         without it. An unclaimed record has no display name anybody chose, and
         three near-identical results are told apart by the suffix, the
         authority prefix and the area — stripping `LLC` from
         `Gulf Cool Technical Services LLC` removes the disambiguator the person
         reading the list is scanning for. The display name takes over the
         moment the listing is claimed, on every public surface.
      */
      name: candidate.tradeName, // licence-locked
      categoryCode: candidate.categoryCode,
      meta: metaLine(candidate),
      claimed,
      href: funnelHref(
        `/onboarding/verify?business=${candidate.id}${claimed ? "&dispute=1" : ""}`,
        signedIn,
      ),
      primary: candidate.id === best,
    };
  });
}

/**
 * `{category} · {area}, {emirate} · {licence number}`, with anything missing
 * dropped rather than rendered as a gap.
 *
 * The licence number is what tells three near-identical trade names apart, so
 * it is the last thing to go and never abbreviated.
 */
function metaLine(candidate: ClaimCandidate): string {
  const place = [candidate.areaName, candidate.emirate ? emirateName(candidate.emirate) : null]
    .filter(Boolean)
    .join(", ");

  return [candidate.categoryName, place || null, candidate.licenceNumber]
    .filter(Boolean)
    .join(" · ");
}

/**
 * `abu_dhabi` reads as Abu Dhabi.
 *
 * From `EMIRATES`, not from a de-underscoring of the enum value: the labels are
 * proper nouns and "Umm Al Quwain" is not what title-casing `umm_al_quwain`
 * produces. Unknown values fall through unrendered rather than guessed.
 */
function emirateName(emirate: string): string | null {
  return EMIRATES.find((e) => e.value === emirate)?.label ?? null;
}

/**
 * Where "This is us" goes.
 *
 * The search needs no account; choosing a listing does, because a claim has to
 * belong to somebody. Signing up is asked for at that point and carries the
 * chosen listing through in `next`, so nobody comes back from the sign-up form
 * to an empty search.
 */
function funnelHref(path: string, signedIn: boolean): string {
  return signedIn ? path : `/signup?next=${encodeURIComponent(path)}`;
}

/**
 * The add-new card. Dashed, because dashed means "empty, add something here".
 *
 * `promoted` is the no-match state: it is the only thing on offer then, so it
 * takes the primary the results card is not there to carry.
 *
 * Say the time and name the document. A supplier who starts this without their
 * trade licence to hand abandons at the verification step, and an abandoned
 * claim is harder to recover than one that never started.
 */
export function AddBusinessCard({
  signedIn,
  promoted = false,
}: {
  signedIn: boolean;
  promoted?: boolean;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 rounded-card-lg border border-dashed border-line-strong bg-card p-5">
      <div className="min-w-0 flex-1 basis-[16rem]">
        <p className="text-body-sm font-medium text-ink">{t("claim.add_heading")}</p>
        <p className="mt-1.5 text-body-sm text-body">{t("claim.add_body")}</p>
      </div>
      <Link
        href={funnelHref("/onboarding/profile?new=1", signedIn)}
        className={[
          buttonClassName({ variant: promoted ? "primary" : "secondary", size: "md", block: true }),
          "h-11 w-full sm:h-9 sm:w-auto",
        ].join(" ")}
      >
        {t("claim.add_action")}
      </Link>
    </div>
  );
}

/**
 * Three skeleton rows in the shape of the real ones.
 *
 * Board 2a's "searching" state, and one of the four kinds of empty the design
 * system distinguishes — a loading skeleton is not a first-run state and must
 * not read like one. The count announces politely so somebody who cannot see
 * the shimmer is told the search is running.
 */
export function ClaimResultsSkeleton() {
  return (
    <div
      aria-live="polite"
      aria-busy="true"
      className="mt-6 overflow-hidden rounded-card-lg border border-line bg-card"
    >
      <div className="border-b border-line bg-paper-sunk px-4 py-3">
        <Eyebrow>{t("claim.searching")}</Eyebrow>
      </div>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="flex items-center gap-3 border-t border-line-mid px-4 py-3.5 first:border-t-0"
        >
          <span aria-hidden="true" className="size-11 shrink-0 animate-pulse rounded-chip bg-fill" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span aria-hidden="true" className="h-3 w-1/2 animate-pulse rounded-tag bg-fill" />
            <span aria-hidden="true" className="h-2.5 w-3/4 animate-pulse rounded-tag bg-fill" />
          </span>
        </div>
      ))}
    </div>
  );
}
