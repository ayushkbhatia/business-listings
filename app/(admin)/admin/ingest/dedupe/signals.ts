import type { Signal } from "@/lib/dedupe/similarity";
import { formatPercent } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * The match-signals rail, as rows. A pure function rather than a component so
 * the server page and the gallery draw the same five answers.
 */

export interface SignalRow {
  key: string;
  label: string;
  value: string;
  tone: "ok" | "warn" | "muted";
}

/** The five questions the rail always asks, whether or not the answer is yes. */
export function signalRows(signals: readonly Signal[]): SignalRow[] {
  const find = (key: Signal["key"]) => signals.find((signal) => signal.key === key);
  const licence = find("licence_number") ?? find("licence_root");
  const phone = find("phone");
  const name = find("trade_name");
  const address = find("address");
  const area = find("same_area") ?? find("nearby_area");
  const activity = find("activity");
  const no = t("admin.dedupe.strength.no");

  return [
    {
      key: "licence",
      label: t(
        licence?.key === "licence_number"
          ? "admin.dedupe.signal.licence_number"
          : licence
            ? "admin.dedupe.signal.licence_root"
            : "admin.dedupe.signal.licence",
      ),
      value: licence ? t("admin.dedupe.strength.strong") : no,
      tone: licence ? "ok" : "muted",
    },
    {
      key: "phone",
      label: t(phone ? "admin.dedupe.signal.phone_match" : "admin.dedupe.signal.phone"),
      value: phone ? t("admin.dedupe.strength.strong") : no,
      tone: phone ? "ok" : "muted",
    },
    {
      key: "trade_name",
      label: t("admin.dedupe.signal.trade_name"),
      value: name ? formatPercent(name.strength) : no,
      tone: !name ? "muted" : name.strength >= 0.8 ? "ok" : "warn",
    },
    ...(address
      ? [
          {
            key: "address",
            label: t("admin.dedupe.signal.address"),
            value: formatPercent(address.strength),
            tone: (address.strength >= 0.8 ? "ok" : "warn") as SignalRow["tone"],
          },
        ]
      : []),
    {
      key: "area",
      label: t("admin.dedupe.signal.area"),
      value: !area ? no : area.key === "same_area" ? t("admin.dedupe.strength.yes") : t("admin.dedupe.strength.adjacent"),
      tone: !area ? "muted" : area.key === "same_area" ? "ok" : "warn",
    },
    {
      key: "activity",
      label: t("admin.dedupe.signal.activity"),
      value: activity ? t("admin.dedupe.strength.yes") : no,
      tone: activity ? "ok" : "muted",
    },
  ];
}
