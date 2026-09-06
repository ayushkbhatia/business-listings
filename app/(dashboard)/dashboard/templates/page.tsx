import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import { cloneTemplate, templatesFor } from "@/lib/catalogue/template";
import { resolveDefaultTemplateId } from "@/lib/db/queries/catalogue";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";

/**
 * Board 3h — the index.
 *
 * A seller with templates lands on their first one; the route that matters is
 * `/dashboard/templates/:slug`. A seller with none is offered the clone their
 * primary category points at, which is the state board 8c leaves them in when
 * they skipped choosing a sheet during setup.
 */
export const metadata = { title: t("template.title") };
export const dynamic = "force-dynamic";

export default async function TemplatesIndexPage() {
  const seat = await requireSellerSeat();
  /*
     `product.edit` — owner and manager. The route had no capability at all, so
     a sales or finance seat that typed it got the full editor for a template
     that decides what every product in the catalogue is described by. Every
     dashboard sibling with a write control is gated; this one had no nav row to
     gate it with.
  */
  if (!can(seat.actor, "product.edit")) notFound();

  const templates = await templatesFor(seat.businessId);
  if (templates.length > 0) redirect(`/dashboard/templates/${templates[0]!.slug}`);

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: seat.businessId },
    select: { primaryCategory: { select: { id: true, name: true } } },
  });
  const platformTemplateId = await resolveDefaultTemplateId(business.primaryCategory.id);

  const badges = await getNavBadges(seat.businessId);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/templates"
      eyebrow={t("template.eyebrow")}
      title={t("template.title")}
    >
      {platformTemplateId ? (
        <form action={setUp} className="flex flex-col items-start gap-3">
          <input type="hidden" name="platformTemplateId" value={platformTemplateId} />
          <p className="max-w-prose text-body-sm text-muted">{t("template.intro")}</p>
          <button
            type="submit"
            className="inline-flex items-center rounded-ctl border border-moss bg-moss px-3.5 py-1.5 text-body-sm font-medium text-on-ink hover:bg-moss-hover focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("template.clone")}
          </button>
        </form>
      ) : (
        <p className="max-w-prose text-body-sm text-muted">{t("template.none")}</p>
      )}
    </SellerPage>
  );
}

/** React needs a form action that returns nothing. */
async function setUp(formData: FormData): Promise<void> {
  "use server";
  const seat = await requireSellerSeat();
  const view = await cloneTemplate(
    seat.actor,
    seat.businessId,
    String(formData.get("platformTemplateId") ?? ""),
  );
  redirect(`/dashboard/templates/${view.slug}`);
}
