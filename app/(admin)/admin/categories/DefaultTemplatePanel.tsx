import { Panel } from "@/components/structure";
import { Button, Label, Select, Textarea } from "@/components/primitives";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { setDefaultTemplate } from "./actions";

/**
 * Which template a subcategory offers a seller **first**.
 *
 * Board 4e criterion 6. The board's control was a single "Default spec
 * template" dropdown carrying the assumption `3h` Q3 says is wrong — that a
 * subcategory has one template. It has as many as the library gives it: Pipes &
 * fittings holds four, because grooved, threaded, flanged and press fittings
 * share almost no fields. This is the one a seller sees first, not the only one
 * they may take, and the copy says so.
 *
 * It also has to exist at all. `Category.defaultTemplateId` is how every
 * product-side reader resolves a template — `resolveTemplateId`, the CSV
 * mapper, the seller's clone, the required-field check — and until now nothing
 * on any screen could write it. The seeded pump catalogue shipped with it null,
 * so a pump seller's required fields were never enforced and nothing said why.
 */

export interface SubcategoryOption {
  id: string;
  label: string;
  /** Templates serving it, and which one is the default today. */
  templates: { id: string; name: string }[];
  defaultTemplateId: string | null;
}

export function DefaultTemplatePanel({
  subcategories,
}: {
  subcategories: readonly SubcategoryOption[];
}) {
  const withTemplates = subcategories.filter((row) => row.templates.length > 0);

  return (
    <Panel
      title={t("admin.taxonomy.default_template")}
      description={t("admin.taxonomy.default_template_help")}
    >
      {withTemplates.length === 0 ? (
        <p className="text-body-sm text-body">{t("admin.taxonomy.no_templates")}</p>
      ) : (
        <form action={setDefaultTemplate} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="default-template-category">
              {t("admin.taxonomy.default_template_subcategory")}
            </Label>
            <Select
              id="default-template-category"
              name="categoryId"
              required
              options={withTemplates.map((row) => ({
                value: row.id,
                label: t("admin.taxonomy.default_template_option", {
                  name: row.label,
                  count: row.templates.length,
                  n: formatCount(row.templates.length),
                }),
              }))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="default-template-id">
              {t("admin.taxonomy.default_template_first")}
            </Label>
            <Select
              id="default-template-id"
              name="templateId"
              required
              options={[
                ...new Map(
                  withTemplates
                    .flatMap((row) => row.templates)
                    .map((template) => [template.id, template]),
                ).values(),
              ].map((template) => ({ value: template.id, label: template.name }))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="default-template-reason">{t("admin.taxonomy.reason")}</Label>
            <Textarea id="default-template-reason" name="reason" required rows={2} />
          </div>

          <Button type="submit" variant="secondary">
            {t("admin.taxonomy.default_template_save")}
          </Button>
        </form>
      )}
    </Panel>
  );
}
