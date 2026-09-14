import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { Card, PublicShell } from "@/components/structure";
import { closureForToken } from "@/lib/closure/service";
import { closureState } from "@/lib/closure/policy";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { ReopenByLink } from "./ReopenByLink";

/**
 * Board `11i` build note `B3` — the link in the closure email.
 *
 * **This page only reads.** The reversal happens on its one button, not on the
 * GET: most corporate mailboxes pre-fetch every link in a message to scan it,
 * and a link that reversed on arrival would be reversed by a scanner before the
 * seller had read the email.
 *
 * No sign-in. The owner may no longer be able to reach the dashboard cleanly —
 * every seat was revoked and every session ended — and the token, which exists
 * only in the email, is the proof. `noindex` comes from `/account`'s layout.
 *
 * Each refusal says what is true and what, if anything, can still be done. A
 * broken link and an expired one are different sentences: one is a mail client
 * mangling a URL, the other is a closure that is now final.
 */
export const metadata = { title: t("closure.link.meta_title") };
export const dynamic = "force-dynamic";

export default async function ReopenByLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const now = new Date();
  const closure = await closureForToken(token);

  return (
    <PublicShell nav={<DirectoryNav />} footer={<DirectoryFooter />}>
      <div className="mx-auto w-full max-w-[40rem] px-5 py-16">
        <Card padded>{closure ? <Body closure={closure} token={token} now={now} /> : <Broken />}</Card>
      </div>
    </PublicShell>
  );
}

function Broken() {
  return (
    <>
      <h1 className="text-h2 text-ink">{t("closure.link.broken_title")}</h1>
      <p className="mt-2 max-w-prose text-body-sm text-body-ink">{t("closure.link.broken_body")}</p>
      <div className="mt-5">
        <Link href="/signin?next=/dashboard/account/close" className={buttonClassName({ variant: "secondary" })}>
          {t("closure.link.sign_in")}
        </Link>
      </div>
    </>
  );
}

function Body({
  closure,
  token,
  now,
}: {
  closure: NonNullable<Awaited<ReturnType<typeof closureForToken>>>;
  token: string;
  now: Date;
}) {
  const name = closure.business.displayName;
  const state = closureState(closure, now);

  if (closure.initiator === "platform") {
    return (
      <>
        <h1 className="text-h2 text-ink">{name}</h1>
        <p className="mt-2 max-w-prose text-body-sm text-body-ink">
          {t("closure.reopen.platform", { business: name, date: formatDate(closure.finalAt) })}
        </p>
      </>
    );
  }

  if (state === "reversed") {
    return (
      <>
        <h1 className="text-h2 text-ink">{t("closure.link.already_title", { business: name })}</h1>
        <p className="mt-2 max-w-prose text-body-sm text-body-ink">
          {t("closure.link.already_body", { date: formatDate(closure.reversedAt ?? now) })}
        </p>
        <div className="mt-5">
          <Link href={`/b/${closure.business.slug}`} className={buttonClassName({ variant: "secondary" })}>
            {t("closure.link.view_listing")}
          </Link>
        </div>
      </>
    );
  }

  if (state !== "requested") {
    return (
      <>
        <h1 className="text-h2 text-ink">{t("closure.link.expired_title", { business: name })}</h1>
        <p className="mt-2 max-w-prose text-body-sm text-body-ink">
          {t("closure.link.expired_body", { business: name, date: formatDate(closure.finalAt) })}
        </p>
      </>
    );
  }

  return (
    <>
      <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">
        {t("closure.reopen.eyebrow")}
      </p>
      <h1 className="mt-2 text-h2 text-ink">{name}</h1>
      <p className="mt-2 max-w-prose text-body-sm text-body-ink">
        {t("closure.reopen.body", {
          business: name,
          closed: formatDate(closure.appliedAt ?? closure.requestedAt),
          date: formatDate(closure.finalAt),
        })}
      </p>
      <p className="mt-2 max-w-prose text-caption text-muted">{t("closure.reopen.seats_note")}</p>
      <div className="mt-5">
        <ReopenByLink token={token} label={t("closure.reopen.cta", { business: name })} />
      </div>
    </>
  );
}
