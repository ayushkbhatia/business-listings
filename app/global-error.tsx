"use client";

import { useEffect } from "react";
import { Button } from "@/components/primitives";
import { dir, DEFAULT_LOCALE, t } from "@/lib/i18n";
import { ErrorState } from "./_error/ErrorState";
import "./globals.css";

/**
 * The root layout failed, so this replaces it and has to bring its own
 * document and stylesheet. No link home: the layout every page shares is the
 * thing that failed, so the home page is as likely to fail as this one was.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang={DEFAULT_LOCALE} dir={dir(DEFAULT_LOCALE)}>
      <body>
        <title>{t("errorpage.document_title")}</title>
        <main>
          <ErrorState
            digest={error.digest}
            action={
              <Button size="sm" onClick={() => retry()}>
                {t("action.retry")}
              </Button>
            }
          />
        </main>
      </body>
    </html>
  );
}
