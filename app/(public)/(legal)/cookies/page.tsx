import type { Metadata } from "next";
import { cookiesDocument } from "@/lib/legal/documents";
import { LegalPage, legalMetadata } from "../_LegalPage";

/**
 * Board 13h — five sections and a register of cookies in four categories:
 * twelve since the 22 Sep 2026 amendment, which added the three a buyer's own
 * actions set (`bl_cmp`, `bl_rsid`, `bl_vid`).
 *
 * The register is the point of the page and it is a contract: it names every
 * cookie the application is permitted to set. `lib/legal/cookie-register.ts`
 * holds the same names as data so that a crawl can assert against them
 * rather than against prose — without that the page is true on the day it ships
 * and false within two sprints, and the way it goes false is a third-party
 * script setting a cookie nobody documented.
 */

export const revalidate = 31536000;

export function generateMetadata(): Metadata {
  return legalMetadata(cookiesDocument());
}

export default function Page() {
  return <LegalPage document={cookiesDocument()} />;
}
