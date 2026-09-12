import { notFound } from "next/navigation";
import Link from "next/link";
import { StatusBadge } from "@/components/display";
import { can } from "@/lib/auth/can";
import { t } from "@/lib/i18n";
import { serviceForEditor } from "@/lib/services/service";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../_shell";
import { saveServiceField, setStatus } from "./actions";
import { ServiceForm } from "./ServiceForm";

/**
 * Board `3g-s` — one service, and the unit of the entire track.
 *
 * The product editor asks for a SKU, a price, a stock level and a spec table;
 * none of the four exists for an engagement. What a buyer needs before
 * enquiring is what this covers, what it does not, how it is charged, how fast,
 * and what they end up holding — which is the scope sheet, twelve fields with
 * six required, and this screen writes it.
 *
 * Everything downstream reads this one record: the list on `3f-s`, the public
 * table on `1g-s`, the completeness score, and `12c`'s ranking model once its
 * spec-completeness term is replaced with one a services business can earn.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seat = await requireSellerSeat();
  const service = await serviceForEditor(seat.businessId, id);
  return { title: service?.name ?? t("service_editor.not_found") };
}

export default async function ServiceEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const seat = await requireSellerSeat();

  // Gated on the route as well as at the write. Board 3g's scar: without this a
  // sales seat opened the editor, filled it in, and met the guard on submit.
  if (!can(seat.actor, "product.edit")) notFound();

  const [service, badges] = await Promise.all([
    serviceForEditor(seat.businessId, id),
    getNavBadges(seat.businessId),
  ]);
  if (!service) notFound();

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/services"
      breadcrumb={
        <Link
          href="/dashboard/services"
          className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("service_editor.back")}
        </Link>
      }
      title={service.name}
      eyebrow={service.family.name}
      actions={
        <div className="flex items-center gap-2">
          <StatusBadge tone={service.status === "live" ? "ok" : "neutral"}>
            {service.status === "live" ? t("services.status.live") : t("services.status.draft")}
          </StatusBadge>
          {service.status === "live" && (
            <Link
              href={`/b/${seat.businessSlug}/s/${service.slug}`}
              className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("service_editor.view_public")}
            </Link>
          )}
        </div>
      }
    >
      <ServiceForm
        state={service}
        publicHref={`/b/${seat.businessSlug}/s/${service.slug}`}
        actions={{ save: saveServiceField, setStatus }}
      />
    </SellerPage>
  );
}
