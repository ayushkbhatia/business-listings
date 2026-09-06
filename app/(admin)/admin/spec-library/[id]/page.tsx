import { notFound } from "next/navigation";
import Link from "next/link";
import { Panel } from "@/components/structure";
import { Button, Checkbox, Input, Label, Select, Textarea } from "@/components/primitives";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { templateDetail } from "@/lib/spec/library";
import { readDraft } from "@/lib/spec/changes";
import { reviewRequireField } from "@/lib/spec/versions";
import { prisma } from "@/lib/db/client";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { FieldTable, type FieldRow } from "./FieldTable";
import {
  discardDraftAction,
  publishDraftAction,
  setRequiredAction,
  stageFieldAction,
  stageRemovalAction,
} from "../actions";

/**
 * One library template — its fields, and the two actions.
 *
 * ## Why there are two forms and not one
 *
 * Board 4e's central correction. The board had `Publish with 60-day grace` over
 * a card claiming publishing would leave 88,410 products in violation of their
 * template. It cannot: `3h` §6 lands additive platform changes **not required**,
 * so no product violates anything, no save is blocked, and there is nothing for
 * a grace period to postpone — and a grace period implies a day 61 whose only
 * possible outcomes are the ones `3h` §5 and `6f`'s 301-not-404 exist to
 * prevent.
 *
 *   - **Publish a version** is additive. Its review names the clone count and
 *     the product count, and says in words that nothing is delisted and no
 *     save is blocked.
 *   - **Require a field** is separate, and only available on a field that
 *     already exists in the live version. Its review names the products it
 *     flags, the sellers holding them, and — separately — the clones that have
 *     detached the field and cannot be held to a mapping they no longer have.
 *
 * ## Removal is not a delete, and the review has to say so
 *
 * "Remove from the library" reads like one. Per `3h` §6 the field and its
 * values stay on every clone as a seller-owned field, carried across under the
 * same id so `Product.specValues` keeps resolving, and lose only their facet
 * status.
 */

export const dynamic = "force-dynamic";

const CHANGE_KEY = {
  field_added: "admin.spec.publish.change.field_added",
  field_removed: "admin.spec.publish.change.field_removed",
  relabelled: "admin.spec.publish.change.relabelled",
  reordered: "admin.spec.publish.change.reordered",
  facet_on: "admin.spec.publish.change.facet_on",
  facet_off: "admin.spec.publish.change.facet_off",
  varies_on: "admin.spec.publish.change.varies_on",
  varies_off: "admin.spec.publish.change.varies_off",
  options_changed: "admin.spec.publish.change.options_changed",
  unit_changed: "admin.spec.publish.change.unit_changed",
} as const;

export default async function TemplateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ require?: string }>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const { id } = await params;
  const [detail, badges] = await Promise.all([templateDetail(id), getAdminNavBadges(seat)]);
  if (!detail) notFound();

  const row = await prisma.specTemplate.findUnique({
    where: { id },
    select: { draftChanges: true },
  });
  const draft = readDraft(row?.draftChanges);

  const requireFieldId = (await searchParams).require;
  const review = requireFieldId ? await reviewRequireField(requireFieldId) : null;

  const rows: FieldRow[] = detail.fields.map((field) => ({
    id: field.id,
    key: field.key,
    label: field.label,
    unit: field.unit,
    type: field.type,
    required: field.required,
    isFilterable: field.isFilterable,
    variesByVariant: field.variesByVariant,
    detached: field.detached,
    missing: field.missing,
    removing: draft.removed.includes(field.id),
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/spec-library"
      title={detail.name}
      eyebrow={detail.code}
      breadcrumb={
        <Link href="/admin/spec-library" className="text-caption text-muted hover:underline">
          {t("admin.spec.detail.back")}
        </Link>
      }
      meta={
        <span className="text-caption text-muted">
          {t("admin.spec.detail.meta", {
            version: String(detail.version),
            fields: formatCount(detail.fields.length),
            subcategories: detail.subcategories.map((category) => category.name).join(" · "),
            clones: formatCount(detail.blast.clones),
          })}
        </span>
      }
    >
      <div className="flex flex-col gap-[var(--gutter)] xl:flex-row">
        <div className="min-w-0 flex-1 flex flex-col gap-[var(--gutter)]">
          <FieldTable rows={rows} prefix={detail.fieldPrefix} />

          {/* Requiring, and dropping a requirement. One field at a time,
              because the review names counts that belong to that field. */}
          <Panel title={review ? t("admin.spec.require.title", { label: review.label }) : t("admin.spec.require.pick")}>
            {review ? (
              <div className="flex flex-col gap-3">
                <p className="text-body-sm text-body">
                  {t("admin.spec.require.what", { count: review.affected, n: formatCount(review.affected) })}
                </p>
                <p className="text-caption text-muted">
                  {t("admin.spec.require.sellers", { count: review.sellers, n: formatCount(review.sellers) })}
                </p>
                {review.detached > 0 && (
                  <p className="text-caption text-muted">
                    {t("admin.spec.require.detached", { count: review.detached, n: formatCount(review.detached) })}
                  </p>
                )}
                <p className="text-caption text-muted">{t("admin.spec.require.floor")}</p>
                <form action={setRequiredAction} className="flex flex-col gap-2">
                  <input type="hidden" name="templateId" value={detail.id} />
                  <input type="hidden" name="fieldId" value={review.fieldId} />
                  <input
                    type="hidden"
                    name="required"
                    value={String(
                      !detail.fields.find((field) => field.id === review.fieldId)?.required,
                    )}
                  />
                  <Label htmlFor="require-reason">{t("admin.spec.reason")}</Label>
                  <Textarea id="require-reason" name="reason" required rows={2} />
                  <Button type="submit">
                    {detail.fields.find((field) => field.id === review.fieldId)?.required
                      ? t("admin.spec.require.drop")
                      : t("admin.spec.require.confirm")}
                  </Button>
                </form>
              </div>
            ) : (
              <ul className="flex flex-col">
                {detail.fields.map((field) => (
                  <li
                    key={field.id}
                    className="flex items-baseline justify-between gap-3 border-t border-line py-1.5 first:border-t-0"
                  >
                    <span className="min-w-0 text-body-sm text-body">
                      {field.label}
                      <span className="ms-2 font-mono text-eyebrow uppercase text-muted">
                        {field.required
                          ? t("admin.spec.detail.required_yes")
                          : t("admin.spec.detail.required_no")}
                      </span>
                    </span>
                    <Link
                      href={`/admin/spec-library/${detail.id}?require=${field.id}`}
                      className="shrink-0 text-caption text-ink hover:underline"
                    >
                      {field.required
                        ? t("admin.spec.require.drop")
                        : t("admin.spec.require.confirm")}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 border-t border-line pt-2 text-caption text-muted">
              {t("admin.spec.detail.no_facet_demand")}
            </p>
          </Panel>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-[var(--gutter)] xl:w-[352px]">
          <section id="review">
            <Panel title={t("admin.spec.publish.title", { version: String(detail.version + 1) })}>
              {detail.changes.length === 0 ? (
                <p className="text-body-sm text-body">{t("admin.spec.detail.nothing_staged")}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <ul className="flex flex-col gap-1.5">
                    {detail.changes.map((change) => (
                      <li key={`${change.kind}:${change.fieldId}`} className="text-body-sm text-body">
                        {t(CHANGE_KEY[change.kind], {
                          label: change.label,
                          from: change.from ?? "",
                        })}
                        <span className="ms-2 font-mono text-eyebrow uppercase text-muted">
                          {t(`admin.spec.blast.${change.blast}` as never)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <p className="border-t border-line pt-2 text-caption text-muted">
                    {t("admin.spec.publish.additive", {
                      count: detail.blast.clones,
                      n: formatCount(detail.blast.clones),
                    })}
                  </p>
                  {detail.changes.some((change) => change.kind === "field_removed") && (
                    <p className="text-caption text-muted">{t("admin.spec.publish.removal")}</p>
                  )}

                  <form action={publishDraftAction} className="flex flex-col gap-2">
                    <input type="hidden" name="templateId" value={detail.id} />
                    <Label htmlFor="publish-reason">{t("admin.spec.reason")}</Label>
                    <Textarea id="publish-reason" name="reason" required rows={2} />
                    <Button type="submit">
                      {t("admin.spec.publish.confirm", { version: String(detail.version + 1) })}
                    </Button>
                  </form>
                  <form action={discardDraftAction}>
                    <input type="hidden" name="templateId" value={detail.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      {t("admin.spec.publish.discard")}
                    </Button>
                  </form>
                </div>
              )}
            </Panel>
          </section>

          <Panel title={t("admin.spec.add.title")}>
            <form action={stageFieldAction} className="flex flex-col gap-3">
              <input type="hidden" name="templateId" value={detail.id} />
              <div className="flex flex-col gap-1">
                <Label htmlFor="field-label">{t("admin.spec.add.label")}</Label>
                <Input id="field-label" name="label" required maxLength={60} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="field-key">{t("admin.spec.add.key")}</Label>
                <Input id="field-key" name="key" required maxLength={40} pattern="[a-z0-9_]+" />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="field-type">{t("admin.spec.add.type")}</Label>
                <Select
                  id="field-type"
                  name="type"
                  options={[
                    { value: "text", label: "text" },
                    { value: "number", label: "number" },
                    { value: "number_range", label: "number_range" },
                    { value: "select", label: "select" },
                    { value: "multiselect", label: "multiselect" },
                    { value: "boolean", label: "boolean" },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="field-unit">{t("admin.spec.add.unit")}</Label>
                <Input id="field-unit" name="unit" maxLength={16} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="field-options">{t("admin.spec.add.options")}</Label>
                <Textarea id="field-options" name="options" rows={3} />
              </div>
              <Checkbox name="isFilterable" label={t("admin.spec.add.facet")} />
              <Checkbox name="variesByVariant" label={t("admin.spec.add.varies")} />
              <p className="text-caption text-muted">{t("admin.spec.add.not_required")}</p>
              <Button type="submit" variant="secondary">
                {t("admin.spec.add.stage")}
              </Button>
            </form>
          </Panel>

          <Panel title={t("admin.spec.remove.stage")}>
            <ul className="flex flex-col">
              {detail.fields.map((field) => {
                const removing = draft.removed.includes(field.id);
                return (
                  <li
                    key={field.id}
                    className="flex items-baseline justify-between gap-3 border-t border-line py-1.5 first:border-t-0"
                  >
                    <span className="min-w-0 truncate text-body-sm text-body">{field.label}</span>
                    <form action={stageRemovalAction} className="shrink-0">
                      <input type="hidden" name="templateId" value={detail.id} />
                      <input type="hidden" name="fieldId" value={field.id} />
                      <input type="hidden" name="undo" value={String(removing)} />
                      <Button type="submit" variant="link" size="sm">
                        {removing ? t("admin.spec.remove.undo") : t("admin.spec.remove.stage")}
                      </Button>
                    </form>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 border-t border-line pt-2 text-caption text-muted">
              {t("admin.spec.publish.removal")}
            </p>
          </Panel>
        </div>
      </div>
    </AdminPage>
  );
}
