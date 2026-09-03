"use client";

import { useState, useTransition } from "react";
import {
  EnquiryComposer,
  type EnquiryComposerValue,
  type EnquiryLineDraft,
  type RecipientPreview,
} from "@/components/domain";
import { enquiryLabels } from "./_labels";
import { previewRecipients, sendEnquiry } from "./actions";

/**
 * The client half of Composer A — the inline enquiry on a storefront or a
 * product page.
 *
 * Shared by the storefront composer and the product tray: they differ in their
 * starting lines, not in their behaviour. `/rfq/new` is Composer B and owns its
 * own layout, but sends through the same action, because a single-seller
 * enquiry is an RFQ with one recipient.
 *
 * The recipient preview is re-queried when the buyer moves the slider, through
 * the same matcher the send uses — so what they are shown and what is delivered
 * cannot disagree.
 */
export function RfqForm({
  shape,
  categoryId,
  emirates,
  initialRecipients = [],
  initialLines,
  initialRequirement,
  pinnedBusinessIds,
  askForContact,
  defaultFanout = 5,
}: {
  /**
   * Composer A only.
   *
   * `/rfq/new` used to mount this with `shape="wizard"`. Board 1h's composer
   * model replaced that with a page that owns its own lines table, recipient
   * picker and Send — see `app/(public)/rfq/new`. This wrapper stays as the
   * inline composer the storefront and the product page use, and both still
   * submit through the same `sendEnquiry` action the fan-out does.
   */
  shape: "single";
  categoryId: string;
  emirates: readonly { value: string; label: string }[];
  initialRecipients?: readonly RecipientPreview[];
  initialLines?: readonly EnquiryLineDraft[];
  initialRequirement?: string;
  pinnedBusinessIds?: string[];
  askForContact: boolean;
  defaultFanout?: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>(undefined);
  const [recipients, setRecipients] = useState<readonly RecipientPreview[]>(initialRecipients);

  function handleFanoutChange(count: number) {
    startTransition(async () => {
      const next = await previewRecipients({
        categoryId,
        emirate: null,
        lineCount: 1,
        fanoutTo: count,
        ...(pinnedBusinessIds ? { pinnedBusinessIds } : {}),
      });
      setRecipients(next);
    });
  }

  function handleSubmit(value: EnquiryComposerValue) {
    setError(undefined);
    startTransition(async () => {
      const result = await sendEnquiry({
        requirement: value.requirement,
        lines: value.lines,
        categoryId,
        emirate: value.emirate,
        deliverToArea: value.deliverToArea,
        neededBy: value.neededBy,
        termsWanted: value.termsWanted,
        closesInDays: value.closesInDays,
        fanoutTo: shape === "single" ? 1 : value.fanoutTo,
        contactPhone: value.contactPhone,
        contactName: value.contactName,
        ...(pinnedBusinessIds ? { pinnedBusinessIds } : {}),
      });
      // A success redirects and never returns.
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <EnquiryComposer
      shape={shape}
      labels={enquiryLabels({ emirates })}
      recipients={recipients}
      askForContact={askForContact}
      defaultFanout={defaultFanout}
      {...(initialLines ? { initialLines } : {})}
      {...(initialRequirement ? { initialRequirement } : {})}
      onSubmit={handleSubmit}
      {...(recipients.length > 0 ? { onFanoutChange: handleFanoutChange } : {})}
      busy={pending}
      {...(error ? { error } : {})}
    />
  );
}
