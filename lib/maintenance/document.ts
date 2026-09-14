import { dir, t, DEFAULT_LOCALE, type Direction, type Locale } from "@/lib/i18n";
import type { MaintenanceView } from "./window";

/**
 * Board 13e — the maintenance page, as the whole HTML document.
 *
 * ## Why a string and not a route
 *
 * B2 requires the page to answer **503 with `Retry-After`**. The App Router has
 * no way for a page to set that status, and a proxy rewrite that asks for one is
 * undocumented — Next's own issue tracker has it closed unfixed, and a
 * maintenance page that is quietly a 200 on Vercel is the failure B2 exists to
 * prevent: indexed in place of the real pages. Answering from the proxy with a
 * `Response` is the documented path, so the proxy has to hold the document.
 *
 * That also makes B1 structural rather than a promise. The page reads nothing
 * at request time because it cannot: it is assembled before any route, layout,
 * session refresh or database client is reached, and it keeps working when a
 * render would not.
 *
 * ## Styling without the app bundle
 *
 * The Tailwind bundle's filename is a hash the proxy never learns, so the
 * document links two stable files instead: `/maintenance/tokens.css`, copied
 * from `docs/tokens.css` before every build (the same file `globals.css` pastes,
 * so no colour is written twice), and `/maintenance/maintenance.css`, which uses
 * only those variables.
 *
 * ## No links but one
 *
 * B3: no nav, no search, no footer — every one of them points at a route that
 * is down. The only anchor is the WhatsApp number, which leaves the site.
 */

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

function duration(minutes: number, locale: Locale): string {
  // Under an hour and a half reads in minutes; past it, to the nearest hour.
  if (minutes < 90) return t("maintenance.duration.minutes", { count: minutes }, { locale });
  return t("maintenance.duration.hours", { count: Math.round(minutes / 60) }, { locale });
}

/**
 * The open-tab case. A tab rendered at 02:30 still reads *back at 03:00* at
 * 03:40 unless something changes it, and the states table names that as the
 * failure this page exists to avoid. At the end time the page swaps to text it
 * already carries — *due back at 03:00; that time has passed; reload* — and asks.
 * It does not poll and it does not reload itself (Q1): nothing here touches
 * the network.
 */
const PASSED_SCRIPT = `(function(){var m=document.querySelector("main[data-ends-at]");if(!m)return;var end=Date.parse(m.getAttribute("data-ends-at"));function pass(){document.querySelectorAll('[data-when="now"]').forEach(function(e){e.hidden=true});document.querySelectorAll('[data-when="passed"]').forEach(function(e){e.hidden=false})}var left=end-Date.now();if(left<=0)pass();else if(left<2147483647)setTimeout(pass,left);var b=document.querySelector("[data-reload]");if(b)b.addEventListener("click",function(){location.reload()})})();`;

export interface RenderOptions {
  locale?: Locale;
  /** Production derives it from the locale. The gallery's mirrored specimen sets it. */
  direction?: Direction;
  /** The open-tab swap. Off only for gallery specimens, which pin one state each. */
  openTabScript?: boolean;
  /**
   * Gallery only. Axe reads a page's frames as one landmark set, so eight
   * specimens are eight unnamed `main`s beside the gallery's own and fail
   * `landmark-unique`. Each specimen names its `main`; production leaves it bare.
   */
  specimenLabel?: string;
}

export function renderMaintenanceDocument(
  view: MaintenanceView,
  { locale = DEFAULT_LOCALE, direction = dir(locale), openTabScript = true, specimenLabel }: RenderOptions = {},
): string {
  const tr = (key: Parameters<typeof t>[0], params?: Parameters<typeof t>[1]) => escapeHtml(t(key, params, { locale }));

  const when = view.endDay
    ? t("maintenance.when_on", { time: view.endClock, day: view.endDay }, { locale })
    : t("maintenance.when", { time: view.endClock }, { locale });
  const work = t(`maintenance.work.${view.work}`, undefined, { locale });
  const planned = duration(view.minutes, locale);
  const overrun = view.phase === "overrun";

  const heading = overrun
    ? `<span>${tr("maintenance.heading.overrun", { when })}</span>`
    : `<span data-when="now">${tr("maintenance.heading.active", { when })}</span>` +
      `<span data-when="passed" hidden>${tr("maintenance.heading.passed", { when })}</span>`;

  const body = [
    tr(overrun ? "maintenance.body.overrun" : "maintenance.body.planned", { work, duration: planned }),
    view.trust ? tr("maintenance.trust") : null,
  ]
    .filter(Boolean)
    .join(" ");

  const retry = overrun
    ? `<p class="mw-retry">${tr("maintenance.retry.overrun", { count: Math.round(view.retryAfter / 60) })}</p>`
    : `<p class="mw-retry" data-when="now">${tr("maintenance.retry.active", { when })}</p>` +
      `<div class="mw-passed" data-when="passed" hidden><p class="mw-retry">${tr("maintenance.retry.passed")}</p>` +
      `<button type="button" class="mw-reload" data-reload>${tr("maintenance.reload")}</button></div>`;

  const contact = view.whatsapp
    ? `<div class="mw-contact"><div><p class="mw-contact-title">${tr("maintenance.contact.title")}</p>` +
      `<p class="mw-contact-body">${tr("maintenance.contact.body")}</p></div>` +
      `<a class="mw-number" href="${escapeHtml(view.whatsapp.href)}" rel="noopener" ` +
      `aria-label="${tr("maintenance.contact.label", { number: view.whatsapp.display })}">` +
      `<bdi>${escapeHtml(view.whatsapp.display)}</bdi></a></div>`
    : "";

  const rows = view.rows
    .map(
      (row) =>
        `<tr data-state="${row.state}"><th scope="row"><span class="mw-dot" aria-hidden="true"></span>` +
        `${tr(`maintenance.system.${row.system}`)}</th><td>${tr(`maintenance.state.${row.state}`)}</td></tr>`,
    )
    .join("");

  return (
    `<!doctype html><html lang="${locale}" dir="${direction}"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex, nofollow">` +
    `<title>${tr("maintenance.document_title")}</title>` +
    `<link rel="preload" href="/fonts/instrument-serif-latin.woff2" as="font" type="font/woff2" crossorigin>` +
    `<link rel="preload" href="/fonts/geist-latin.woff2" as="font" type="font/woff2" crossorigin>` +
    `<link rel="stylesheet" href="/maintenance/tokens.css"><link rel="stylesheet" href="/maintenance/maintenance.css">` +
    `</head><body>` +
    `<main class="mw"${specimenLabel ? ` aria-label="${escapeHtml(specimenLabel)}"` : ""} data-phase="${view.phase}"${overrun ? "" : ` data-ends-at="${escapeHtml(view.endsAtIso)}"`}>` +
    `<div class="mw-frame">` +
    `<p class="mw-wordmark">${tr("maintenance.wordmark.business")} <em>${tr("maintenance.wordmark.listings")}</em></p>` +
    `<div class="mw-columns"><div class="mw-copy">` +
    `<p class="mw-eyebrow">${tr("maintenance.eyebrow")}</p>` +
    `<h1 class="mw-heading">${heading}</h1>` +
    `<p class="mw-lede">${tr(`maintenance.lede.${view.work}`)}</p>` +
    `<p class="mw-body">${body}</p>` +
    `<div class="mw-retries" aria-live="polite">${retry}</div>` +
    contact +
    `</div>` +
    `<div class="mw-panel"><table class="mw-status"><caption>${tr("maintenance.status.caption")}</caption>` +
    `<thead><tr><th scope="col">${tr("maintenance.status.col_system")}</th><th scope="col">${tr("maintenance.status.col_state")}</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>` +
    `</div></div></main>` +
    (overrun || !openTabScript ? "" : `<script>${PASSED_SCRIPT}</script>`) +
    `</body></html>`
  );
}
