import type { Metadata } from "next";
import { policyMetadata, PolicyPage } from "../_Policy";

/** Board 10j. The wording is in the database; this is the address. */

export const revalidate = 3600;

export function generateMetadata(): Promise<Metadata> {
  return policyMetadata("review-policy");
}

export default function Page() {
  return <PolicyPage policy="review-policy" />;
}
