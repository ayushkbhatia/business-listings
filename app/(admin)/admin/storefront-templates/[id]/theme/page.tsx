import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClassName } from "@/components/primitives";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { storeCount, templateWithSections } from "@/lib/storefront/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../../_shell";
import { saveTheme } from "./actions";
import { ThemeForm } from "./ThemeForm";

/**
 * Board 5b — the theme a sector's storefronts wear.
 *
 * A page of its own rather than a fourth pane in the builder. The builder's
 * three panes are about one section at a time; this is about every storefront
 * in the trade at once, and the two decisions do not belong on one screen.
 */

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export default async function ThemePage({ params }: Params) {
  const seat = await requireStaff();
  if (!can(seat.actor, "storefront.template.write")) notFound();

  const { id } = await params;
  const template = await templateWithSections(id);
  if (!template) notFound();

  const [stores, badges] = await Promise.all([
    storeCount(template.sectorId),
    getAdminNavBadges(seat),
  ]);
  const count = formatCount(stores);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/storefront-templates"
      title={`${template.name} — ${t("theme.title")}`}
      eyebrow={t("theme.eyebrow")}
      meta={<span className="text-caption text-muted">{t("theme.meta", { count })}</span>}
      actions={
        <Link
          className={buttonClassName({ variant: "secondary" })}
          href={`/admin/storefront-templates/${template.id}`}
        >
          {t("theme.back_to_builder")}
        </Link>
      }
    >
      <ThemeForm
        templateId={template.id}
        storeCount={count}
        initial={{
          offeredThemes: template.offeredThemes,
          defaultTheme: template.defaultTheme,
          allowCustomHex: template.allowCustomHex,
          typePairing: template.typePairing,
          density: template.density,
          cornerRadius: template.cornerRadius,
          darkHeader: template.darkHeader,
          badgeRemovable: template.badgeRemovable,
        }}
        save={saveTheme}
      />
    </AdminPage>
  );
}
