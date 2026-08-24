"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Input } from "@/components/primitives";
import { StatusBadge } from "@/components/display";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ClaimCandidate } from "@/lib/onboarding/claim";
import type { SearchResult } from "../actions";

/**
 * Board 2a — find your business.
 *
 * The reassurance line under each result is the point of the screen. A
 * supplier's first fear when claiming is that it resets them to zero, and the
 * answer is a number: "14 reviews and 38 enquiries stay exactly as they are."
 * A generic "your data is safe" answers nothing, because it is what a product
 * says whether or not it is true.
 */

export interface ClaimSearchProps {
  searchAction: (formData: FormData) => Promise<SearchResult>;
}

export function ClaimSearch({ searchAction }: ClaimSearchProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<string | null>(null);
  const [results, setResults] = useState<ClaimCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function search(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = query.trim();
    if (term.length < 2) return;
    setError(null);

    startTransition(async () => {
      const form = new FormData();
      form.set("query", term);
      const result = await searchAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setResults(result.results);
      setSearched(term);
    });
  }

  /*
   * Hands off rather than submitting.
   *
   * Board 2b picks the route and takes the evidence, and the database check
   * refuses a claim carrying neither — so this step only says *which* listing.
   */
  function choose(candidate: ClaimCandidate) {
    router.push(`/onboarding/verify?business=${candidate.id}`);
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div
          role="alert"
          className="rounded-ctl border border-bad-line bg-bad-surface px-3 py-2 text-body-sm text-bad-ink"
        >
          {error}
        </div>
      )}

      <form onSubmit={search} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-body-sm text-ink">{t("claim.search_label")}</span>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        </label>
        <Button type="submit" disabled={pending || query.trim().length < 2}>
          {pending ? t("claim.searching") : t("claim.search_action")}
        </Button>
      </form>

      {searched !== null && results.length === 0 && (
        <div className="rounded-card border border-line bg-paper-sunk p-4">
          <p className="text-body-sm text-ink">{t("claim.no_results", { query: searched })}</p>
          <p className="mt-1 max-w-prose text-caption text-muted">{t("claim.no_results_body")}</p>
          <a
            href="/onboarding/profile?new=1"
            className="mt-3 inline-block text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("claim.add_new")}
          </a>
        </div>
      )}

      {results.length > 0 && (
        <>
          <p className="text-caption text-muted">
            {t("claim.results", { count: formatCount(results.length) })}
          </p>
          <ul className="flex flex-col gap-3">
            {results.map((candidate) => {
              const taken = candidate.claimStatus === "claimed";
              return (
                <li
                  key={candidate.id}
                  className="flex flex-col gap-2 rounded-card border border-line bg-card p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="block text-body-sm text-ink">{candidate.tradeName}</span>
                      <span className="mt-0.5 block font-mono text-caption text-faint">
                        {candidate.licenceAuthority} · {candidate.licenceNumber}
                        {candidate.areaName ? ` · ${candidate.areaName}` : ""}
                      </span>
                    </div>
                    <StatusBadge tone={taken ? "warn" : "ok"} shape="chip" size="sm">
                      {taken ? t("claim.already_claimed") : t("claim.unclaimed")}
                    </StatusBadge>
                  </div>

                  {/*
                    The number, not a promise. "Your data is safe" is what a
                    product says whether or not it is true.
                  */}
                  <p className="max-w-prose text-caption text-muted">
                    {candidate.reviewCount + candidate.enquiryCount > 0
                      ? t("claim.preserves", {
                          reviews: formatCount(candidate.reviewCount),
                          enquiries: formatCount(candidate.enquiryCount),
                        })
                      : t("claim.preserves_none")}
                  </p>

                  <div>
                    <Button
                      size="sm"
                      variant={taken ? "secondary" : "primary"}
                      disabled={pending}
                      onClick={() => choose(candidate)}
                    >
                      {taken ? t("claim.dispute") : t("claim.this_is_mine")}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
