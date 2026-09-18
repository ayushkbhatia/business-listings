import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/display/Alert";
import { Button, buttonClassName } from "@/components/primitives";
import { Card, PublicShell } from "@/components/structure";
import { signInHref } from "@/lib/auth/next-path";
import { getActor } from "@/lib/auth/session";
import { getViewer } from "@/lib/auth/viewer";
import { readCompanyInvite } from "@/lib/buyer-company/team-service";
import { authorityLabel, roleLabel } from "@/lib/buyer-company/words";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { companyError } from "../../_errors";
import { joinCompanyAction } from "./actions";

/**
 * Board `7b` `B11` — the page an invitation link opens.
 *
 * What the seat is before anybody accepts it: the company, the role, and the
 * authority that comes with it, in the words the team table uses. An
 * invitation that has expired, been revoked or been used says so and says who
 * to ask; a token that matches nothing is a 404 and names no company.
 *
 * Signed out, it offers sign-in and comes back here. Signed in as a different
 * address, the join refuses and says which address the invitation was for —
 * the link proves somebody could read that inbox, not this one.
 */
export const metadata: Metadata = {
  title: t("company.join.title"),
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const error = typeof query["error"] === "string" ? query["error"] : null;
  const [invite, actor, viewer] = await Promise.all([readCompanyInvite(token), getActor(), getViewer()]);
  const here = `/account/company/join/${encodeURIComponent(token)}`;

  return (
    <PublicShell nav={<DirectoryNav viewer={viewer} />} footer={<DirectoryFooter />}>
      <div className="mx-auto w-full max-w-[40rem] px-5 py-10">
        <Card padded>
          {!invite ? (
            <>
              <h1 className="font-serif text-h1-serif text-ink">{t("company.join.unknown_title")}</h1>
              <p className="mt-2 text-body-sm text-body">{t("company.join.unknown_body")}</p>
            </>
          ) : invite.state !== "invited" ? (
            <>
              <h1 className="font-serif text-h1-serif text-ink">{t("company.join.closed_title")}</h1>
              <p className="mt-2 text-body-sm text-body">
                {companyError(invite.state === "accepted" ? "used" : invite.state)}
              </p>
            </>
          ) : (
            <>
              <p className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted">{t("company.join.eyebrow")}</p>
              <h1 className="mt-1 font-serif text-h1-serif text-ink">
                {t("company.join.heading", { company: invite.companyName })}
              </h1>
              <p className="mt-2 text-body-sm text-body">
                {invite.inviterName
                  ? t("company.join.body_named", {
                      inviter: invite.inviterName,
                      company: invite.companyName,
                      role: roleLabel(invite.role),
                      authority: authorityLabel(invite.role, invite.monthlyLimitAed),
                    })
                  : t("company.join.body", {
                      company: invite.companyName,
                      role: roleLabel(invite.role),
                      authority: authorityLabel(invite.role, invite.monthlyLimitAed),
                    })}
              </p>
              <dl className="mt-4 grid gap-2 text-caption sm:grid-cols-2">
                <div>
                  <dt className="text-body">{t("company.join.for")}</dt>
                  <dd className="text-ink">{invite.email}</dd>
                </div>
                <div>
                  <dt className="text-body">{t("company.join.expires")}</dt>
                  <dd className="text-ink">{formatDate(invite.expiresAt)}</dd>
                </div>
              </dl>

              {error ? (
                <div className="mt-4">
                  <Alert tone="bad" live="assertive" fix={companyError(error)}>
                    {t("company.error.not_done")}
                  </Alert>
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                {actor ? (
                  <form action={joinCompanyAction}>
                    <input type="hidden" name="token" value={token} />
                    <Button type="submit">{t("company.join.submit", { company: invite.companyName })}</Button>
                  </form>
                ) : (
                  <Link href={signInHref(here)} className={buttonClassName()}>
                    {t("company.join.sign_in")}
                  </Link>
                )}
              </div>
              <p className="mt-3 text-caption text-body">{t("company.join.rule_note")}</p>
            </>
          )}
        </Card>
      </div>
    </PublicShell>
  );
}
