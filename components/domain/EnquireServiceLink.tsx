"use client";

/**
 * "Enquire" on a service row — board `1d-s` B11.
 *
 * A real link first: `?service=<slug>#enquire` renders the storefront with the
 * composer prefilled, so it works with no JavaScript, from a shared URL and in
 * a new tab. With JavaScript it does the same thing without a navigation —
 * which matters, because a navigation would remount the composer and throw
 * away whatever the buyer had already typed into it.
 *
 * The composer listens for `SERVICE_ENQUIRY_SELECT` and moves focus into its
 * requirement field, so a keyboard user lands where they can type rather than
 * at the top of a form they then have to tab through.
 */
export const SERVICE_ENQUIRY_SELECT = "service-enquiry:select";

export function EnquireServiceLink({
  href,
  service,
  className,
  label,
  children,
}: {
  href: string;
  service: string;
  className?: string;
  /** The accessible name, already worded — the visible text plus the service. */
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={className}
      aria-label={label}
      onClick={(event) => {
        // Modified clicks open a tab or a window, and that is the buyer's call.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        const composer = document.getElementById("enquire");
        if (!composer) return;
        event.preventDefault();

        const url = new URL(window.location.href);
        url.searchParams.set("service", service);
        url.hash = "enquire";
        window.history.replaceState(window.history.state, "", url);

        window.dispatchEvent(new CustomEvent(SERVICE_ENQUIRY_SELECT, { detail: service }));
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        composer.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }}
    >
      {children}
    </a>
  );
}
