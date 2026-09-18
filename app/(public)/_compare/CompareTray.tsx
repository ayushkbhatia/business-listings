"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { buttonClassName } from "@/components/primitives";
import { Close } from "@/components/primitives/icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { COMPARE_MAX, compareHref, type CompareChange, type Tray } from "@/lib/compare/tray";
import { SUBDOMAIN_ZONE, labelFromHost } from "@/lib/domains/label";
import { COMPARE_ENDPOINT, trayChanged, useCompareSubmit, useTray, useTrayNotice } from "./store";

/**
 * Board `10d`'s *sticky tray at page foot while browsing* — named on the board,
 * drawn on neither it nor `10c`, so its states are specified here:
 *
 * | Held | What it says |
 * |---|---|
 * | 0 | nothing — the bar is not drawn |
 * | 1 | the product, and that a comparison needs one more in the same trade |
 * | 2–3 | the products, the trade, *Compare N products* |
 * | 4 | the same — *4 of 4* is the full state, and each tick says so on its own (`B7`) |
 *
 * And one transient line, polite, after an action that changed more than the
 * buyer pressed: a product from another trade started a fresh comparison and
 * cleared the old one, or a product turned out to be no longer listed. Those
 * are the two outcomes a buyer would otherwise have to notice for themselves.
 *
 * Mounted once, in the public layout, and drawn only where a buyer is browsing
 * (`TASK_ROUTES`). Not on `/compare` — the page is the comparison — and not on
 * a page where the buyer is doing one thing, like writing an enquiry.
 *
 * `position: fixed`, so its arrival after hydration moves nothing, plus a
 * spacer in the flow of the page so the footer is never hidden underneath it.
 *
 * ## Sharing the foot of the screen
 *
 * Several pages already pin a bar there on a phone — the storefront's *Call ·
 * WhatsApp · Ask for a quote*, the product page's enquiry bar. Those carry the
 * page's own action and stay where the thumb is; the tray sits on top of them
 * (`useDock`). A bar that scrolls with the page and sticks to its foot — the
 * catalogue's selection bar — is the other way round, and reads the height the
 * tray publishes as `--compare-tray-h` to stop above it.
 */
export function CompareTray() {
  const tray = useTray();
  const notice = useTrayNotice();
  const pathname = usePathname();

  /*
     The notice is about the page it happened on. A client navigation keeps
     this bar mounted — it lives in the layout — so without this a *started a
     new comparison* line would follow the buyer to every page after.
  */
  useEffect(() => {
    trayChanged(null);
  }, [pathname]);

  const shown = (tray.items.length > 0 || isNotable(notice)) && !isTaskRoute(pathname);
  const { ref, lift, height } = useDock(shown, pathname);
  if (!shown) return null;

  return (
    <>
      <div aria-hidden="true" className="print:hidden" style={{ height }} />
      <section
        ref={ref}
        aria-label={t("compare.tray_label")}
        style={{ bottom: lift }}
        className={cn(
          "fixed inset-x-0 z-30 border-t border-line bg-card/95 shadow-lg backdrop-blur-sm print:hidden",
          lift === 0 && "pb-[env(safe-area-inset-bottom)]",
        )}
      >
        <TrayContents tray={tray} notice={notice} />
      </section>
    </>
  );
}

/**
 * What the bar holds, without the bar — so the gallery draws every state of it
 * from a fixed tray, and the page draws the same markup from the cookie.
 */
export function TrayContents({ tray, notice }: { tray: Tray; notice: CompareChange | null }) {
  return (
    <>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 md:px-6">
        <TrayBody tray={tray} />
      </div>
      <Notice notice={notice} />
    </>
  );
}

/**
 * Pages where the buyer is doing one thing, and a tray offering another is in
 * the way: the comparison itself, writing an enquiry, following one, their
 * account, a review, a report. Prefixes, so `/enquiry/ENQ-…/compare` counts.
 */
const TASK_ROUTES = ["/compare", "/rfq", "/enquiry", "/account", "/review", "/report"] as const;

function isTaskRoute(pathname: string): boolean {
  return TASK_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/** A page's own bar pinned to the foot of the screen — marked where it is drawn. */
const ACTION_BAR = "[data-action-bar]";

/**
 * Where the tray sits, and how much room it takes.
 *
 * `lift` is the tallest visible page action bar (`[data-action-bar]`), so the
 * tray rests on top of it rather than under it. A bar hidden at this width is
 * `display: none` and measures zero, and the observer hears it come back when
 * the screen widens or narrows past its breakpoint.
 *
 * `height` is the tray's own, for the spacer. Both together are published as
 * `--compare-tray-h` for sticky bars in the page's flow, and withdrawn when the
 * tray goes.
 */
function useDock(shown: boolean, pathname: string) {
  const ref = useRef<HTMLElement>(null);
  const [lift, setLift] = useState(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const section = ref.current;
    if (!shown || !section) return;
    const root = document.documentElement;
    const bars = Array.from(document.querySelectorAll<HTMLElement>(ACTION_BAR));
    const measure = () => {
      const below = Math.max(0, ...bars.map((bar) => bar.offsetHeight));
      const own = section.offsetHeight;
      setLift(below);
      setHeight(own);
      root.style.setProperty("--compare-tray-h", `${below + own}px`);
    };
    /*
       Measured now, and again whenever any of them resizes. An observer does
       report each element once on `observe`, but only at the next rendering
       step — which a background tab may not reach for a while.
    */
    const observer = new ResizeObserver(measure);
    observer.observe(section);
    for (const bar of bars) observer.observe(bar);
    measure();
    return () => {
      observer.disconnect();
      root.style.removeProperty("--compare-tray-h");
    };
  }, [shown, pathname]);

  return { ref, lift, height };
}

/**
 * Where the comparison opens.
 *
 * On a seller's own address — `acme.businesslistings.me` — every path is that
 * storefront's (`proxy.ts`), so `/compare` there would be `/b/acme/compare` and
 * a 404. The comparison is the directory's page, so the link goes to the
 * directory. The set rides in `?p=` (`B10`), which is why it arrives intact on
 * a host the tray cookie was never set on.
 */
function comparisonUrl(ids: readonly string[]): string {
  const path = compareHref(ids);
  /* The server never draws a held tray on the page (its snapshot is empty); only a specimen reaches here without a window. */
  if (typeof window === "undefined") return path;
  return labelFromHost(window.location.host) ? `${window.location.protocol}//${SUBDOMAIN_ZONE}${path}` : path;
}

function isNotable(notice: CompareChange | null): boolean {
  return notice?.outcome === "replaced" || notice?.outcome === "unavailable";
}

function TrayBody({ tray }: { tray: Tray }) {
  const count = tray.items.length;
  if (count === 0) return null;

  return (
    <>
      {/*
         On a phone the two halves stack and the chips run in one row that
         scrolls sideways: four chips wrapping would stand the bar a third of
         the screen tall over a page the buyer is still reading. From `sm` the
         halves sit side by side and the chips wrap.
      */}
      <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
        <p className="font-mono text-eyebrow uppercase text-muted">
          {t("compare.tray_heading", { count, max: COMPARE_MAX, trade: tray.trade?.name ?? "" })}
        </p>
        <ul className="-mx-1 mt-1 flex list-none gap-1.5 overflow-x-auto p-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:p-0">
          {tray.items.map((item) => (
            <li key={item.id} className="shrink-0">
              <TrayChip id={item.id} name={item.name} seller={item.seller} />
            </li>
          ))}
        </ul>
      </div>

      <div className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto sm:shrink-0">
        {count >= 2 ? (
          <Link
            href={comparisonUrl(tray.items.map((item) => item.id))}
            prefetch={false}
            rel="nofollow"
            className={buttonClassName()}
          >
            {t("compare.open_count", { count })}
          </Link>
        ) : (
          /*
             One product is not a comparison. The bar says what is missing
             rather than offering a page with a single column.
          */
          <p className="min-w-0 flex-1 text-body-sm text-body sm:max-w-[16rem] sm:flex-none">
            {t("compare.need_one_more", { trade: tray.trade?.name ?? "" })}
          </p>
        )}
        <ClearTray />
      </div>
    </>
  );
}

/** One held product, removable. */
function TrayChip({ id, name, seller }: { id: string; name: string; seller: string }) {
  const { pending, onSubmit } = useCompareSubmit();

  return (
    <form
      method="post"
      action={COMPARE_ENDPOINT}
      onSubmit={onSubmit}
      className="inline-flex max-w-[16rem] items-center gap-1 rounded-tag border border-line bg-paper py-0.5 ps-2 pe-0.5"
    >
      <span className="min-w-0 truncate text-caption text-ink" title={`${name} · ${seller}`}>
        {name}
        <span className="text-muted"> · {seller}</span>
      </span>
      <input type="hidden" name="intent" value="remove" />
      <input type="hidden" name="productId" value={id} />
      <button
        type="submit"
        aria-busy={pending || undefined}
        aria-label={t("compare.remove", { name })}
        className="flex size-6 shrink-0 items-center justify-center rounded-tag text-muted transition-colors duration-120 ease-out hover:bg-fill hover:text-ink focus-visible:outline-none focus-visible:shadow-focus"
      >
        <Close size={12} />
      </button>
    </form>
  );
}

function ClearTray() {
  const { pending, onSubmit } = useCompareSubmit();

  return (
    <form method="post" action={COMPARE_ENDPOINT} onSubmit={onSubmit}>
      <input type="hidden" name="intent" value="clear" />
      <button
        type="submit"
        aria-busy={pending || undefined}
        className="rounded-tag px-2 py-1.5 text-caption text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
      >
        {t("compare.clear")}
      </button>
    </form>
  );
}

/**
 * The one line that reports an action's side effect.
 *
 * Polite, and only for the two outcomes that changed something the buyer did
 * not directly press: a fresh comparison that cleared the old one, and a
 * product that could not be added because it is no longer listed. A plain add
 * or remove announces itself through the tick's own pressed state.
 */
function Notice({ notice }: { notice: CompareChange | null }) {
  const text =
    notice?.outcome === "replaced"
      ? t("compare.notice_replaced", {
          count: notice.dropped,
          trade: notice.tray.trade?.name ?? "",
        })
      : notice?.outcome === "unavailable"
        ? t("compare.notice_unavailable")
        : null;

  return (
    <p aria-live="polite" className={cn("mx-auto max-w-7xl px-4 text-caption text-body md:px-6", text ? "pb-2" : "sr-only")}>
      {text ?? ""}
    </p>
  );
}
