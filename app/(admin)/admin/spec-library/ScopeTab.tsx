import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ScopeLibrary } from "@/lib/services/family-library";
import { ScopeFamilies, type FamilyView } from "./ScopeFamilies";
import {
  addFeeBasisAction,
  assignFamilyAction,
  removeFeeBasisAction,
  retireFamilyAction,
  saveRowOrderAction,
} from "./scope-actions";

/**
 * Board `4e-s` — the scope-sheet tab.
 *
 * Server half: it resolves every label before anything crosses into the client
 * component, which is this repository's most repeated defect and what
 * `tests/unit/client-labels` fails the build on.
 *
 * ## The numbers are this tree's, not the board's
 *
 * The board says *420 subcategories, 420 assignments*. `Category.tradeKind` is
 * null on 434 of 440 rows — `4d-s` shipped the column and the resolver and
 * classified six — so the walk resolves **39** leaves to services. The header
 * counts what is there and says how many of them have a family, which is the
 * pressure B6 asks for; inventing 381 classifications to reach the board's
 * figure would be `4d-s`'s job done badly by this board.
 */
const CREDENTIAL_LABEL: Record<string, string> = {
  fta_tax_agent: t("credentials.kind.fta_tax_agent"),
  mof_audit_approval: t("credentials.kind.mof_audit_approval"),
  professional_body: t("credentials.kind.professional_body"),
  indemnity_insurance: t("credentials.kind.indemnity_insurance"),
  other: t("credentials.kind.other"),
};

const FIELD_LABEL: Record<string, string> = {
  name: t("admin.scope.field.name"),
  engagementType: t("admin.scope.field.engagementType"),
  feeBasis: t("admin.scope.field.feeBasis"),
  turnaround: t("admin.scope.field.turnaround"),
  deliveredWhere: t("admin.scope.field.deliveredWhere"),
  deliverable: t("admin.scope.field.deliverable"),
};

export function ScopeTab({ library, specs }: { library: ScopeLibrary; specs: number }) {
  const families: FamilyView[] = library.families.map((family) => ({
    id: family.id,
    name: family.name,
    isDefault: family.isDefault,
    retired: family.retiredAt !== null,
    credentialLabel:
      family.credentialKind === null ? null : (CREDENTIAL_LABEL[family.credentialKind] ?? null),
    feeBases: family.feeBases.map((basis) => ({
      key: basis.key,
      label: basis.label,
      usedBy: basis.usedBy,
    })),
    rows: family.rows.map((row) => ({
      key: row.key,
      label: row.label,
      filterable: row.filterable,
    })),
    common: family.common,
    subcategories: family.subcategories,
    publishedServices: family.publishedServices,
    templates: family.templates,
  }));

  const assigned = library.servicesSubcategories - library.unassigned.length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-h3 font-medium text-ink">{t("admin.scope.title")}</h2>
        <p className="mt-1.5 max-w-prose text-body-sm text-body">
          {t("admin.scope.intro", { specs: formatCount(specs) })}
        </p>
        {/*
           Counted, never claimed. `CLAUDE.md`: every number is a query — and
           this one is the board's 420 measured against a taxonomy where almost
           nothing has been classified as services yet.
        */}
        <p className="mt-1.5 font-mono text-eyebrow tabular-nums text-muted">
          {t("admin.scope.meta", {
            families: formatCount(families.filter((family) => !family.isDefault).length),
            assigned: formatCount(assigned),
            total: formatCount(library.servicesSubcategories),
          })}
        </p>
      </div>

      <ScopeFamilies
        families={families}
        unassigned={library.unassigned}
        requiredFields={library.requiredFields.map((key) => ({
          key,
          label: FIELD_LABEL[key] ?? key,
        }))}
        assign={assignFamilyAction}
        retire={retireFamilyAction}
        addBasis={addFeeBasisAction}
        removeBasis={removeFeeBasisAction}
        saveOrder={saveRowOrderAction}
      />
    </div>
  );
}
