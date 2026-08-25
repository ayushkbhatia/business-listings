import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { Card } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * The root 404.
 *
 * Next's default has no landmarks at all, so every not-found in the app failed
 * `landmark-one-main` — including the ones a signed-out visitor reaches by
 * typing a dashboard URL, which is the most likely way anybody meets it.
 *
 * It surfaced sideways: an acceptance run whose stored session had expired sent
 * every seller route here, and the axe check reported a missing main landmark
 * rather than a missing session. The 404 was a real defect either way.
 *
 * The copy names all three reasons a page might not be here, because the most
 * common of them — not signed in — is the one a "page not found" heading
 * actively misleads somebody about.
 */
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-[42rem] px-[var(--section-pad)] py-16">
      <Card padded>
        <h1 className="text-h2 text-ink">{t("notfound.title")}</h1>
        <p className="mt-2 max-w-prose text-body-sm text-muted">{t("notfound.body")}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/" className={buttonClassName({ size: "sm" })}>
            {t("notfound.home")}
          </Link>
          <Link href="/signin" className={buttonClassName({ variant: "secondary", size: "sm" })}>
            {t("notfound.signin")}
          </Link>
        </div>
      </Card>
    </main>
  );
}
