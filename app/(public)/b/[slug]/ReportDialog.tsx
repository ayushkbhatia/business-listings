"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/structure";
import { Alert } from "@/components/display";
import { ReportListingForm } from "@/components/domain";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { FileResult, ReportFormData } from "@/lib/reports/form";

/**
 * Board 13c — `/b/:slug?report=1`, a modal over the storefront.
 *
 * *"The modal is a URL."* The board's flag 5, and it is right to be one: a
 * reporter who pastes the link to a colleague, or presses Back, should get the
 * thing they expect — the form, or the storefront without it. So the open
 * state lives in the query string and nowhere else, and this component reads
 * it rather than holding a boolean of its own.
 *
 * ## Opening without a server round trip
 *
 * `ReportTrigger` writes `?report=1` with `history.pushState`, which Next's
 * router observes without re-rendering the storefront on the server. The
 * storefront is the heaviest page in the directory and a modal is not a reason
 * to build it twice. The form's data — the listing's reportable fields, the
 * trade tree — is fetched on that click instead, by `loadReportForm`; a link
 * that already carries `?report=1` arrives with the data rendered in, so it
 * opens on a form rather than on a spinner.
 *
 * ## Closing
 *
 * Back where the modal was opened by a click, so the history entry the click
 * made is the one that goes. `replaceState` where the page was loaded with the
 * parameter already on it, because *back* from a pasted link is somebody else's
 * page. Either way the URL ends without `report`, and a reload shows the
 * storefront.
 *
 * ## `noindex`
 *
 * The storefront's metadata returns `noindex` whenever `report` is in the
 * query (`B6`), and `robots.txt` already disallows `/b/*?`. The trigger's own
 * `href` is `/report/:slug`, which is disallowed and `nofollow` — so a crawler
 * never learns this URL from us at all.
 */

const PARAM = "report";

/** The current URL with `report` set or removed, everything else kept. */
function urlWith(open: boolean): string {
  const url = new URL(window.location.href);
  if (open) url.searchParams.set(PARAM, "1");
  else url.searchParams.delete(PARAM);
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}

/** Set on the history entry a click made, so closing knows it may go back. */
const OPENED_HERE = "bl-report-opened";

export function ReportDialog({
  slug,
  businessName,
  initialData,
  loadReportForm,
  fileReport,
}: {
  slug: string;
  businessName: string;
  /** Rendered in when the page was requested with `?report=1`. */
  initialData: ReportFormData | null;
  loadReportForm: (slug: string) => Promise<ReportFormData | null>;
  fileReport: (formData: FormData) => Promise<FileResult>;
}) {
  const params = useSearchParams();
  const open = params.get(PARAM) === "1";

  const [data, setData] = useState<ReportFormData | null>(initialData);
  const [missing, setMissing] = useState(false);
  const [filed, setFiled] = useState(false);
  /*
     A fresh form every time the modal opens. Without it, closing after a
     confirmation and opening again would show the confirmation again — a
     second report would look like it had already been sent.
  */
  const [session, setSession] = useState(0);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setSession((current) => current + 1);
      setFiled(false);
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open || data || missing) return;
    let live = true;
    loadReportForm(slug)
      .then((loaded) => {
        if (!live) return;
        if (loaded) setData(loaded);
        else setMissing(true);
      })
      .catch(() => {
        if (live) setMissing(true);
      });
    return () => {
      live = false;
    };
  }, [open, data, missing, slug, loadReportForm]);

  const close = useCallback(() => {
    const state = window.history.state as Record<string, unknown> | null;
    if (state && state[OPENED_HERE]) window.history.back();
    /*
       A fresh state object, never the current one. Next's patched history
       methods skip their router sync for any state carrying its own `__NA`
       marker — pass the current state through and the URL changes while
       `useSearchParams` does not, and the modal stays open over a URL that
       says it is shut.
    */
    else window.history.replaceState(null, "", urlWith(false));
  }, []);

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("report_listing.title", { business: businessName })}
      {...(filed ? {} : { description: t("report_listing.lede") })}
      closeLabel={t("overlay.close")}
      size="md"
    >
      {data ? (
        <ReportListingForm
          key={session}
          data={data}
          fileReport={fileReport}
          layout="modal"
          onCancel={close}
          onFiled={() => setFiled(true)}
        />
      ) : missing ? (
        <Alert tone="bad" fix={t("report_listing.fix.not_found")}>
          {t("report_listing.error.not_found")}
        </Alert>
      ) : (
        <p className="py-6 text-center text-body-sm text-muted" role="status" aria-live="polite">
          {t("report_listing.loading")}
        </p>
      )}
    </Modal>
  );
}

/**
 * *Report this listing*, wherever the storefront prints it.
 *
 * A real link to `/report/:slug`, so it works with no JavaScript, opens in a
 * new tab on a middle-click, and names a URL a crawler is told not to follow.
 * An ordinary click is intercepted and opens the modal instead, which is the
 * board: the reporter stays in front of the listing they are reporting.
 */
export function ReportTrigger({
  slug,
  children,
  className,
}: {
  slug: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={`/report/${slug}`}
      rel="nofollow"
      className={cn(className)}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        // Our marker only; Next copies its own internals in. See `close`.
        window.history.pushState({ [OPENED_HERE]: true }, "", urlWith(true));
      }}
    >
      {children}
    </a>
  );
}
