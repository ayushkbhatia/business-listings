import { notFound } from "next/navigation";
import { devGate } from "@/lib/dev/guard";

/**
 * The fence around every /dev surface.
 *
 * A layout rather than a check in each page: a route added under /dev six
 * months from now inherits the gate whether or not whoever adds it remembers
 * it, which is the only kind of gate that holds. `notFound()` rather than a
 * 403 — a production visitor should not learn that the route exists, which is
 * the same argument lib/auth/staff.ts makes about the admin console.
 *
 * `force-dynamic` is load-bearing. These pages were prerendered at build time,
 * so a static shell would be served before the gate ever ran.
 */
export const dynamic = "force-dynamic";

export default function DevLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (!devGate().allowed) notFound();
  return children;
}
