"use client";

import { useState } from "react";
import { Drawer } from "@/components/structure";
import { ENQUIRE_LINK } from "@/components/domain/ServicesStorefront";
import type { ServiceEnquiryOption } from "@/components/domain/ServiceEnquiryComposer";
import { t } from "@/lib/i18n";
import { ServiceEnquiryForm } from "./ServiceEnquiryForm";

/**
 * The service composer in a drawer — for a storefront that sells both.
 *
 * `1d-s` B2 keeps the catalogue and the services separate, and a `both`
 * storefront's rail already carries the goods composer, which asks for lines
 * and quantities. Putting the service composer beside it would be two forms on
 * one page — the duplicate-composer defect board 1d removed — and routing a
 * service enquiry through the goods one would ask a buyer the quantity of a
 * statutory audit. So a service row opens its own composer on demand, over the
 * storefront, with the service already chosen.
 */
export function ServiceEnquireDrawer({
  businessId,
  businessName,
  services,
  service,
  serviceName,
  askForContact,
  responseLine,
}: {
  businessId: string;
  businessName: string;
  services: readonly ServiceEnquiryOption[];
  service: string;
  serviceName: string;
  askForContact: boolean;
  responseLine: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={ENQUIRE_LINK}
        aria-label={t("storefront_services.enquire_named", { name: serviceName })}
        onClick={() => setOpen(true)}
      >
        {t("listing.enquire")}
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={t("storefront_services.composer.title")}
        description={serviceName}
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
