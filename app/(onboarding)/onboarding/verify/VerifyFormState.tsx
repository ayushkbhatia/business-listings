"use client";

import { createContext, useContext, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/primitives";
import { t } from "@/lib/i18n";
import type { VerifyDraft } from "@/lib/onboarding/draft";
import type { SaveExitResult } from "../actions";

/**
 * The form's state, held above both the header and the form.
 *
 * Board 2b puts "Save & exit" in the chrome — one 60px row carrying the
 * wordmark, the step rail and that link, with no second header band (criterion
 * 14). The button therefore sits outside the form it saves, and something has to
 * span the two.
 *
 * A context rather than lifting the whole form into the header: the fields
 * belong to the form and only the *values* need to travel. What crosses is a
 * plain object and two setters, so the header stays a thin consumer and the form
 * keeps owning its own controls.
 */

export interface VerifyFields {
  route: "licence_upload" | "phone_callback";
  documentId: string | null;
  filename: string | null;
  licenceNumber: string;
  licenceExpiry: string;
  claimantName: string;
  claimantRole: string;
}

interface VerifyFormValue {
  fields: VerifyFields;
  setFields: (update: Partial<VerifyFields>) => void;
  /** Announced by whichever surface triggered the save. */
  saved: string | null;
  setSaved: (message: string | null) => void;
  businessId: string;
  saveAction: (formData: FormData) => Promise<SaveExitResult>;
}

const VerifyFormContext = createContext<VerifyFormValue | null>(null);

export function useVerifyForm(): VerifyFormValue {
  const value = useContext(VerifyFormContext);
  if (!value) throw new Error("useVerifyForm was called outside VerifyFormProvider");
  return value;
}

export function VerifyFormProvider({
  businessId,
  hasPhoneRoute,
  draft,
  saveAction,
  children,
}: {
  businessId: string;
  hasPhoneRoute: boolean;
  draft: Partial<VerifyDraft>;
  saveAction: (formData: FormData) => Promise<SaveExitResult>;
  children: React.ReactNode;
}) {
  const [fields, setAll] = useState<VerifyFields>({
    /*
       Route A is the default and the only default. The board marks it FASTEST —
       but only where there is a second route to be faster than, so a listing
       with no number on the public record starts here regardless of what a
       stale draft says.
    */
    route: draft.route === "phone_callback" && hasPhoneRoute ? "phone_callback" : "licence_upload",
    documentId: draft.documentId ?? null,
    filename: draft.filename ?? null,
    licenceNumber: draft.licenceNumber ?? "",
    licenceExpiry: draft.licenceExpiry ?? "",
    claimantName: draft.claimantName ?? "",
    claimantRole: draft.claimantRole ?? "",
  });
  const [saved, setSaved] = useState<string | null>(null);

  const value = useMemo<VerifyFormValue>(
    () => ({
      fields,
      setFields: (update) => setAll((current) => ({ ...current, ...update })),
      saved,
      setSaved,
      businessId,
      saveAction,
    }),
    [fields, saved, businessId, saveAction],
  );

  return <VerifyFormContext.Provider value={value}>{children}</VerifyFormContext.Provider>;
}

/** Everything the draft holds, as the action expects it. */
export function draftFormData(businessId: string, fields: VerifyFields): FormData {
  const form = new FormData();
  form.set("businessId", businessId);
  form.set("route", fields.route);
  if (fields.documentId) form.set("documentId", fields.documentId);
  if (fields.filename) form.set("filename", fields.filename);
  form.set("licenceNumber", fields.licenceNumber);
  form.set("licenceExpiry", fields.licenceExpiry);
  form.set("claimantName", fields.claimantName);
  form.set("claimantRole", fields.claimantRole);
  return form;
}

/**
 * The chrome's right-hand slot.
 *
 * Quiet, because it is an exit rather than a step: a supplier reading this
 * screen is deciding whether to find their licence, and the loudest control must
 * stay the one that finishes. It says what happened afterwards rather than
 * navigating away — a page that vanished on click would leave somebody unsure
 * whether anything was kept.
 */
export function SaveExitButton() {
  const { fields, businessId, saveAction, setSaved } = useVerifyForm();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      onClick={() => {
        startTransition(async () => {
          const result = await saveAction(draftFormData(businessId, fields));
          if (!result.ok) {
            setSaved(null);
            return;
          }
          setSaved(
            result.emailed && result.masked
              ? t("verify.saved", { masked: result.masked })
              : t("verify.saved_no_email"),
          );
        });
      }}
    >
      {t("verify.save_exit")}
    </Button>
  );
}
