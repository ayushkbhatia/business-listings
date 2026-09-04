import Link from "next/link";
import { StatusBadge } from "@/components/display";
import { Panel } from "@/components/structure";
import { getActor } from "@/lib/auth/session";
import { devGate } from "@/lib/dev/guard";
import { SURFACE_GROUPS } from "@/lib/dev/surfaces";
import { t } from "@/lib/i18n";

/**
 * The index of every surface, and which seat opens it.
 *
 * There was no way to see the product's shape without reading the route tree,
 * and the one written description of it — docs/routes.md — had drifted in both
 * directions at once: a built screen missing from it, three unbuilt ones listed
 * as though they were there. A list you can click resolves that in the only way
 * that lasts, which is by being used.
 */
export const metadata = { title: "Dev index" };
export const dynamic = "force-dynamic";

export default async function DevIndexPage() {
  const gate = devGate();
  const actor = await getActor();

  return (
    <main data-density="comfortable" className="mx-auto max-w-[1100px] px-6 py-8">
      <header className="mb-5">
        <p className="font-mono text-eyebrow uppercase text-faint">{t("dev.index.eyebrow")}</p>
        <h1 className="mt-1 font-serif text-h1-serif text-ink">{t("dev.index.title")}</h1>
        <p className="mt-2 max-w-prose text-body-sm text-muted">{t("dev.index.intro")}</p>
        <p className="mt-1 font-mono text-eyebrow uppercase text-faint">
          {t("dev.seat.target", { target: gate.target })}
          {" · "}
          {actor
            ? t("dev.index.signed_in", { roles: actor.roles.join(", ") })
            : t("dev.index.signed_out")}
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {SURFACE_GROUPS.map((group) => (
          <Panel
            key={group.key}
            title={group.label}
            description={
              group.seat === "none"
                ? t("dev.index.no_seat_needed")
                : t("dev.index.needs_seat", { seat: t(`dev.seat.kind.${group.seat}` as never) })
            }
            padded
          >
            <ul className="flex flex-col gap-1.5">
              {group.surfaces.map((surface) => (
                <li key={surface.href} className="flex flex-wrap items-baseline gap-2">
                  {surface.planned ? (
                    <span className="font-mono text-body-sm text-faint">{surface.href}</span>
                  ) : (
                    <Link
                      href={surface.href}
                      className="font-mono text-body-sm text-moss-deep hover:underline"
                    >
                      {surface.href}
                    </Link>
                  )}
                  <span className="text-caption text-muted">{surface.what}</span>
                  {surface.board && (
                    <span className="font-mono text-eyebrow uppercase text-faint">
                      {surface.board}
                    </span>
                  )}
                  {surface.planned && (
                    <StatusBadge tone="neutral" shape="chip" size="sm">
                      {t("dev.index.planned")}
                    </StatusBadge>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </main>
  );
}
