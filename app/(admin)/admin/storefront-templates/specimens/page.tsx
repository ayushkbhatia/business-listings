import { notFound } from "next/navigation";
import { renderSection } from "@/components/storefront";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { SECTION_TYPES } from "@/lib/storefront/section-types";
import { SPECIMEN_CONTENT, SPECIMEN_DATA } from "@/lib/storefront/specimen-data";
import type { ResolvedSection } from "@/lib/storefront/sections";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";

/**
 * Boards 5g and 5h — the section specimens.
 *
 * Criterion 10, and the acceptance surface for the whole of step 6. This is to
 * sections what `/dev/gallery` is to components: every type rendered at real
 * scale, in sequence, each labelled with its number, what it pulls from and
 * what the seller fills.
 *
 * The board is explicit that this is not decoration — it is the reference a
 * reviewer uses to answer *"what does enabling this actually give the seller"*,
 * and that question cannot be answered from a wireframe.
 *
 * Rendered against `SPECIMEN_DATA`, which is written by hand. A specimens page
 * that read a real listing would change under a reviewer when somebody edited
 * that listing, and would show one seller's catalogue to every member of staff.
 *
 * The storefront theme wraps the whole run, because that is how these render in
 * life — and because a reviewer needs to see that the verification badge in the
 * trust strip does *not* take the theme colour while everything around it does.
 */

export const dynamic = "force-dynamic";

/** A section row that exists only for this page. Not in any template. */
function specimen(typeKey: string, index: number): ResolvedSection | null {
  const definition = SECTION_TYPES.find((type) => type.key === typeKey);
  if (!definition) return null;
  return {
    id: `specimen-${typeKey}`,
    type: typeKey,
    sortOrder: index,
    enabled: true,
    fixed: definition.fixed,
    singleton: definition.singleton,
    sellerEditableFields: definition.sellerFields.map((field) => field.key),
    showOnMobile: true,
    settings: {},
    definition,
  };
}

export default async function SpecimensPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "storefront.template.write")) notFound();

  const badges = await getAdminNavBadges(seat);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/storefront-templates"
      title={t("admin.specimens.title")}
      eyebrow={t("admin.specimens.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.specimens.meta", { count: formatCount(SECTION_TYPES.length) })}
        </span>
      }
    >
      <p className="max-w-prose text-caption text-muted">{t("admin.specimens.note")}</p>

      <ol className="mt-[var(--gutter)] flex flex-col gap-10">
        {SECTION_TYPES.map((type, index) => {
          const section = specimen(type.key, index);
          if (!section) return null;

          const fields = type.sellerFields.map((field) => t(field.labelKey as never));

          return (
            <li key={type.key}>
              {/*
                The label is the point of the page. Number, name, source, and
                what the seller fills — the four things the board asks each
                specimen to state.
              */}
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line pb-2">
                <span className="font-mono text-eyebrow uppercase text-faint">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h2 className="text-body-sm font-medium text-ink">{t(type.labelKey as never)}</h2>
                <span className="font-mono text-eyebrow uppercase text-muted">
                  {type.singleton ? t("section.singleton") : t("section.repeatable")}
                </span>
                <span className="text-caption text-muted">
                  {t("section.pulls_from")}: {t(type.sourceKey as never)}
                </span>
                <span className="text-caption text-muted">
                  {t("section.seller_fills")}:{" "}
                  {fields.length === 0 ? t("section.no_seller_fields") : fields.join(", ")}
                </span>
              </div>

              {/*
                The theme goes on the specimen, not on the console. `data-theme`
                belongs on a storefront root only — the inventory's naming rule
                — and the console must not take a seller theme.
              */}
              <div data-theme="industrial" className="mt-4">
                {renderSection({
                  section,
                  data: SPECIMEN_DATA,
                  content: SPECIMEN_CONTENT[type.key] ?? {},
                  enquireHref: `/rfq/new?to=${SPECIMEN_DATA.business.slug}`,
                })}
              </div>
            </li>
          );
        })}
      </ol>
    </AdminPage>
  );
}
