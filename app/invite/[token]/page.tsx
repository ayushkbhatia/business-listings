import type { Metadata } from "next";
import Link from "next/link";
import { Button, buttonClassName } from "@/components/primitives";
import { Card } from "@/components/structure";
import { signInHref } from "@/lib/auth/next-path";
import { getActor } from "@/lib/auth/session";
import { describeRoles, readInvite, seatOf } from "@/lib/team/invite";
import { t } from "@/lib/i18n";
import { acceptInviteAction } from "./actions";

/**
 * Board 8d's accept surface — the screen a team invitation link opens.
 *
 * **Outside every route group, deliberately.** `(auth)` is for somebody proving
 * who they are, `(dashboard)` for somebody who already holds a seat, `(public)`
 * for a buyer browsing. An invitee is none of the three: they may have no
 * account at all, and if they do it is usually a buyer's. Putting this under
 * `(dashboard)` would wrap it in a sidebar for a business they cannot open yet;
 * under `(auth)` it would inherit a frame whose only job is a code field.
 *
 * It carries its own frame for that reason. There is no layout at `app/invite`,
 * so the wordmark and the paper ground are here, matching `(auth)`'s: one link
 * out, nothing else to click, because everything else on this page is a way to
 * lose somebody who was sent here to do one thing.
 *
 * **Every refusal gets a screen of its own.** Four token states, plus the two a
 * person cannot fix by trying again, and each says what is wrong and who to ask.
 * The two that a stranger could reach by guessing — a token that is not ours and
 * one already spent — name no business at all.
 */

export const metadata: Metadata = {
  title: t("invite.meta_title"),
  // Never indexed. A live invitation link in a search result is a seat granted
  // to whoever searched, and a spent one is a supplier's team page in public.
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function InvitePage({ params, searchParams }: Props) {
  const { token } = await params;
  const query = await searchParams;

  const actor = await getActor();
  const holder = actor ? await seatOf(actor.id) : null;

  /*
     The confirmation, read back off the record rather than off the query string.

     `?accepted=1` alone would be a screen anybody could conjure by typing it,
     and a page that congratulated somebody on a seat they do not hold is the
     kind of lie this product is built not to tell. So the parameter only says
     "you have just come from the accept action"; whether the seat exists is
     answered by their own row. Anything else falls through to the states below,
     where a spent token reads as spent.
  */
  if (query["accepted"] === "1" && holder?.businessId && holder.businessName) {
    return (
      <InviteFrame>
        <InviteCard
          title={t("invite.accepted_title")}
          body={t("invite.accepted_body", { business: holder.businessName })}
        >
          <Link href="/dashboard/leads" className={buttonClassName()}>
            {t("invite.to_dashboard")}
          </Link>
        </InviteCard>
      </InviteFrame>
    );
  }

  const invite = await readInvite(token);

  if (invite.state === "not_found") {
    return (
      <InviteFrame>
        <InviteCard
          title={t("invite.not_found_title")}
          body={t("invite.not_found_body")}
        />
      </InviteFrame>
    );
  }

  if (invite.state === "already_used") {
    return (
      <InviteFrame>
        <InviteCard title={t("invite.used_title")} body={t("invite.used_body")} />
      </InviteFrame>
    );
  }

  if (invite.state === "expired") {
    return (
      <InviteFrame>
        <InviteCard
          title={t("invite.expired_title")}
          body={t("invite.expired_body", { business: invite.businessName })}
        />
      </InviteFrame>
    );
  }

  if (invite.state === "revoked") {
    return (
      <InviteFrame>
        <InviteCard
          title={t("invite.revoked_title")}
          body={t("invite.revoked_body", { business: invite.businessName })}
        />
      </InviteFrame>
    );
  }

  /*
     The roles line, only where there are roles to name. `readInvite` filters the
     stored array through the ceiling, so a row that offered nothing but
     ownership arrives here empty — and "The seat lets you ." is a sentence with
     a hole in it, which is worse than one line fewer.
  */
  const roles = invite.roles.length > 0 ? describeRoles(invite.roles) : null;

  /*
     Signed out. The token survives the OTP round trip as `next`, so somebody who
     came in from an email lands back on this page holding a session rather than
     on the directory home page wondering where the invitation went.

     `destinationFor` returns `next` ahead of everything else when it is safe,
     and `isSafeNext` is what decides that — a same-origin path, no scheme, no
     `//host`. `signInHref` applies both that check and the encoding, for the
     same reason the action uses it.
  */
  if (!actor || !holder) {
    const next = `/invite/${encodeURIComponent(token)}`;
    return (
      <InviteFrame>
        <InviteCard
          title={t("invite.title", { business: invite.businessName })}
          body={t("invite.intro", { inviter: invite.inviterName, contact: invite.contact })}
        >
          {roles ? (
            <p className="mb-4 max-w-prose text-body-sm text-body">
              {t("invite.roles", { roles })}
            </p>
          ) : null}
          <Link
            href={signInHref(next)}
            className={buttonClassName({ block: true })}
          >
            {t("invite.sign_in")}
          </Link>
        </InviteCard>
      </InviteFrame>
    );
  }

  /*
     An invitation is to a person, not to whoever opens the link. A forwarded
     email is the ordinary case — a manager sends it on to the colleague it was
     meant for — and a seat that landed on whoever clicked first would be a seat
     granted to a mailing list.
  */
  /*
     Either channel, the same rule the service applies. An invitation to a
     mobile is accepted by the account holding that mobile; comparing only the
     address would refuse every WhatsApp invitation, and the refusal reads like
     a broken link rather than a mismatch.
  */
  const holds = [holder.email, holder.phone]
    .filter((value): value is string => typeof value === "string" && value !== "")
    .map((value) => value.trim().toLowerCase());
  if (!holds.includes(invite.contact.trim().toLowerCase())) {
    return (
      <InviteFrame>
        <InviteCard
          title={t(
            invite.channel === "whatsapp"
              ? "invite.wrong_account_title_phone"
              : "invite.wrong_account_title",
          )}
          body={t("invite.wrong_account_body", {
            contact: invite.contact,
            // A phone-only account has no address to name, and the number is
            // more use to them than an empty gap in the sentence.
            current: holder.email ?? holder.phone ?? "",
          })}
        />
      </InviteFrame>
    );
  }

  /*
     Already seated somewhere else.

     `User.businessId` is one column, so accepting would move them off the
     listing they are on and take their access to its enquiries with them —
     without telling either supplier. Two owners have to agree to that; it is
     not a side effect of a click.

     The copy here is borrowed and the fix is a follow-up: `invite.revoked_body`
     is the only string in the catalogue that says the true and useful thing —
     go back and ask the supplier — and the heading is the nearest existing one.
     The pair this state deserves is listed with the handoff.
  */
  if (holder.businessId && holder.businessId !== invite.businessId) {
    return (
      <InviteFrame>
        <InviteCard
          title={t("invite.wrong_account_title")}
          body={t("invite.revoked_body", { business: invite.businessName })}
        />
      </InviteFrame>
    );
  }

  return (
    <InviteFrame>
      <InviteCard
        title={t("invite.title", { business: invite.businessName })}
        body={t("invite.intro", { inviter: invite.inviterName, contact: invite.contact })}
      >
        <form action={acceptInviteAction}>
          <input type="hidden" name="token" value={token} />
          {roles ? (
            <p className="mb-4 max-w-prose text-body-sm text-body">
              {t("invite.roles", { roles })}
            </p>
          ) : null}
          <Button type="submit" block>
            {t("invite.email_cta")}
          </Button>
        </form>
      </InviteCard>
    </InviteFrame>
  );
}

/**
 * The frame, local because there is no layout at `app/invite` and this route
 * sits outside every group that has one. Matches `(auth)`'s deliberately: one
 * way back, nothing else to click.
 */
function InviteFrame({ children }: { children: React.ReactNode }) {
  return (
    <div data-density="roomy" className="flex min-h-dvh flex-col bg-paper">
      <header className="px-6 py-5">
        <Link
          href="/"
          className="rounded-tag font-serif text-h2 text-ink focus-visible:shadow-focus focus-visible:outline-none"
        >
          Business Listings
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-6 pb-16">
        <div className="w-full max-w-[26rem]">{children}</div>
      </main>
    </div>
  );
}

/** One heading, one sentence, and at most one thing to do about it. */
function InviteCard({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <Card padded as="article">
      <h1 className="text-h2 text-ink">{title}</h1>
      <p className="mt-1.5 max-w-prose text-body-sm text-muted">{body}</p>
      {children ? <div className="mt-5">{children}</div> : null}
    </Card>
  );
}
