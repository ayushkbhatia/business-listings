/**
 * What *edit* means for a live section — board `5c-s` B2. Pure.
 *
 * Configuration only: which columns, which credentials, which coverage. Every
 * setting is a choice from a closed list, and there is no setting of any type
 * that accepts a string a person typed. That is B4 held structurally rather
 * than by a check: a builder that let somebody type beside a service name is
 * the one place on the platform a fee would appear, and a field that cannot
 * hold words cannot hold one.
 *
 * `TemplateSection.settings` is `Json` and was described as "shaped by the
 * type, validated in the service" with nothing doing either. This is both
 * halves: `readSettings` is what a renderer trusts, `checkSettings` is what the
 * write path refuses.
 */

/**
 * The scope grid's columns — `1e-s`'s four fields, in `1e-s`'s order.
 *
 * Reorder yes, rename no (Q2). A renamed *fee basis* column is how a fee ends up
 * published under another word, so a column is a key and its heading is ours.
 */
export const SCOPE_COLUMNS = ["engagement", "turnaround", "fee_basis", "delivered"] as const;
export type ScopeColumn = (typeof SCOPE_COLUMNS)[number];

export const CREDENTIAL_SHOWS = ["all", "verified"] as const;
export type CredentialShow = (typeof CREDENTIAL_SHOWS)[number];

export const COVERAGE_ROWS = ["per_service", "union"] as const;
export type CoverageRows = (typeof COVERAGE_ROWS)[number];

export interface SectionSettingsByType {
  scope_grid: { columns: ScopeColumn[] };
  credential_wall: { show: CredentialShow };
  coverage: { rows: CoverageRows };
}

export type ConfigurableType = keyof SectionSettingsByType;

/**
 * What a new section starts as.
 *
 * The scope grid opens on the two columns the board draws, fee basis then
 * turnaround. Every credential, because hiding the firm's own claims is a
 * choice and not a default. Coverage per service, because that is `1f-s` B1's
 * whole argument — a buyer in Sharjah needing an audit reads the audit row.
 */
export const DEFAULT_SETTINGS: SectionSettingsByType = {
  scope_grid: { columns: ["fee_basis", "turnaround"] },
  credential_wall: { show: "all" },
  coverage: { rows: "per_service" },
};

/** A control the settings form draws. A closed list, always. */
export type SettingControl =
  | { key: "columns"; kind: "columns"; options: readonly ScopeColumn[] }
  | { key: "show"; kind: "choice"; options: readonly CredentialShow[] }
  | { key: "rows"; kind: "choice"; options: readonly CoverageRows[] };

export const SETTING_CONTROLS: Readonly<Record<ConfigurableType, readonly SettingControl[]>> = {
  scope_grid: [{ key: "columns", kind: "columns", options: SCOPE_COLUMNS }],
  credential_wall: [{ key: "show", kind: "choice", options: CREDENTIAL_SHOWS }],
  coverage: [{ key: "rows", kind: "choice", options: COVERAGE_ROWS }],
};

export function isConfigurable(typeKey: string): typeKey is ConfigurableType {
  return Object.hasOwn(SETTING_CONTROLS, typeKey);
}

function record(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function oneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

/**
 * The settings a renderer uses. Never throws, never returns an unknown key.
 *
 * A stored value that is not one of the options — a row written before a
 * column was renamed, a hand edit — falls back to the default for that key
 * rather than rendering something nobody chose. Duplicated columns collapse.
 */
export function readSettings<T extends ConfigurableType>(
  typeKey: T,
  raw: unknown,
): SectionSettingsByType[T] {
  const value = record(raw);
  switch (typeKey) {
    case "scope_grid": {
      const columns = Array.isArray(value.columns)
        ? [...new Set(value.columns.filter((column) => oneOf(SCOPE_COLUMNS, column)))]
        : [];
      return {
        columns: columns.length > 0 ? columns : [...DEFAULT_SETTINGS.scope_grid.columns],
      } as SectionSettingsByType[T];
    }
    case "credential_wall":
      return {
        show: oneOf(CREDENTIAL_SHOWS, value.show) ? value.show : DEFAULT_SETTINGS.credential_wall.show,
      } as SectionSettingsByType[T];
    case "coverage":
      return {
        rows: oneOf(COVERAGE_ROWS, value.rows) ? value.rows : DEFAULT_SETTINGS.coverage.rows,
      } as SectionSettingsByType[T];
    default:
      return {} as SectionSettingsByType[T];
  }
}

export type SettingsRefusal = "not_configurable" | "unknown_setting" | "not_an_option" | "no_columns";

/**
 * Whether a write may store these settings. Null means yes.
 *
 * Refuses a key the type does not declare, a value off its list, a column
 * twice, and a grid with no columns — a scope grid with only names in it is a
 * list, and the list is not what the section is for.
 */
export function checkSettings(typeKey: string, raw: unknown): SettingsRefusal | null {
  if (!isConfigurable(typeKey)) return "not_configurable";
  const value = record(raw);
  const allowed = new Set(SETTING_CONTROLS[typeKey].map((control) => control.key));
  for (const key of Object.keys(value)) if (!allowed.has(key as never)) return "unknown_setting";

  for (const control of SETTING_CONTROLS[typeKey]) {
    const given = value[control.key];
    if (given === undefined) continue;
    if (control.kind === "columns") {
      if (!Array.isArray(given)) return "not_an_option";
      if (given.length === 0) return "no_columns";
      if (!given.every((column) => oneOf(control.options, column))) return "not_an_option";
      if (new Set(given).size !== given.length) return "not_an_option";
    } else if (!oneOf(control.options as readonly string[], given)) {
      return "not_an_option";
    }
  }
  return null;
}
