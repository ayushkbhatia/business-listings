import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { scopeWords } from "@/components/domain";
import { templateDetailFor, scopeTemplatesFor } from "@/lib/services/scope-template-service";
import { CLONE_FILLS, TRAVELLING_FIELDS } from "@/lib/services/scope-template";
import { DELIVERED_WHERE, ENGAGEMENT_TYPES, REQUIRED_COUNT } from "@/lib/services/scope-sheet";
import { familyFor } from "@/lib/services/service";
import { prisma } from "@/lib/db/client";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../_shell";
import { TemplateWorkspace, type ServiceOffersView } from "../TemplateWorkspace";
import { NewTemplate } from "../NewTemplate";
import {
  acceptOfferAction,
  cloneAction,
  createTemplateAction,
  declineOfferAction,
  deleteTemplateAction,
  saveTemplateAction,
} from "../actions";

/**
 * Board `3h-s` — one template.
 *
 * Five fields travel and four never do. The four are the point: *two
 * inspections of the same class still differ in what they cover, and a
 * pre-filled exclusions line is the one that ends up in a dispute.* Two of them
 * — the service name and the turnaround — are this board's correction to
 * `3g-s` B6's looser wording, and turnaround is the interesting one: templating
 * it would make a clone arrive complete at 6 of 6, and produce four services
 * claiming the same turnaround.
 *
 * A clone therefore arrives at `CLONE_FILLS` of six, which is exactly `8c-s`'s
 * counting bar — so it counts toward the seller's three the moment it is named.
 * That relationship is asserted in `scope-template.test.ts` rather than
 * described, because it is what makes the template worth having.
 */
export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const seat = await requireSellerSeat();
  const template = await templateDetailFor(seat.businessId, slug);
  return { title: template ? template.name : t("scope_template.meta_title") };
}

export default async function ScopeTemplatePage({ params }: Params) {
  const { slug } = await params;
  const seat = await requireSellerSeat();
  if (!can(seat.actor, "product.edit")) notFound();

  const template = await templateDetailFor(seat.businessId, slug);
  if (!template) notFound();

  const [others, family, badges] = await Promise.all([
    scopeTemplatesFor(seat.businessId),
    /*
       The family's own fee bases — `3g-s` B2, and the reason it is the
       *template's* family rather than the business's chosen sheet: a firm can
       hold a marine template and an advisory one, and each offers the bases its
       own family defines. A global list was what B2 exists to prevent.
    */
    familyFor(
      (
        await prisma.business.findUniqueOrThrow({
          where: { id: seat.businessId },
          select: { primaryCategoryId: true },
        })
      ).primaryCategoryId,
      template.familyId,
    ),
    getNavBadges(seat.businessId),
  ]);

  const feeBases = family.feeBases.map((basis) => ({ value: basis.key, label: basis.label }));
  const words = (field: string, value: string | null): string | null => {
    if (value === null) return null;
    if (field === "engagementType") return scopeWords("engagement_type", value);
    if (field === "deliveredWhere") return scopeWords("delivered_where", value);
    if (field === "feeBasis") return feeBases.find((row) => row.value === value)?.label ?? value;
    return value;
  };

  const labels: Record<string, string | null> = {};
  for (const field of TRAVELLING_FIELDS) {
    labels[field] = words(field, template.values[field] ?? null);
  }

  const perService: ServiceOffersView[] = template.perService.map((row) => ({
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    live: row.live,
    offers: row.offers.map((offer) => ({
      field: offer.field,
      before: offer.before,
      after: offer.after,
      beforeLabel: words(offer.field, offer.before),
      afterLabel: words(offer.field, offer.after) ?? offer.after,
    })),
  }));

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/services"
      eyebrow={t("scope_template.eyebrow")}
      title={template.name}
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-eyebrow uppercase text-muted">
              {t("scope_template.from_family", { family: template.familyName })}
            </span>
            {/*
               A live count from `Service.scopeTemplateId`, and the services are
               named beside it — B6. "Used by 3" tells a seller nothing about
               which three would change if they edited this.
            */}
            <span className="text-caption text-muted">
              {template.usedBy === 0
                ? t("scope_template.used_by_none")
                : t("scope_template.used_by", {
                    count: template.usedBy,
                    formatted: formatCount(template.usedBy),
                  })}
            </span>
          </div>

          {template.services.length > 0 && (
            <p className="text-caption text-muted">
              {template.services.map((service) => service.name).join(" · ")}
            </p>
          )}

          <TemplateWorkspace
            id={template.id}
            name={template.name}
            values={template.values as Record<string, string>}
            labels={labels}
            usedBy={template.usedBy}
            perService={perService}
            feeBases={feeBases}
            engagementTypes={ENGAGEMENT_TYPES.map((value) => ({
              value,
              label: scopeWords("engagement_type", value),
            }))}
            deliveredWhere={DELIVERED_WHERE.map((value) => ({
              value,
              label: scopeWords("delivered_where", value),
            }))}
            cloneFills={CLONE_FILLS}
            cloneTotal={REQUIRED_COUNT}
            save={saveTemplateAction}
            remove={deleteTemplateAction}
            clone={cloneAction}
            accept={acceptOfferAction}
            decline={declineOfferAction}
          />
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-3.5 lg:w-[320px]">
          <div className="rounded-card border border-line bg-card px-5 py-4">
            <p className="font-mono text-eyebrow uppercase text-muted">
              {t("scope_template.other")}
            </p>
            <ul className="mt-3 flex list-none flex-col gap-2.5">
              {others
                .filter((row) => row.id !== template.id)
                .map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/dashboard/scope-templates/${row.slug}`}
                      className="text-body-sm text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      {row.name}
                    </Link>
                    <p className="mt-0.5 font-mono text-eyebrow uppercase tabular-nums text-faint">
                      {t("scope_template.from_family", { family: row.familyName })} ·{" "}
                      {row.usedBy === 0
                        ? t("scope_template.used_by_none")
                        : t("scope_template.used_by", {
                            count: row.usedBy,
                            formatted: formatCount(row.usedBy),
                          })}
                    </p>
                  </li>
                ))}
            </ul>

            {others.length === 1 && (
              <p className="mt-3 text-caption text-muted">{t("scope_template.none_body")}</p>
            )}
          </div>

          <div className="rounded-card border border-line bg-paper-sunk px-5 py-4">
            <p className="font-mono text-eyebrow uppercase text-muted">
              {t("scope_template.new")}
            </p>
            <div className="mt-3">
              <NewTemplate families={template.families} create={createTemplateAction} />
            </div>
          </div>
        </aside>
      </div>
    </SellerPage>
  );
}
