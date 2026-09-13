import { CredentialTable } from "@/components/domain/CredentialTable";
import { t } from "@/lib/i18n";
import type { SectionProps } from "@/lib/storefront/render-data";
import { readSettings } from "@/lib/storefront/section-settings";

/**
 * Board `5c-s` — the credential wall.
 *
 * `CredentialTable`, the one component `1d-s`, `1g-s` and the credentials tab
 * share: a checked credential says who checked it, and a firm's own claim says
 * that it is one. The configuration is which rows — every credential, or only
 * the ones somebody checked — and nothing else (B2). The badge never takes the
 * theme; that is the table's, not this section's, to hold.
 *
 * **Omitted on a storefront when there is nothing to show**, as `1d-s` omits
 * it. A preview says why instead, and where the seller adds one.
 */
export function CredentialWall({ section, data, preview }: SectionProps) {
  const { show } = readSettings("credential_wall", section.settings);
  const all = data.work?.credentials ?? [];
  const rows = show === "verified" ? all.filter((row) => row.verified) : all;
  const name = data.business.displayName;

  if (rows.length === 0 && !preview) return null;

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h2 text-brand-ink">{t("storefront_services.credentials_tab")}</h2>
        <p className="text-body-sm text-muted">{t("storefront_services.credentials_hint")}</p>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 max-w-[var(--measure-prose)] text-body-sm text-muted">
          {all.length > 0 ? t("section.credential_wall.none_checked") : t("section.credential_wall.empty_preview")}
        </p>
      ) : (
        <div className="mt-4">
          <CredentialTable
            rows={rows}
            name={name}
            caption={t("storefront_services.credentials_caption", { name })}
          />
        </div>
      )}
    </section>
  );
}
