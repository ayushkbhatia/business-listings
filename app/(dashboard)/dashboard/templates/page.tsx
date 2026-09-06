import { prisma } from "@/lib/db/client";
import { getSellerTemplate } from "@/lib/catalogue/template";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { saveTemplate, setUpTemplate } from "../products/actions";
import { TemplateForm, type TemplateFieldRow } from "./TemplateForm";
import { resolveDefaultTemplateId } from "@/lib/db/queries/catalogue";

/**
 * Board 3h — the seller's clone of the category spec template.
 *
 * One template, for the business's primary category. A seller selling across
 * two categories has two templates and picks between them from the product
 * editor; offering a chooser here before that exists would be a control with
 * one option in it.
 */
export const metadata = { title: "Your spec template" };
export const dynamic = "force-dynamic";

export default async function TemplatePage() {
  const seat = await requireSellerSeat();

  const [business, badges] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: { primaryCategory: { select: { id: true, name: true } } },
    }),
    getNavBadges(seat.businessId),
  ]);

  // Their own category's template, or their trade's. A supplier filed under
  // "Gate valves" still answers to the valve template.
  const platformTemplateId = await resolveDefaultTemplateId(business.primaryCategory.id);

  const page = (children: React.ReactNode) => (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/products"
      eyebrow={t("template.eyebrow")}
      title={t("template.title")}
    >
      {children}
    </SellerPage>
  );

  if (!platformTemplateId) {
    return page(<p className="max-w-prose text-body-sm text-muted">{t("template.none")}</p>);
  }

  const clone = await prisma.sellerTemplate.findFirst({
    where: { businessId: seat.businessId, platformTemplateId },
    select: { id: true },
  });

  if (!clone) {
    return page(
      <form action={setUpTemplateForm}>
        <input type="hidden" name="platformTemplateId" value={platformTemplateId} />
        <p className="mb-3 max-w-prose text-body-sm text-muted">
          {t("template.intro", { category: business.primaryCategory.name })}
        </p>
        <button
          type="submit"
          className="inline-flex items-center rounded-ctl border border-moss bg-moss px-3.5 py-1.5 text-body-sm font-medium text-on-ink hover:bg-moss-hover focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("template.clone")}
        </button>
      </form>,
    );
  }

  const view = await getSellerTemplate(seat.businessId, clone.id);
  if (!view) return page(<p className="text-body-sm text-muted">{t("template.none")}</p>);

  /*
   * How many products have a value for each field, so the warning can say what
   * is actually at stake rather than "your products". Counted once over the
   * catalogue rather than once per field.
   */
  const products = await prisma.product.findMany({
    where: { businessId: seat.businessId },
    select: { specValues: true },
  });

  const counts = new Map<string, number>();
  for (const product of products) {
    for (const [fieldId, value] of Object.entries(
      (product.specValues ?? {}) as Record<string, unknown>,
    )) {
      if (value === null || value === undefined || value === "") continue;
      counts.set(fieldId, (counts.get(fieldId) ?? 0) + 1);
    }
  }

  const fields: TemplateFieldRow[] = view.fields.map((field) => ({
    platformFieldId: field.platformFieldId,
    platformLabel: field.platformLabel,
    label: field.label,
    isFilterable: field.isFilterable,
    productCount: counts.get(field.platformFieldId) ?? 0,
  }));

  return page(
    <div className="flex flex-col gap-4">
      <p className="max-w-prose text-body-sm text-muted">
        {t("template.intro", { category: business.primaryCategory.name })}
      </p>
      <TemplateForm sellerTemplateId={view.id} fields={fields} action={saveTemplate} />
    </div>,
  );
}

/** React needs a form action that returns nothing. */
async function setUpTemplateForm(formData: FormData): Promise<void> {
  "use server";
  await setUpTemplate(formData);
}
