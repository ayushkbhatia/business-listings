import Link from "next/link";
import { Button, buttonClassName } from "@/components/primitives";
import { Alert, StatusBadge } from "@/components/display";
import { Card, Panel } from "@/components/structure";
import { getActor } from "@/lib/auth/session";
import { devGate } from "@/lib/dev/guard";
import { SEAT_KINDS, seatBusinesses, seatEmail } from "@/lib/dev/seat";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { signOutAction, takeSeatAction } from "./actions";

/**
 * The seat picker.
 *
 * One page whose whole job is to answer "what does this screen look like from
 * inside a session, for this business, in this role" without a script run and a
 * code typed into a form. It is the surface the rest of the seller dashboard
 * has been built without.
 *
 * Every row is a real sign-in: see lib/dev/seat.ts for why that is not a
 * bypass, and lib/dev/guard.ts for the three conditions that have to hold
 * before this route resolves at all.
 */
export const metadata = { title: "Dev seat" };
export const dynamic = "force-dynamic";

export default async function DevSeatPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; signed_out?: string }>;
}) {
  const gate = devGate();
  const [{ error, signed_out: signedOut }, actor, businesses] = await Promise.all([
    searchParams,
    getActor(),
    seatBusinesses(),
  ]);

  const held = actor
    ? SEAT_KINDS.find((kind) => kind.roles.every((role) => actor.roles.includes(role)))
    : undefined;

  return (
    <main data-density="comfortable" className="mx-auto max-w-[1100px] px-6 py-8">
      <header className="mb-5">
        <p className="font-mono text-eyebrow uppercase text-faint">{t("dev.seat.eyebrow")}</p>
        <h1 className="mt-1 font-serif text-h1-serif text-ink">{t("dev.seat.title")}</h1>
        <p className="mt-2 max-w-prose text-body-sm text-muted">{t("dev.seat.intro")}</p>
        <p className="mt-1 font-mono text-eyebrow uppercase text-faint">
          {t("dev.seat.target", { target: gate.target })}
        </p>
      </header>

      {error && (
        <div className="mb-4">
          <Alert tone="bad" live="assertive" fix={t("dev.seat.error_fix")}>
            {error}
          </Alert>
        </div>
      )}

      {signedOut && (
        <div className="mb-4">
          <Alert tone="info" live="polite">
            {t("dev.seat.signed_out")}
          </Alert>
        </div>
      )}

      <div className="mb-5">
        <Card padded>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-body-sm text-ink">
                {actor
                  ? t("dev.seat.holding", {
                      roles: actor.roles.join(", "),
                      business: actor.businessId ?? t("dev.seat.no_business"),
                    })
                  : t("dev.seat.holding_none")}
              </p>
              {held && (
                <p className="mt-1 font-mono text-eyebrow uppercase text-faint">
                  {t("dev.seat.landing", { href: held.landing })}
                </p>
              )}
            </div>
            {actor && (
              <form action={signOutAction}>
                <Button type="submit" variant="secondary" size="sm">
                  {t("dev.seat.sign_out")}
                </Button>
              </form>
            )}
          </div>
        </Card>
      </div>

      <Panel
        title={t("dev.seat.platform_title")}
        description={t("dev.seat.platform_body")}
        padded
      >
        <ul className="flex flex-wrap gap-2">
          {SEAT_KINDS.filter((kind) => !kind.needsBusiness).map((kind) => (
            <li key={kind.key}>
              <form action={takeSeatAction}>
                <input type="hidden" name="kind" value={kind.key} />
                <Button type="submit" variant="secondary" size="sm">
                  {t(`dev.seat.kind.${kind.key}` as never)}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="mt-4">
        <Panel
          title={t("dev.seat.seller_title")}
          description={t("dev.seat.seller_body")}
          padded={false}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body-sm">
              <caption className="sr-only">{t("dev.seat.table_caption")}</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2 text-start font-mono text-colhead uppercase text-muted">
                    {t("dev.seat.col.business")}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-mono text-colhead uppercase text-muted">
                    {t("dev.seat.col.plan")}
                  </th>
                  <th scope="col" className="px-4 py-2 text-end font-mono text-colhead uppercase text-muted">
                    {t("dev.seat.col.strength")}
                  </th>
                  <th scope="col" className="px-4 py-2 text-end font-mono text-colhead uppercase text-muted">
                    {t("dev.seat.col.products")}
                  </th>
                  <th scope="col" className="px-4 py-2 text-end font-mono text-colhead uppercase text-muted">
                    {t("dev.seat.col.photos")}
                  </th>
                  <th scope="col" className="px-4 py-2 text-end font-mono text-colhead uppercase text-muted">
                    {t("dev.seat.col.seats")}
                  </th>
                  <th scope="col" className="px-4 py-2 text-start font-mono text-colhead uppercase text-muted">
                    {t("dev.seat.col.state")}
                  </th>
                  <th scope="col" className="px-4 py-2 text-end font-mono text-colhead uppercase text-muted">
                    {t("dev.seat.col.sign_in")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {businesses.map((business) => (
                  <tr key={business.slug} className="border-b border-line last:border-b-0">
                    <th scope="row" className="px-4 py-2 text-start font-normal">
                      <span className="block text-ink">{business.displayName}</span>
                      <Link
                        href={`/b/${business.slug}`}
                        className="mt-0.5 block font-mono text-eyebrow text-faint hover:text-muted"
                      >
                        /b/{business.slug}
                      </Link>
                    </th>
                    <td className="px-4 py-2 font-mono text-eyebrow uppercase text-muted">
                      {business.planId}
                      {" · "}
                      {t("dev.seat.tier", { tier: String(business.verificationTier) })}
                    </td>
                    <td className="px-4 py-2 text-end font-mono tabular-nums text-muted">
                      {business.profileStrength === null
                        ? "—"
                        : `${formatCount(business.profileStrength)}%`}
                    </td>
                    <td className="px-4 py-2 text-end font-mono tabular-nums text-muted">
                      {formatCount(business.products)}
                    </td>
                    <td className="px-4 py-2 text-end font-mono tabular-nums text-muted">
                      {formatCount(business.photos)}
                    </td>
                    <td className="px-4 py-2 text-end font-mono tabular-nums text-muted">
                      {formatCount(business.seats)}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge
                        tone={business.suspended ? "bad" : business.live ? "ok" : "neutral"}
                        shape="chip"
                      >
                        {business.suspended
                          ? t("dev.seat.state.suspended")
                          : business.live
                            ? t("dev.seat.state.live")
                            : t("dev.seat.state.draft")}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        {SEAT_KINDS.filter((kind) => kind.needsBusiness).map((kind) => (
                          <form key={kind.key} action={takeSeatAction}>
                            <input type="hidden" name="kind" value={kind.key} />
                            <input type="hidden" name="slug" value={business.slug} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              title={seatEmail(kind, business.slug)}
                            >
                              {t(`dev.seat.kind.${kind.key}` as never)}
                            </Button>
                          </form>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <p className="mt-4 text-caption text-muted">
        {t("dev.seat.script_note")}{" "}
        <Link href="/dev" className={buttonClassName({ variant: "link", size: "sm" })}>
          {t("dev.index.title")}
        </Link>
      </p>
    </main>
  );
}
