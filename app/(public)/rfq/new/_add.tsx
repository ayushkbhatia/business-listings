import { notFound } from "next/navigation";
import { PublicShell } from "@/components/structure";
import { formatCount, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { isVerified } from "@/lib/verification";
import { additionalSuppliersFor } from "@/lib/enquiry/add-recipients";
import { DirectoryNav } from "@/app/(public)/_chrome";
import { resolveBuyerId, trackingTokenFor } from "@/app/(public)/enquiry/_buyer";
import { AddSuppliersForm } from "../AddSuppliersForm";

/**
 * `/rfq/new?from=ENQ-…` — the tracking page's *Add two more suppliers*.
 *
 * A confirmation, not a composer: the requirement is already written, so the
 * page names who it would go to, lets the buyer untick any of them, and sends.
 * A GET never writes — a crawler or a link preview following the tracking
 * page's link must not deliver an enquiry to two more businesses.
 *
 * Access is the tracking page's: the buyer's session or their claim token, and
 * a 404 for anybody else.
 */
export async function AddSuppliersPage({ refOrId, token }: { refOrId: string; token: string | null }) {
  const buyerId = await resolveBuyerId(token);
  if (!buyerId) notFound();

  const state = await additionalSuppliersFor(buyerId, refOrId);
  if (!state.ok && state.reason === "not_found") notFound();

  const link = await trackingTokenFor(buyerId);
  const backHref = state.ok
    ? `/enquiry/${state.enquiryId}${link ? `?t=${link}` : ""}`
    : `/enquiry/${refOrId}${link ? `?t=${link}` : ""}`;

  return (
    <PublicShell nav={<DirectoryNav />}>
      <div className="mx-auto w-full max-w-3xl px-5 py-10">
        <p className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">{state.ok ? state.ref : refOrId}</p>
        <h1 className="mt-2 font-serif text-h1-serif text-ink">
          {t("add.h1", { ref: state.ok ? state.ref : refOrId })}
        </h1>

        {!state.ok ? (
          <p className="mt-4 rounded-ctl border border-warn-line bg-warn-wash px-3.5 py-2.5 text-body-sm text-warn-ink">
            {t(`add.${state.reason}` as "add.closed")}{" "}
            <a href={backHref} className="font-medium underline underline-offset-2">
              {t("add.back")}
            </a>
          </p>
        ) : state.suppliers.length === 0 ? (
          <p className="mt-4 rounded-ctl border border-line bg-paper-sunk px-3.5 py-2.5 text-body-sm text-body">
            {t("add.none", { count: state.sent, formatted: formatCount(state.sent) })}{" "}
            <a href={backHref} className="font-medium text-moss underline underline-offset-2">
              {t("add.back")}
            </a>
          </p>
        ) : (
          <>
            <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-body">{t("add.sub")}</p>
            <p className="mt-1 max-w-[var(--measure-prose)] text-caption text-muted">{t("add.matched_on")}</p>
            {state.suppliers.length < state.wanted && (
              <p className="mt-3 text-body-sm text-body">
                {t("add.fewer", { count: state.suppliers.length, formatted: formatCount(state.suppliers.length) })}
              </p>
            )}
            <div className="mt-6">
              <AddSuppliersForm
                refOrId={state.enquiryId}
                token={link}
                backHref={backHref}
                suppliers={state.suppliers.map((supplier) => ({
                  businessId: supplier.businessId,
                  displayName: supplier.displayName,
                  // Worded here, measured never claimed, the same line the composer's rows carry.
                  meta: [
                    isVerified(supplier.verificationTier) ? t("add.verified") : null,
                    supplier.responseTimeMedianMs === null
                      ? t("response.unmeasured")
                      : t("response.median", { duration: formatDuration(supplier.responseTimeMedianMs) }),
                  ]
                    .filter(Boolean)
                    .join(" · "),
                }))}
              />
            </div>
          </>
        )}
      </div>
    </PublicShell>
  );
}
