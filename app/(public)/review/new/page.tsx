import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Panel, PublicShell } from "@/components/structure";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { prisma } from "@/lib/db/client";
import { canReview, EDITABLE_DAYS } from "@/lib/reviews/eligibility";
import { enquiryForReview } from "@/lib/reviews/service";
import { t } from "@/lib/i18n";
import { resolveBuyerId, trackingTokenFor } from "@/app/(public)/enquiry/_buyer";
import { ReviewForm } from "./ReviewForm";

/**
 * Board 10f — writing a review.
 *
 * Reached from the accepted-quote page and from a seller's request. Gated on
 * the server, not by whoever linked here: `canReview` is re-checked against the
 * database and the form is not rendered at all when it says no. A page that
 * shows a form it will refuse to accept is a page that wastes somebody's
 * evening.
 */
export const metadata = { title: t("review.meta_title") };
export const dynamic = "force-dynamic";

export default async function WriteReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);

  const enquiryId = one("enq");
  if (!enquiryId) notFound();

  const buyerId = await resolveBuyerId(one("t"));
  if (!buyerId) notFound();

  /*
     Two reads of one enquiry: the gate's view, and the reference the page
     prints. `enquiryForReview` is the same function the service re-checks with,
     so the form is never offered on a rule the write would then refuse.
  */
  const [gate, enquiry] = await Promise.all([
    enquiryForReview(enquiryId),
    prisma.enquiry.findUnique({
      where: { id: enquiryId },
      select: { ref: true, review: { select: { businessId: true } } },
    }),
  ]);

  const verdict = canReview(buyerId, gate, one("about"));

  /*
   * From the enquiry, not from the verdict. Once a review is posted the verdict
   * is `already_reviewed`, and looking the supplier up only on success meant the
   * confirmation screen fell through to the gated one — the buyer wrote a
   * review and was told they were not allowed to.
   */
  const subjectId = verdict.ok
    ? verdict.businessId
    : (enquiry?.review?.businessId ?? gate?.contactReleasedToBusinessId ?? null);

  const supplier = subjectId
    ? await prisma.business.findUnique({
        where: { id: subjectId },
        select: { displayName: true, slug: true },
      })
    : null;

  const token = await trackingTokenFor(buyerId);
  const backHref = token ? `/enquiry/${enquiryId}?t=${token}` : `/enquiry/${enquiryId}`;

  return (
    <PublicShell nav={<DirectoryNav />} footer={<DirectoryFooter />}>
      <div className="mx-auto w-full max-w-[42rem] px-[var(--section-pad)] py-8">
        <p className="font-mono text-eyebrow uppercase text-faint">
          {t("enquiry.ref", { ref: enquiry?.ref ?? "" })}
        </p>

        {one("posted") && supplier ? (
          <>
            <h1 className="mt-2 font-serif text-h1-serif text-ink">{t("review.posted_title")}</h1>
            <div className="mt-4">
              <Card padded>
                <p className="max-w-[var(--measure-prose)] text-body-sm text-prose">
                  {t("review.posted_body", {
                    supplier: supplier.displayName,
                    days: EDITABLE_DAYS,
                  })}
                </p>
              </Card>
            </div>
          </>
        ) : !verdict.ok ? (
          <>
            <h1 className="mt-2 font-serif text-h1-serif text-ink">{t("review.title")}</h1>
            <div className="mt-4">
              <Card padded>
                <p className="max-w-[var(--measure-prose)] text-body-sm text-prose">
                  {t(`review.error.${verdict.reason}` as "review.error.no_confirmed_enquiry")}
                </p>
                {/* The gate said out loud, because it is the product. */}
                <p className="mt-2 max-w-[var(--measure-prose)] text-caption text-muted">
                  {t("review.gated")}
                </p>
              </Card>
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-2 font-serif text-h1-serif text-ink">{t("review.title")}</h1>
            <p className="mt-2 max-w-[var(--measure-prose)] text-prose text-prose">
              {t("review.lede", {
                supplier: supplier?.displayName ?? "",
                ref: enquiry?.ref ?? "",
              })}
            </p>
            <div className="mt-6">
              <Panel title={t("review.title")}>
                <ReviewForm
                enquiryId={enquiryId}
                businessId={verdict.ok ? verdict.businessId : undefined}
                token={token}
                editableDays={EDITABLE_DAYS}
              />
              </Panel>
            </div>
          </>
        )}

        <p className="mt-4">
          <Link
            href={backHref}
            className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("review.back_to_enquiry")}
          </Link>
        </p>
      </div>
    </PublicShell>
  );
}
