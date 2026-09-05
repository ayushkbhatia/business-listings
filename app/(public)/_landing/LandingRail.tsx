import Link from "next/link";
import { Card } from "@/components/structure";
import { Eyebrow } from "@/components/display";
import { Button } from "@/components/primitives";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { LandingRelatedRow, ReadNextItem } from "@/lib/seo/landing";

/**
 * Board 6a §5 — the right rail. Three cards, and only the ones with something
 * in them.
 *
 * RELATED SEARCHES is editorial and capped at five. READ NEXT is derived from
 * the lists and guides that name this scope. The claim prompt is the one place
 * on the page addressed to a seller rather than a buyer, and its copy is
 * load-bearing — see the note on `ClaimPrompt`.
 */

export function RelatedSearches({ rows }: { rows: readonly LandingRelatedRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="rail-related">
      <Card>
      <Eyebrow as="h2" id="rail-related">
        {t("landing.related_searches")}
      </Eyebrow>
      <ul className="mt-3 flex flex-col gap-2.5">
        {rows.map((row) => (
          <li key={row.id}>
            <a
              href={row.href}
              className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              {row.label}
            </a>
          </li>
        ))}
      </ul>
      </Card>
    </section>
  );
}

export function ReadNext({ items }: { items: readonly ReadNextItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="rail-read-next">
      <Card>
      <Eyebrow as="h2" id="rail-read-next">
        {t("landing.read_next")}
      </Eyebrow>
      <ul className="mt-3 flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              className="rounded-tag text-caption font-medium leading-snug text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              {item.title}
            </a>
            {/*
               The kicker is mono because it is a machine-assigned label and a
               measurement, which is what mono is for. `GUIDE · 6 MIN` is
               derived from the article's own word count — an editable
               read-time field is a claim an article can outgrow.
            */}
            <p className="mt-1 font-mono text-eyebrow uppercase text-muted">
              {item.kind === "curated_list"
                ? t("landing.kicker_list")
                : t("landing.kicker_guide", { minutes: item.minutes ?? 1 })}
            </p>
          </li>
        ))}
      </ul>
      </Card>
    </section>
  );
}

/**
 * The claim prompt.
 *
 * The board's own correction note is the spec for this copy:
 *
 *   *"Claiming is not a ranking promise. 'claim it free and you'll appear above
 *    them' implied claiming outranks the verified. Rewritten: unclaimed
 *    listings rank last, claiming enters the ranking, verification lifts it —
 *    which is what `1b`'s ranking config actually does."*
 *
 * Criterion 9 tests both halves of that: unclaimed listings appear last on
 * every page of results, and the card promises entry to the ranking rather than
 * a position in it.
 *
 * Absent where nothing is unclaimed. A card asking a seller to claim one of
 * nought listings is the padding rule broken in the seller's direction.
 */
export function ClaimPrompt({
  unclaimed,
  listings,
  subject,
}: {
  unclaimed: number;
  listings: number;
  /** "HVAC company in Al Quoz?" — already assembled by the caller. */
  subject: string;
}) {
  if (unclaimed === 0) return null;
  return (
    <section
      aria-labelledby="rail-claim"
      className="rounded-card border border-line bg-paper-sunk p-4"
    >
      <h2 id="rail-claim" className="text-caption font-medium text-ink">
        {subject}
      </h2>
      <p className="mt-2 text-caption leading-relaxed text-body">
        {t("landing.claim_body", {
          listings: formatCount(listings),
          unclaimed: formatCount(unclaimed),
        })}
      </p>
      {/*
         `Link`, not an anchor: the claim flow is a route in this app and the
         lint rule is about the client-side transition. The `Button` keeps
         `tabIndex={-1}` so the link is the one focusable thing, and the box is
         the anchor's — an anchor with `display: contents` generates no box and
         cannot be focused at all in Blink, which is how this project's primary
         seller call to action was once unreachable by keyboard on every page.
      */}
      <Link
        href="/onboarding/claim"
        className="mt-3 inline-flex rounded-ctl focus-visible:outline-none focus-visible:shadow-focus"
      >
        <Button size="sm" tabIndex={-1}>
          {t("landing.claim_action")}
        </Button>
      </Link>
    </section>
  );
}
