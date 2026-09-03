"use client";

import { useState } from "react";
import { Drawer } from "@/components/structure";
import { buttonClassName } from "@/components/primitives";
import type { EnquiryLineDraft, RecipientPreview } from "@/components/domain";
import { t } from "@/lib/i18n";
import { RfqForm } from "@/app/(public)/rfq/RfqForm";

/**
 * The single-seller composer, on the storefront.
 *
 * Board 1d puts it here rather than on a route of its own, and that is the
 * right call: a buyer writing to this supplier should not lose sight of who
 * they are writing to. The drawer keeps the storefront behind it.
 *
 * Widening to a fan-out is a link to /rfq/new carrying this supplier as pinned,
 * so nothing typed is lost and this supplier stays on the enquiry.
 *
 * Two exports. `EnquireDrawer` is controlled and draws no trigger, because the
 * selection bar on the catalogue renders its own buttons and cannot host one.
 * `EnquireButton` is the ordinary case: a button that opens it.
 */
export interface EnquireProps {
  businessId: string;
  businessSlug: string;
  displayName: string;
  categoryId: string;
  emirates: readonly { value: string; label: string }[];
  recipient: RecipientPreview;
  initialLines?: readonly EnquiryLineDraft[];
  /** Prefills the free-text box from what the buyer was looking at. */
  initialRequirementSeed?: string;
  signedIn: boolean;
}

export function EnquireDrawer({
  open,
  onClose,
  businessId,
  businessSlug,
  displayName,
  categoryId,
  emirates,
  recipient,
  initialLines,
  initialRequirementSeed,
  signedIn,
}: EnquireProps & { open: boolean; onClose: () => void }) {
  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        size="lg"
        title={t("enquiry.to_supplier", { supplier: displayName })}
        description={t("rfq.privacy")}
        closeLabel={t("action.cancel")}
        footer={
          <a
            href={`/rfq/new?to=${businessSlug}`}
            className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("enquiry.widen")}
          </a>
        }
      >
        <RfqForm
          shape="single"
          categoryId={categoryId}
          emirates={emirates}
          initialRecipients={[recipient]}
          pinnedBusinessIds={[businessId]}
          askForContact={!signedIn}
          {...(initialLines ? { initialLines } : {})}
          {...(initialRequirementSeed
            ? { initialRequirement: t("enquiry.about_product", { product: initialRequirementSeed }) }
            : {})}
        />
      </Drawer>
    </>
  );
}

/** The ordinary case: a button that opens the composer. */
export function EnquireButton({
  triggerLabel,
  block = false,
  size = "md",
  ...props
}: EnquireProps & { triggerLabel: string; block?: boolean; size?: "sm" | "md" | "lg" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonClassName({ block, size })} onClick={() => setOpen(true)}>
        {triggerLabel}
      </button>
      <EnquireDrawer {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
