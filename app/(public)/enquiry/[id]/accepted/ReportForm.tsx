"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Button, Textarea } from "@/components/primitives";
import { REPORT_DETAIL_MAX, REPORT_DETAIL_MIN } from "@/lib/enquiry/accepted-record";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { reportProblemAction } from "./actions";
import { IDLE, type RecordFormState } from "./_state";

/**
 * Board `7c` `B8` — *Report a problem*, from the red panel.
 *
 * One press opens a field rather than a second page: the buyer is already
 * reading the record the report is about, and the panel above says what the
 * trust team can and cannot do before they write a word. Once the report lands
 * the page revalidates and the panel shows the case instead of this form —
 * *"the report control does not re-offer"*.
 */
export function ReportForm({ enquiryId, token }: { enquiryId: string; token: string | null }) {
  const [open, setOpen] = useState(false);
  const openerId = useId();
  const returnFocus = useRef(false);

  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      document.getElementById(openerId)?.focus();
    }
  }, [open, openerId]);

  if (!open) {
    return (
      <Button id={openerId} variant="danger" onClick={() => setOpen(true)}>
        {t("accepted.report.open")}
      </Button>
    );
  }

  return (
    <ReportEditor
      enquiryId={enquiryId}
      token={token}
      onCancel={() => {
        returnFocus.current = true;
        setOpen(false);
      }}
    />
  );
}

function ReportEditor({
  enquiryId,
  token,
  onCancel,
}: {
  enquiryId: string;
  token: string | null;
  onCancel: () => void;
}) {
  const [detail, setDetail] = useState("");
  const [state, action, pending] = useActionState(
    (previous: RecordFormState, formData: FormData) => reportProblemAction(previous, formData),
    IDLE,
  );
  const fieldId = useId();
  const hintId = useId();
  const countId = useId();
  const messageId = useId();

  const length = detail.trim().length;
  const failed = state.status === "error";

  return (
    <form action={action} className="flex flex-col gap-2" aria-busy={pending || undefined}>
      <input type="hidden" name="enquiryId" value={enquiryId} />
      {token ? <input type="hidden" name="t" value={token} /> : null}
      <label htmlFor={fieldId} className="text-body-sm text-bad-ink">
        {t("accepted.report.label")}
      </label>
      <Textarea
        autoFocus
        id={fieldId}
        name="detail"
        rows={5}
        value={detail}
        onChange={(event) => setDetail(event.target.value)}
        invalid={failed}
        aria-describedby={[hintId, countId, failed ? messageId : null].filter(Boolean).join(" ")}
      />
      <p id={hintId} className="text-caption text-bad-ink">
        {t("accepted.report.hint", { min: REPORT_DETAIL_MIN })}
      </p>
      {/* Polite, and only the count: announcing every keystroke would drown the field. */}
      <p id={countId} className="font-mono text-caption tabular-nums text-muted">
        {t("accepted.report.count", {
          count: formatCount(length),
          max: formatCount(REPORT_DETAIL_MAX),
        })}
      </p>
      {state.status !== "idle" ? (
        <p
          id={messageId}
          // A refusal interrupts; a success is announced politely, and then the
          // panel re-renders with the case in this form's place.
          role={failed ? "alert" : "status"}
          className={failed ? "text-caption text-bad-ink" : "text-caption text-ok-ink"}
        >
          {state.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" loading={pending} disabled={length === 0}>
          {pending ? t("accepted.report.sending") : t("accepted.report.submit")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          {t("accepted.report.cancel")}
        </Button>
      </div>
    </form>
  );
}
