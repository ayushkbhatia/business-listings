import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, Input } from "@/components/primitives";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { leadsForStaff, pageFrom } from "@/lib/contact/leads";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { ContactLeadTable, LeadPager } from "@/app/(dashboard)/dashboard/leads/phone/_table";
import { AdminPage, getAdminNavBadges } from "../../_shell";

/**
 * Board `1d` amendment — every phone lead, for the site owner.
 *
 * The owner's ask, 15 Sep: a reveal of a supplier's landline registers as a
 * lead in the superadmin's console as well as the seller's. The same rows the
 * seller reads on `/dashboard/leads/phone`, across every listing, with the
 * supplier named and a filter by display name or slug.
 *
 * Gated on `contact_lead.platform.read` — the ops lead alone. Each row is a buyer's
 * name, work email and mobile; a moderator's work is what was published, not
 * who asked for a number.
 *
 * Read-only. Nothing here sends, exports or edits a lead.
 */

export const metadata = { title: t("admin.leads.title") };
export const dynamic = "force-dynamic";

export default async function AdminLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "contact_lead.platform.read")) notFound();

  const params = await searchParams;
  const supplier = typeof params["supplier"] === "string" ? params["supplier"].trim().slice(0, 120) : "";
  const now = new Date();

  const [page, badges] = await Promise.all([
    leadsForStaff({ supplier: supplier || null, page: pageFrom(params["page"]) }, now),
    getAdminNavBadges(seat),
  ]);

  const hrefFor = (n: number) => {
    const query = new URLSearchParams();
    if (supplier) query.set("supplier", supplier);
    if (n > 1) query.set("page", String(n));
    const search = query.toString();
    return `/admin/leads${search ? `?${search}` : ""}`;
  };

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/leads"
      title={t("admin.leads.title")}
      eyebrow={t("admin.leads.eyebrow")}
      meta={
        <span className="text-caption tabular-nums text-muted">
          {t("admin.leads.meta", {
            count: page.total,
            formatted: formatCount(page.total),
            recent: formatCount(page.recent),
          })}
        </span>
      }
    >
      <form
        method="get"
        action="/admin/leads"
        role="search"
        aria-label={t("admin.leads.filter_label")}
        className="mb-[var(--gutter)] flex flex-wrap items-end gap-3 rounded-card border border-line bg-card p-3"
      >
        <label className="flex min-w-56 flex-1 flex-col gap-1">
          <span className="text-caption font-medium text-body">{t("admin.leads.filter.supplier")}</span>
          <Input name="supplier" defaultValue={supplier} spellCheck={false} autoComplete="off" />
        </label>
        <Button type="submit" variant="secondary">
          {t("admin.leads.filter.apply")}
        </Button>
        {supplier && (
          <Link href="/admin/leads" className="px-2 py-2 text-body-sm font-medium text-brand-ink hover:underline">
            {t("admin.leads.filter.clear")}
          </Link>
        )}
      </form>

      {page.total === 0 ? (
        <p className="rounded-card border border-line bg-card px-4 py-6 text-body-sm text-muted">
          {supplier ? t("admin.leads.empty_filtered", { supplier }) : t("admin.leads.empty")}
        </p>
      ) : (
        <>
          <ContactLeadTable page={page} audience="staff" caption={t("admin.leads.caption")} />
          <LeadPager page={page} hrefFor={hrefFor} />
        </>
      )}

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">{t("admin.leads.note")}</p>
    </AdminPage>
  );
}
