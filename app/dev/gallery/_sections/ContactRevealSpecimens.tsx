"use client";

import { useId } from "react";
import { LeadGateForm, type LeadPrefillProps } from "@/app/(public)/b/[slug]/ContactReveal";
import type { LeadFieldsInput, LeadProblems } from "@/lib/contact/lead-form";

/**
 * The form card drawn in a frame, for the gallery.
 *
 * The page opens it as a modal in the viewport; eight modals over the gallery
 * would be a gallery nobody can read. Submitting does nothing here.
 */
export function LeadGateSpecimen({
  supplierName,
  prefill = null,
  values,
  problems,
  failure = null,
  label,
}: {
  supplierName: string;
  prefill?: LeadPrefillProps | null;
  values?: LeadFieldsInput;
  problems?: LeadProblems;
  failure?: string | null;
  /** The specimen's state, naming its form uniquely on the gallery page. */
  label: string;
}) {
  const titleId = useId();
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="w-full max-w-[28.25rem] rounded-panel border border-line bg-card shadow-overlay"
    >
      <LeadGateForm
        titleId={titleId}
        supplierName={supplierName}
        prefill={prefill}
        privacyHref="#contact-reveal"
        failure={failure}
        onDismiss={() => undefined}
        onSubmit={async () => null}
        focusOnOpen={false}
        formLabel={label}
        {...(problems ? { initialProblems: problems } : {})}
        {...(values ? { initialValues: values } : {})}
      />
    </div>
  );
}
