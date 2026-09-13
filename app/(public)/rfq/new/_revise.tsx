import { notFound } from "next/navigation";
import { PublicShell } from "@/components/structure";
import { prisma } from "@/lib/db/client";
import { t } from "@/lib/i18n";
import { DirectoryNav } from "@/app/(public)/_chrome";
import { resolveBuyerId, trackingTokenFor } from "@/app/(public)/enquiry/_buyer";
import { ReviseForm } from "../ReviseForm";

/**
 * `/rfq/new?revise=ENQ-…` — adding detail to a sent enquiry.
 *
 * The tracking page has linked here since board 1i and nothing answered it: the
 * link opened a blank composer, and `reviseRequirement` — the service that
 * keeps a seller's quote from changing underneath them — had no caller. For a
 * brief it is also what makes *you can add detail after you send* true.
 *
 * Access is the tracking page's: the buyer's session or their claim token, and
 * a 404 for anybody else, so a reference cannot be walked from here either.
 */
export async function RevisePage({ refOrId, token }: { refOrId: string; token: string | null }) {
  const buyerId = await resolveBuyerId(token);
  if (!buyerId) notFound();

  const enquiry = await prisma.enquiry.findFirst({
    where: { OR: [{ ref: refOrId }, { id: refOrId }], buyerId },
    select: {
      id: true,
      ref: true,
      requirement: true,
      scale: true,
      closesAt: true,
      contactReleasedToBusinessId: true,
      serviceBrief: { select: { enquiryId: true } },
    },
  });
  if (!enquiry) notFound();

  const link = await trackingTokenFor(buyerId);
  const backHref = `/enquiry/${enquiry.id}${link ? `?t=${link}` : ""}`;
  const closed = enquiry.contactReleasedToBusinessId !== null || enquiry.closesAt.getTime() <= new Date().getTime();

  return (
    <PublicShell nav={<DirectoryNav />}>
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <p className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">{enquiry.ref}</p>
        <h1 className="mt-2 font-serif text-h1-serif text-ink">{t("revise.h1", { ref: enquiry.ref })}</h1>
        {closed ? (
          <p className="mt-4 rounded-ctl border border-warn-line bg-warn-wash px-3.5 py-2.5 text-body-sm text-warn-ink">
            {t("revise.closed")}{" "}
            <a href={backHref} className="font-medium underline underline-offset-2">
              {t("revise.cancel")}
            </a>
          </p>
        ) : (
          <>
            <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-body">{t("revise.sub")}</p>
            <p className="mt-1 max-w-[var(--measure-prose)] text-caption text-muted">{t("revise.fixed")}</p>
            <div className="mt-6 rounded-card border border-line bg-card p-5">
              <ReviseForm
                refOrId={enquiry.id}
                token={link}
                initialRequirement={enquiry.requirement}
                initialScale={enquiry.scale}
                isBrief={enquiry.serviceBrief !== null}
                backHref={backHref}
              />
            </div>
          </>
        )}
      </div>
    </PublicShell>
  );
}
