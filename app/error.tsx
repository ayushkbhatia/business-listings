"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonClassName } from "@/components/primitives";
import { t } from "@/lib/i18n";
import { ErrorState } from "./_error/ErrorState";

/**
 * The error boundary under the root layout. Until this existed an uncaught
 * render error showed Next's unstyled default, with no landmark and no way to
 * tell a visitor it was ours.
 *
 * `retry` re-fetches the segment (stable since 16.3), which is what recovers a
 * server component that failed on a transient read; `reset` would re-render the
 * same failure.
 */
export default function RouteError({
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
    <main>
      <title>{t("errorpage.document_title")}</title>
      <ErrorState
        digest={error.digest}
        action={
          <>
            <Button size="sm" onClick={() => retry()}>
              {t("action.retry")}
            </Button>
            <Link href="/" className={buttonClassName({ variant: "secondary", size: "sm" })}>
              {t("notfound.home")}
            </Link>
          </>
        }
      />
    </main>
  );
}
