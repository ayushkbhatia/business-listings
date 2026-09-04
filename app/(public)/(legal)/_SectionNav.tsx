"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * The 212px section nav from board 13f §2 — the only client JavaScript on any
 * of the five legal pages.
 *
 * Two jobs, and both of them fail open. If the observer never runs the first
 * entry stays highlighted and every link still works; if the media query never
 * runs the list is a closed disclosure the reader can open. Neither is the
 * drawn state, and neither is broken.
 *
 * ## Why the whole list is a `details`
 *
 * 13f §1 asks the nav to collapse to a summary above the `h1` below 768px and
 * to be an open column above it. `open` is a boolean attribute and no media
 * query can set it, so the element ships closed — which is right on the phone,
 * and which this component opens on a wider viewport once it has a window to
 * measure. Rendering two navs instead, one per breakpoint, would put two
 * navigation landmarks with the same name into the page; `landmarks.spec.ts`
 * exists because that has already cost this project a bug.
 *
 * The summary is the drawn eyebrow, at every width. Hiding it once the
 * disclosure is open would have taken the column heading off the wide layout,
 * which the board draws — so it stays, and only the chevron beside it is
 * dropped above 768px where there is nothing left to toggle.
 */
export interface SectionNavItem {
  id: string;
  number: string;
  label: string;
}

export interface LegalSectionNavProps {
  items: SectionNavItem[];
  /** Names the landmark and labels the mobile summary. */
  label: string;
}

/*
   The sticky site nav is 68px, and the columns sit 16px below it — the offset
   13f §2 asks for so the stuck columns are not flush to the viewport edge. The
   same 84px is the top of the band this observer treats as "the section being
   read", and `scroll-mt-21` on each heading keeps a deep link clear of the bar.
*/
const BAND_TOP = 84;

export function LegalSectionNav({ items, label }: LegalSectionNavProps) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const disclosure = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 768px)");
    const sync = () => {
      if (disclosure.current) disclosure.current.open = wide.matches;
    };
    sync();
    wide.addEventListener("change", sync);
    return () => wide.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const headings = items
      .map((item) => document.getElementById(item.id))
      .filter((element): element is HTMLElement => element !== null);
    const first = headings[0];
    if (!first) return;

    /*
       Intersection alone is not enough. The band is a strip near the top of the
       viewport, and a long clause can be taller than it — so between two
       headings nothing intersects at all and the highlight would blink off.
       When the band is empty the answer is the last heading above it, which is
       the section the reader is in the middle of.
    */
    const intersecting = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) intersecting.add(entry.target.id);
          else intersecting.delete(entry.target.id);
        }

        const inBand = headings.find((heading) => intersecting.has(heading.id));
        if (inBand) {
          setActive(inBand.id);
          return;
        }

        let passed = first.id;
        for (const heading of headings) {
          if (heading.getBoundingClientRect().top <= BAND_TOP) passed = heading.id;
        }
        setActive(passed);
      },
      { rootMargin: `-${BAND_TOP}px 0px -65% 0px`, threshold: 0 },
    );

    for (const heading of headings) observer.observe(heading);
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label={label}>
      <details ref={disclosure} className="[&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-ctl py-1 font-mono text-eyebrow uppercase text-muted focus-visible:shadow-focus focus-visible:outline-none md:cursor-default">
          {label}
          {/*
             Presentational: the summary is already announced as a disclosure
             and its state with it, so a second word for the same thing is
             noise. Above 768px there is nothing to toggle and it goes.
          */}
          <span aria-hidden className="text-faint md:hidden">
            {"\u25be"}
          </span>
        </summary>

        <ul className="mt-3.5 flex flex-col gap-2.5">
          {items.map((item) => {
            const current = item.id === active;
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  aria-current={current ? "location" : undefined}
                  className={cn(
                    "block border-s-2 ps-[0.6875rem] text-body-sm leading-snug underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none",
                    current
                      ? "border-moss font-medium text-ink"
                      : "border-transparent text-body hover:text-ink",
                  )}
                >
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </details>
    </nav>
  );
}
