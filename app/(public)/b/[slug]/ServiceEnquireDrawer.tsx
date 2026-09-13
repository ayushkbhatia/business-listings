"use client";

import { useState } from "react";
import { Drawer } from "@/components/structure";
import { ENQUIRE_LINK } from "@/components/domain/ServicesStorefront";
import type { ServiceEnquiryOption } from "@/components/domain/ServiceEnquiryComposer";
import { t } from "@/lib/i18n";
import { ServiceEnquiryForm } from "./ServiceEnquiryForm";

/**
 * The service composer in a drawer, on a page that has no composer of its own.
 *
 * Two places need it. A `both` storefront's rail already carries the goods
 * composer, which asks for lines and quantities (`1d-s` B2) — a second inline
 * form beside it would be the duplicate-composer defect board 1d removed. And
 * `1e-s`'s services list is a page of cards with an *Enquire* on each and an
 * *enquire anyway* at the foot: sending the buyer back to the overview to write
 * would lose the list they were choosing from.
 *
 * The composer mounts only while the drawer is open, so a list of thirty cards
 * is thirty buttons rather than thirty forms.
 */
export function ServiceEnquireDrawer({
  businessId,
  businessName,
  services,
  service,
  serviceName,
  askForContact,
  responseLine,
  triggerLabel,
  triggerClassName = ENQUIRE_LINK,
  triggerAriaLabel,
}: {
  businessId: string;
  businessName: string;
  services: readonly ServiceEnquiryOption[];
  /** The service it opens on, or `null` for *something not listed*. */
  service: string | null;
  /** Named in the drawer's description; null for the catch-all. */
  serviceName: string | null;
  askForContact: boolean;
  responseLine: string;
  /** Defaults to the compact *Enquire*. */
  triggerLabel?: string;
  triggerClassName?: string;
  /** Defaults to *Enquire about {service}* where there is a service. */
  triggerAriaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const label = triggerAriaLabel ??
    (serviceName ? t("storefront_services.enquire_named", { name: serviceName }) : undefined);

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {triggerLabel ?? t("listing.enquire")}
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={t("storefront_services.composer.title")}
        description={serviceName ?? t("storefront_services.composer.service_other")}
        closeLabel={t("action.cancel")}
      >
        {open && (
          <ServiceEnquiryForm
            businessId={businessId}
            businessName={businessName}
            services={services}
            initialService={service}
            askForContact={askForContact}
            responseLine={responseLine}
          />
        )}
      </Drawer>
    </>
  );
}
