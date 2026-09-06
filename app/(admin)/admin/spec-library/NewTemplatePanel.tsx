import { Panel } from "@/components/structure";
import { Button, Input, Label, Select, Textarea } from "@/components/primitives";
import { t } from "@/lib/i18n";
import { createTemplateAction } from "./actions";

/**
 * `+ New template`, and the only place a coverage gap gets closed.
 *
 * It lives on the coverage view rather than in the header, because a template
 * with no subcategory is not a thing this library can hold — the relation is
 * many-to-many but it is not optional, and coverage is where the subcategory
 * that needs one is already named. The board's `Create` link sat in a template
 * table's `VERSION` column instead.
 *
 * Only subcategories the taxonomy screen is *not* holding back are offered.
 */
export function NewTemplatePanel({
  subcategories,
}: {
  subcategories: readonly { id: string; name: string }[];
}) {
  return (
    <Panel title={t("admin.spec.new.title")}>
      {subcategories.length === 0 ? (
        <p className="text-body-sm text-body">{t("admin.spec.coverage.none")}</p>
      ) : (
        <form action={createTemplateAction} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-template-name">{t("admin.spec.new.name")}</Label>
            <Input id="new-template-name" name="name" required maxLength={80} />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="new-template-category">{t("admin.spec.new.subcategory")}</Label>
            <Select
              id="new-template-category"
              name="categoryId"
              required
              options={subcategories.map((category) => ({
                value: category.id,
                label: category.name,
              }))}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="new-template-reason">{t("admin.spec.reason")}</Label>
            <Textarea id="new-template-reason" name="reason" required rows={2} />
            <p className="text-caption text-muted">{t("admin.spec.reason_hint")}</p>
          </div>

          <Button type="submit">{t("admin.spec.new.create")}</Button>
        </form>
      )}
    </Panel>
  );
}
