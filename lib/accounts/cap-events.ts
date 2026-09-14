import "server-only";
import { recordEvent } from "@/lib/telemetry/record";

/**
 * Board 4f `B6` — recording that a seller hit their plan's ceiling.
 *
 * One writer for both kinds, so the four doors that refuse (a bulk publish, the
 * onboarding sheet, a new service, the common-services seeder) describe the
 * event the same way and the upgrade-candidate query reads one shape. Never
 * throws: `recordEvent` swallows its own failure, and a refusal the seller is
 * already being shown must not fail because the counter could not be written.
 */

export type CapSurface = "bulk_publish" | "onboarding_sheet" | "new_service" | "common_services";

export async function recordCapRefused(input: {
  kind: "products" | "services";
  businessId: string;
  actorId: string | null;
  /** The plan's display name or id — whichever the refusal already has. */
  plan: string;
  cap: number;
  attempted: number;
  surface: CapSurface;
}): Promise<void> {
  await recordEvent({
    name: input.kind === "products" ? "product_cap_refused" : "service_cap_refused",
    businessId: input.businessId,
    actorId: input.actorId,
    props: {
      plan: input.plan,
      cap: input.cap,
      attempted: Math.max(1, input.attempted),
      surface: input.surface,
    },
  });
}

/** The event names the upgrade-candidate query reads. */
export const CAP_REFUSED_EVENTS = ["product_cap_refused", "service_cap_refused"] as const;
