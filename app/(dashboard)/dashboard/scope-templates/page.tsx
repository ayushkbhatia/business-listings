import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import { scopeTemplatesFor } from "@/lib/services/scope-template-service";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { NewTemplate } from "./NewTemplate";
import { createTemplateAction } from "./actions";

/**
 * Board `3h-s` — the index.
 *
 * A seller with templates lands on their first one; the route that matters is
 * `/dashboard/scope-templates/:slug`. That is `3h`'s shape and the one thing on
 * this board genuinely borrowed from it.
 *
 * ## The board is not the variant its handoff says it is
 *
 * The premise is that `3h` — the goods spec template — is the same interaction
 * with a different field list, so this would be "a field-list change and a copy
 * pass". **It is not.** `3h` is an *overlay*: one `SellerTemplate` per platform
 * template per business, storing only overrides, with draft → apply → revision
 * → rollback and a history route. There is no clone-into-many, no rename, no
 * delete, no per-product offer and no usage count in it.
 *
 * So this is a new build that borrows the vocabulary rather than the code —
 * and the one idea worth keeping is the one it does keep: a change is proposed
 * and reviewed before it lands, never written through.
 */
export const metadata = { title: t("scope_template.meta_title") };
export const dynamic = "force-dynamic";

export default async function ScopeTemplatesIndexPage() {
  const seat = await requireSellerSeat();
  /*
     `product.edit` — owner and manager, the same capability `3f-s`, `3g-s` and
     `8c-s` use. Gated here rather than only in the nav, because this route has
     no nav row to gate it with, which is the defect board 3h's own index was
     fixed for.
  */
  if (!can(seat.actor, "product.edit")) notFound();

  const templates = await scopeTemplatesFor(seat.businessId);
  if (templates.length > 0) redirect(`/dashboard/scope-templates/${templates[0]!.slug}`);

  const [families, badges] = await Promise.all([
    prisma.scopeSheetFamily.findMany({
      orderBy: [{ isDefault: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    getNavBadges(seat.businessId),
  ]);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/services"
      eyebrow={t("scope_template.eyebrow")}
      title={t("scope_template.title")}
    >
      <div className="flex max-w-prose flex-col gap-4">
        <p className="text-body-sm text-body">{t("scope_template.intro")}</p>

        {/*
           The empty state exists to stop a seller feeling behind. A parts
           supplier with sixty-one spec templates is solving a catalogue problem;
           a practice with two is finished — and the copy says so rather than
           leaving them to guess at the number.
        */}
        <div className="rounded-card border border-dashed border-line bg-paper-sunk px-5 py-4">
          <p className="text-body-sm font-medium text-ink">{t("scope_template.none_title")}</p>
          <p className="mt-2 text-caption text-body">{t("scope_template.none_body")}</p>
        </div>

        <NewTemplate families={families} create={createTemplateAction} />
      </div>
    </SellerPage>
  );
}
