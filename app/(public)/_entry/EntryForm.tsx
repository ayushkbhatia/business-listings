import Link from "next/link";
import { Button, Input } from "@/components/primitives";
import { Card } from "@/components/structure";
import { t } from "@/lib/i18n";
import { AuthFailure } from "@/app/(auth)/_components/failures";
import { signInAction } from "@/app/(auth)/actions";
import { entryPath, type EntryAudience } from "./audience";

/**
 * The sign-in card on an entry surface.
 *
 * The same server action, the same throttle and the same neutral outcome as
 * `/signin` — only the copy around it changes. That is the whole design of
 * these pages: two audiences are being argued with differently and authenticated
 * identically, because the moment there are two sign-in *paths* there are two
 * rate limiters, two OTP flows and two sets of bugs.
 *
 * `audience` is a hint, never a grant. It preselects the intent on `/signup`
 * and it decides which copy `/verify` shows. It cannot make anybody a supplier:
 * roles are read from the profile row after the code is verified, and a buyer
 * who signs in here lands wherever a buyer lands.
 */
export function EntryForm({
  audience,
  params,
}: {
  audience: EntryAudience;
  params: { error?: string; retry?: string; since?: string; limit?: string; to?: string };
}) {
  const here = entryPath(audience);

  return (
    <Card padded as="article">
      <h2 className="text-h3 text-ink">{t(`entry.${audience}.form_title` as never)}</h2>
      <p className="mt-1.5 text-body-sm text-muted">{t("entry.form_lede")}</p>

      <form action={signInAction} className="mt-5 space-y-4">
        <AuthFailure
          error={params.error}
          retry={params.retry}
          since={params.since}
          limit={params.limit}
          restartHref={here}
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
            defaultValue={params.to ?? ""}
            aria-describedby="entry-identifier-hint"
            invalid={params.error === "invalid_identifier"}
          />
          <p id="entry-identifier-hint" className="mt-1.5 text-caption text-muted">
            {t("auth.signin.identifier_hint")}
          </p>
        </div>

        {/*
          Where a refusal returns to, and what `/verify` reads so "start again"
          starts again here rather than on `/signin`. Not a role and not a
          permission — see the note above.
        */}
        <input type="hidden" name="from" value={here} />

        <Button type="submit" block>
          {t("auth.signin.submit")}
        </Button>
      </form>

      <div className="mt-5 space-y-2 border-t border-line pt-4 text-body-sm">
        <p className="flex flex-wrap items-center gap-x-2 text-muted">
          {t("auth.signin.no_account")}
          <Link
            href={`/signup?as=${audience}`}
            className="rounded-tag text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("auth.signup.title")}
          </Link>
        </p>
        <p className="text-caption text-muted">{t(`entry.${audience}.form_hint` as never)}</p>
      </div>
    </Card>
  );
}
