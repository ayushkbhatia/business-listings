import type { Metadata } from "next";
import { Button, Input } from "@/components/primitives";
import { t } from "@/lib/i18n";
import { AuthCard } from "../_components/AuthCard";
import { AuthFailure } from "../_components/failures";
import { signInAction } from "../actions";

/**
 * The staff door.
 *
 * ## What this page must not become
 *
 * `lib/auth/staff.ts` answers a missing staff role with `notFound()` rather
 * than a 403, so that somebody who guesses `/admin/queue` learns the URL does
 * not exist rather than that it exists and is guarded. A staff sign-in page
 * spends some of that, and the job here is to spend as little as possible.
 *
 * Three properties, all load-bearing:
 *
 *   1. **Nothing links here.** Not the root 404, not the footer, not the nav,
 *      not the sitemap. `robots.ts` disallows it beside `/admin`, and the
 *      metadata below asks not to be indexed. Somebody reaches this page
 *      because they were told the address.
 *   2. **It is the same `startSignIn` as every other door.** Same throttle,
 *      same neutral outcome. A staff-only form that answered differently for a
 *      staff number than for anybody else's would be an oracle: type numbers
 *      until one behaves differently and you have found an ops lead. So this
 *      form cannot tell, does not check, and is not told.
 *   3. **It grants nothing.** `next=/admin` is a destination, not a
 *      permission — `isSafeNext` lets any same-origin path through and always
 *      has. A buyer who signs in here and follows it gets `requireStaff()`'s
 *      404, which is exactly what they would get typing `/admin` directly.
 *
 * What this page is, then, is a bookmark with a form on it. The security
 * boundary is where it has always been: the role on the profile row, read
 * server-side on every admin page.
 */
export const metadata: Metadata = {
  title: "Staff sign in",
  robots: { index: false, follow: false },
};

export default async function StaffSignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);

  return (
    <AuthCard title={t("auth.staff.title")} lede={t("auth.staff.lede")}>
      <form action={signInAction} className="space-y-4">
        <AuthFailure
          {...{ error: one("error"), retry: one("retry"), since: one("since"), limit: one("limit") }}
          restartHref="/staff"
          onRequest
        />

        <div>
          <label htmlFor="identifier" className="mb-1.5 block text-body-sm text-ink">
            {t("auth.signin.identifier")}
          </label>
          <Input
            id="identifier"
            name="identifier"
            type="text"
            inputMode="tel"
            autoComplete="username"
            required
            autoFocus
            defaultValue={one("to") ?? ""}
            aria-describedby="staff-identifier-hint"
            invalid={one("error") === "invalid_identifier"}
          />
          <p id="staff-identifier-hint" className="mt-1.5 text-caption text-muted">
            {t("auth.staff.identifier_hint")}
          </p>
        </div>

        <input type="hidden" name="next" value="/admin" />
        <input type="hidden" name="from" value="/staff" />

        <Button type="submit" block>
          {t("auth.signin.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
