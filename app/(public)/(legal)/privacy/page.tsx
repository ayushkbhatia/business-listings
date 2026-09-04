import type { Metadata } from "next";
import { privacyDocument } from "@/lib/legal/documents";
import { LegalPage, legalMetadata } from "../_LegalPage";

/**
 * Board 13g — twelve sections written to the UAE Personal Data Protection Law,
 * Federal Decree-Law 45 of 2021.
 *
 * Two of the twelve are load-bearing rather than boilerplate. §04 describes the
 * enquiry disclosure model the fan-out already implements, and
 * `lib/enquiry/payload.test.ts` pins the field list against it. §07's retention
 * table is the specification for deletion jobs nobody has written yet — the
 * page publishes before them, but the nearest row comes due twelve months after
 * the first verification document expires.
 */

export const revalidate = 31536000;

export function generateMetadata(): Metadata {
  return legalMetadata(privacyDocument());
}

export default function Page() {
  return <LegalPage document={privacyDocument()} />;
}
