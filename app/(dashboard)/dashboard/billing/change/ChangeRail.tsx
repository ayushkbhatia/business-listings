"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/primitives";
import { Card } from "@/components/structure";
import { confirmPlanChange, confirmTermChange, withdrawPlanChange } from "../actions";

/**
 * Board 11f's rail: what the change costs, what the seller keeps, and what ends.
 *
 * Every string arrives resolved. Nothing here calls `t()` and nothing takes a
 * function prop — a function crossing the server–client boundary is the repo's
 * most repeated defect and `tests/unit/client-labels` fails the build on it.
 *
 * ## Why this is a client component at all
 *
 * Two buttons that post and then refresh, and an error that has to land beside
 * them rather than on a new page. The comparison grid it sits next to is
 * entirely server-rendered, including the billing-period toggle, which is a
 * link: state that re-prices nine rows belongs in the URL.
 */

export interface QuoteLine {
  key: string;
  label: string;
  amount: string;
  /** Rendered in the ok ink, because it comes off the total. */
  credit: boolean;
}

export interface KeepRow {
  kind: "products" | "locations" | "seats";
  label: string;
  href: string;
  /** `100 chosen`, or what happens if the seller never opens it. */
  chosenLabel: string;
  /** False until the change is scheduled — there is nowhere to record a choice yet. */
  ready: boolean;
}

export interface StorageNote {
  label: string;
  note: string;
  linkLabel: string;
}

export type ChangeRailProps =
  | { state: "idle"; intro: string }
  /**
   * The billing-period toggle is on a term the seller is not paying on, and no
   * plan is selected. `3m`'s `Switch to annual` lands exactly here — the spec
   * calls it *"the same screen with the billing-period toggle already flipped"*
   * — and before this state existed it landed on the idle rail with no way to
   * switch, which made that button a dead end.
   *
   * A term change is not a plan change and does not share its summary: it
   * credits the unused days, opens a new period today, and the renewal date
   * **does** move. The rail says so rather than reusing the sentence that
   * promises the opposite.
   */
  | {
      state: "term";
      summaryEyebrow: string;
      fromTo: string;
      explanation: string;
      lines: QuoteLine[];
      dueTodayLabel: string;
      dueTodayAmount: string;
      inclVat: string;
      term: "monthly" | "annual";
      primaryLabel: string;
      keepCurrentLabel: string;
      providerNote: string | null;
    }
  | {
      state: "upgrade" | "downgrade";
      selectedPlanId: string;
      summaryEyebrow: string;
      fromTo: string;
      explanation: string;
      dueTodayLabel: string;
      dueTodayAmount: string;
      fromDateLabel: string;
      fromDateAmount: string;
      inclVat: string;
      lines: QuoteLine[];
      /**
       * Said when the billing-period toggle is on a term the seller is not
       * paying on. Board 11f's follow-up audit.
       *
       * The columns compare annual prices when the toggle is flipped, and the
       * quote beside them is for the seller's own term — so a monthly seller
       * could read AED 8,990 in the Pro column and AED 943.95 in this rail and
       * have no way to tell which one the button charges. The screen already
       * knew: the comment above `termQuote` in page.tsx says the two "are never
       * quoted together". It just never said it where a seller was looking.
       */
      termMismatch: { note: string; linkLabel: string; href: string } | null;
      keepEyebrow: string;
      keepIntro: string | null;
      keepRows: KeepRow[];
      chooseLabel: string;
      storageNote: StorageNote | null;
      endsEyebrow: string;
      ends: { key: string; text: string }[];
      primaryLabel: string;
      /**
       * Where the primary button goes, instead of posting.
       *
       * Set for one case: the Free column, which is a cancellation rather than a
       * downgrade. It routes to `11h` so the seller is asked for a reason, told
       * what changes, and gets the banner and the email — none of which a plain
       * scheduled change to Free would have done.
       */
      primaryHref?: string;
      keepCurrentLabel: string;
      withdrawLabel: string;
      withdrawNote: string | null;
      /** What the button says, posted back and re-verified. Criterion 7. */
      dueFils: number;
      isPending: boolean;
      /** Set while no gateway is configured, so the rail can say so. */
      providerNote: string | null;
    };

export function ChangeRail(props: ChangeRailProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (props.state === "idle") {
    return (
      <aside className="flex flex-col gap-3.5">
        <Card surface="card" padded>
          <p className="text-caption leading-relaxed text-body-ink">{props.intro}</p>
        </Card>
      </aside>
    );
  }

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) router.refresh();
      else setError(result.error ?? null);
    });
  };

  if (props.state === "term") {
    return (
      <aside className="flex flex-col gap-3.5">
        <Card surface="card" padded>
          <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">
            {props.summaryEyebrow}
          </p>
          <p className="mt-3 text-body font-medium text-ink">{props.fromTo}</p>
          <p className="mt-1.5 text-caption leading-relaxed text-body-ink">{props.explanation}</p>

          <dl className="mt-3.5 flex flex-col gap-2 border-t border-line pt-3.5">
            {props.lines.map((line) => (
              <div key={line.key} className="flex items-baseline justify-between gap-3 text-caption">
                <dt className="min-w-0 text-body-ink">{line.label}</dt>
                <dd
                  className={[
                    "shrink-0 tabular-nums",
                    line.credit ? "text-ok-ink" : "text-ink",
                  ].join(" ")}
                >
                  {line.amount}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-3.5 flex items-baseline justify-between gap-3 border-t border-line pt-3.5 text-caption">
            <dt className="text-body-ink">{props.dueTodayLabel}</dt>
            <dd className="font-medium tabular-nums text-ink">
              {props.dueTodayAmount}{" "}
              <span className="font-normal text-muted">{props.inclVat}</span>
            </dd>
          </div>
        </Card>

        <div className="flex flex-col gap-2.5">
          <Button
            type="button"
            variant="primary"
            disabled={pending}
            onClick={() => {
              const form = new FormData();
              form.set("term", props.term);
              run(() => confirmTermChange(form));
            }}
          >
            {props.primaryLabel}
          </Button>
          <Link
            href="/dashboard/billing"
            className="inline-flex h-9 items-center justify-center rounded-ctl border border-line-strong bg-card text-caption text-body-ink hover:border-line-mid hover:text-ink focus-visible:shadow-focus focus-visible:outline-none"
          >
            {props.keepCurrentLabel}
          </Link>
          {props.providerNote && (
            <p className="text-center text-caption leading-relaxed text-muted">
              {props.providerNote}
            </p>
          )}
          {error && (
            <p role="alert" className="text-caption text-bad-ink">
              {error}
            </p>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex flex-col gap-3.5">
      <Card surface="card" padded>
        <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">
          {props.summaryEyebrow}
        </p>
        <p className="mt-3 text-body font-medium text-ink">{props.fromTo}</p>
        <p className="mt-1.5 text-caption leading-relaxed text-body-ink">{props.explanation}</p>

        {props.lines.length > 0 && (
          <dl className="mt-3.5 flex flex-col gap-2 border-t border-line pt-3.5">
            {props.lines.map((line) => (
              <div key={line.key} className="flex items-baseline justify-between gap-3 text-caption">
                <dt className="min-w-0 text-body-ink">{line.label}</dt>
                <dd
                  className={[
                    "shrink-0 tabular-nums",
                    line.credit ? "text-ok-ink" : "text-ink",
                  ].join(" ")}
                >
                  {line.amount}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-3.5 flex flex-col gap-2 border-t border-line pt-3.5">
          <div className="flex items-baseline justify-between gap-3 text-caption">
            <dt className="text-body-ink">{props.dueTodayLabel}</dt>
            <dd className="font-medium tabular-nums text-ink">{props.dueTodayAmount}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-caption">
            <dt className="text-body-ink">{props.fromDateLabel}</dt>
            <dd className="font-medium tabular-nums text-ink">
              {props.fromDateAmount}{" "}
              {/* Every total is labelled. Rule 3 of the convention. */}
              <span className="font-normal text-muted">{props.inclVat}</span>
            </dd>
          </div>
        </div>

        {props.termMismatch && (
          <p className="mt-3.5 border-t border-line pt-3.5 text-caption leading-relaxed text-warn-ink">
            {props.termMismatch.note}{" "}
            <Link
              href={props.termMismatch.href}
              className="underline underline-offset-2 hover:text-ink"
            >
              {props.termMismatch.linkLabel}
            </Link>
          </p>
        )}
      </Card>

      {(props.keepIntro || props.storageNote) && (
        <Card surface="paper" padded>
          <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-warn-ink">
            {props.keepEyebrow}
          </p>
          {props.keepIntro && (
            <p className="mt-2.5 text-caption leading-relaxed text-body-ink">{props.keepIntro}</p>
          )}

          {props.keepRows.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2.5">
              {props.keepRows.map((row) => (
                <li key={row.kind} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 text-caption text-body-ink">
                    {row.label}
                    <span className="mt-0.5 block text-caption text-muted">{row.chosenLabel}</span>
                  </span>
                  {row.ready ? (
                    <Link
                      href={row.href}
                      className="shrink-0 rounded-tag text-caption font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                    >
                      {props.chooseLabel}
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {props.storageNote && (
            <div className="mt-3 border-t border-warn-line pt-3">
              <p className="text-caption text-body-ink">{props.storageNote.label}</p>
              <p className="mt-1 text-caption leading-relaxed text-muted">
                {props.storageNote.note}
              </p>
              <Link
                href="/dashboard/media"
                className="mt-1.5 inline-block rounded-tag text-caption font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
              >
                {props.storageNote.linkLabel}
              </Link>
            </div>
          )}
        </Card>
      )}

      {props.ends.length > 0 && (
        <Card surface="card" padded>
          <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">
            {props.endsEyebrow}
          </p>
          <ul className="mt-2.5 flex flex-col gap-2">
            {props.ends.map((item) => (
              <li key={item.key} className="text-caption leading-relaxed text-body-ink">
                {item.text}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex flex-col gap-2.5">
        {props.isPending ? (
          /*
             Already scheduled: the only thing left to do is take it back.
             `11f` reached again before the date offers to withdraw, not to
             schedule a second one — Q8.
          */
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => withdrawPlanChange())}
          >
            {props.withdrawLabel}
          </Button>
        ) : (
          <>
            {props.primaryHref ? (
              <Link
                href={props.primaryHref}
                className="inline-flex h-9 items-center justify-center rounded-ctl border border-moss bg-moss px-3.5 text-caption font-medium text-on-ink hover:border-moss-hover hover:bg-moss-hover focus-visible:shadow-focus focus-visible:outline-none"
              >
                {props.primaryLabel}
              </Link>
            ) : (
              <Button
                type="button"
                variant="primary"
                disabled={pending}
                onClick={() => {
                  const form = new FormData();
                  form.set("planId", props.selectedPlanId);
                  // What the button said, checked server-side against a fresh
                  // quote. A mismatch refuses the charge rather than adjusting it.
                  form.set("dueFils", String(props.dueFils));
                  run(() => confirmPlanChange(form));
                }}
              >
                {props.primaryLabel}
              </Button>
            )}
            <Link
              href="/dashboard/billing"
              className="inline-flex h-9 items-center justify-center rounded-ctl border border-line-strong bg-card text-caption text-body-ink hover:border-line-mid hover:text-ink focus-visible:shadow-focus focus-visible:outline-none"
            >
              {props.keepCurrentLabel}
            </Link>
          </>
        )}

        {props.withdrawNote && !props.isPending && (
          <p className="text-center text-caption leading-relaxed text-muted">
            {props.withdrawNote}
          </p>
        )}

        {props.providerNote && (
          <p className="text-center text-caption leading-relaxed text-muted">
            {props.providerNote}
          </p>
        )}

        {error && (
          <p role="alert" className="text-caption text-bad-ink">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}
