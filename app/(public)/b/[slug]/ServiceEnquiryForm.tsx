"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ServiceEnquiryComposer,
  type ServiceEnquiryOption,
  type ServiceEnquiryValue,
} from "@/components/domain/ServiceEnquiryComposer";
import type { ServiceEnquiryField } from "@/lib/enquiry/service-enquiry";
import { confirmServiceEnquiryAttachment, submitServiceEnquiry } from "./service-enquiry-actions";

/**
 * Board `1d-s` — the storefront composer, bound to its two server actions.
 *
 * Send first; then, only if the enquiry now exists and the buyer chose a file,
 * put the bytes straight into storage with the signature the send returned and
 * confirm them. The browser posts the file to storage rather than through a
 * server action for the reason `lib/storage` gives: megabytes in an action body
 * are megabytes held in memory and base64'd on the way.
 *
 * Whatever happens to the file, the buyer lands on their enquiry. A failed
 * upload adds `attachment=failed`, which the tracking page reads out — the
 * enquiry was delivered, and saying so plainly beats a form that sits there.
 */
export function ServiceEnquiryForm({
  businessId,
  businessName,
  services,
  initialService,
  askForContact,
  responseLine,
}: {
  businessId: string;
  businessName: string;
  services: readonly ServiceEnquiryOption[];
  initialService: string | null;
  askForContact: boolean;
  responseLine: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>(undefined);
  const [fields, setFields] = useState<Partial<Record<ServiceEnquiryField, string>>>({});

  function send(value: ServiceEnquiryValue) {
    setError(undefined);
    setFields({});

    startTransition(async () => {
      const sent = await submitServiceEnquiry({
        businessId,
        service: value.service,
        requirement: value.requirement,
        scale: value.scale,
        neededBy: value.neededBy,
        contactPhone: value.contactPhone,
        contactName: value.contactName,
        attachment: value.file
          ? { filename: value.file.name, type: value.file.type, bytes: value.file.size }
          : null,
      });

      if (!sent.ok) {
        setError(sent.error);
        setFields(sent.fields);
        return;
      }

      let next = sent.next;
      if (value.file && sent.upload) {
        const delivered = await deliver(value.file, sent.upload.url).then(
          (ok) =>
            ok &&
            confirmServiceEnquiryAttachment({
              enquiryId: sent.enquiryId,
              path: sent.upload!.path,
              filename: value.file!.name,
              claimToken: sent.claimToken,
            }).then((result) => result.ok),
        );
        if (!delivered) next = withFailedAttachment(next);
      }

      router.push(next);
    });
  }

  return (
    <ServiceEnquiryComposer
      businessName={businessName}
      services={services}
      initialService={initialService}
      askForContact={askForContact}
      responseLine={responseLine}
      busy={pending}
      fieldErrors={fields}
      onSubmit={send}
      {...(error ? { error } : {})}
    />
  );
}

/** One PUT to the signed URL. A network failure is a `false`, not a throw. */
async function deliver(file: File, url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: { "content-type": file.type },
      body: file,
    });
    return response.ok;
  } catch {
    return false;
  }
}

function withFailedAttachment(next: string): string {
  const url = new URL(next, window.location.origin);
  url.searchParams.set("attachment", "failed");
  return `${url.pathname}${url.search}`;
}
