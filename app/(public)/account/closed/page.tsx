import Link from "next/link";
import { cookies } from "next/headers";
import { buttonClassName } from "@/components/primitives";
import { Card, PublicShell } from "@/components/structure";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { CLOSURE_DONE_COOKIE, decodeDone } from "@/lib/closure/done-cookie";

/**
 * Board 11i — where a seller lands the moment they close.
 *
 * Public, because they are signed out by the time it renders. It reads the
 * short-lived cookie the action set and says the three things they need: what
 * came down, the last day it can come back, and where the link went — or, if
 * the email could not be sent, the other way back. With no cookie (a refresh
 * after half an hour, a shared link) it says what is true of any closure and no
 * more. `noindex` comes from `/account`'s layout.
 */
export const metadata = { title: t("closure.done.meta_title") };
export const dynamic = "force-dynamic";

export default async function ClosedPage() {
  const done = decodeDone((await cookies()).get(CLOSURE_DONE_COOKIE)?.value);

  return (
    <PublicShell nav={<DirectoryNav />} footer={<DirectoryFooter />}>
      <div className="mx-auto w-full max-w-[40rem] px-5 py-16">
        <Card padded>
          {done ? (
            <>
              <h1 className="text-h2 text-ink">{t("closure.done.title", { business: done.businessName })}</h1>
              <p className="mt-2 max-w-prose text-body-sm text-body-ink">
                {t("closure.done.body", { date: done.finalOn })}
              </p>
              <p className="mt-2 max-w-prose text-body-sm text-body-ink">
                {done.emailed && done.emailTo
                  ? t("closure.done.emailed", { email: done.emailTo, date: done.finalOn })
                  : t("closure.done.not_emailed", { date: done.finalOn })}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-h2 text-ink">{t("closure.done.generic_title")}</h1>
              <p className="mt-2 max-w-prose text-body-sm text-body-ink">{t("closure.done.generic_body")}</p>
            </>
          )}
          <div className="mt-5">
            <Link href="/" className={buttonClassName({ variant: "secondary" })}>
              {t("closure.done.home")}
            </Link>
          </div>
        </Card>
      </div>
    </PublicShell>
  );
}
