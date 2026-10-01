import { formatDate, formatMonth } from "@/lib/format";
import { t } from "@/lib/i18n";
import { isVerified, licenceExpired } from "@/lib/verification";

/**
 * Board 10g's record card — *What the public record says* — as rows.
 *
 * Every row is a column the licence importer wrote from the register's own row
 * (`12a` B5): the legal name, the number, the expiry, the licensed activity,
 * the address text and the telephone it carried. Nothing else reaches it.
 *
 * A field the importer did not populate is an explicit `absent`, never an
 * empty string standing in for one, and it renders muted under its own label
 * (`B3`). It is not hidden and it is not filled from somewhere else — the
 * buyer sees what is unanswered and the owner sees what claiming would let
 * them answer, which is the argument for claiming.
 *
 * Pure: the page passes `now`, so the lapsed test and the date in the status
 * row cannot disagree with each other or with the claim card beside them.
 */

export interface RecordSource {
  /** The legal name, verbatim, suffix included. Licence-locked. */
  tradeName: string;
  licenceNumber: string;
  licenceExpiry: Date;
  licenceActivity: string | null;
  source: "licence_import" | "self_added";
  /** When the record entered the directory — the import, for a licence import. */
  createdAt: Date;
  /**
   * What we checked ourselves. An unclaimed listing is tier 0 as the importer
   * writes it, but a licence checked against the register without a claim
   * exists — production held 23 on 1 Oct 2026 — and "not verified by us" on
   * one of those would be the page saying something false about our own work.
   */
  verificationTier: number;
  verifiedAt: Date | null;
  /** The register's address and telephone, as the importer wrote them onto the head office. */
  head: { addressLine: string; phone: string | null } | null;
}

export type RecordRowKey =
  | "legal_name"
  | "licence"
  | "status"
  | "activity"
  | "area"
  | "phone"
  | "provided";

export type RecordValue =
  | { state: "present"; text: string; tone: "ink" | "ok" | "warn" | "bad"; mono: boolean }
  | { state: "absent"; text: string };

export interface RecordRow {
  key: RecordRowKey;
  label: string;
  value: RecordValue;
  /** Spans both columns: the odd row out at the foot of the grid. */
  wide: boolean;
}

export interface UnclaimedRecord {
  rows: RecordRow[];
  /** "Imported Jan 2026" — null where the record did not come from an import. */
  imported: string | null;
  /** The register says the licence has expired. Withdraws the claim card and the index entry. */
  lapsed: boolean;
  /** We checked the licence against the register ourselves — the banner says so rather than "nothing is verified". */
  licenceChecked: boolean;
}

function present(
  text: string,
  { tone = "ink", mono = false }: { tone?: "ink" | "ok" | "warn" | "bad"; mono?: boolean } = {},
): RecordValue {
  return { state: "present", text, tone, mono };
}

function absent(text: string): RecordValue {
  return { state: "absent", text };
}

export function unclaimedRecord(source: RecordSource, now: Date): UnclaimedRecord {
  const lapsed = licenceExpired(source.licenceExpiry, now);
  const licenceChecked = !lapsed && isVerified(source.verificationTier) && source.verifiedAt !== null;
  const notOnRecord = t("unclaimed.record.not_on_record");

  const rows: RecordRow[] = [
    /*
       The owner's answer of 1 Oct 2026 on `B2`: the h1 stays the display name,
       as on every surface that links here, and the name the register holds
       sits in the record it came from. The suffix is what tells three
       lookalike trade names apart, beside the number that settles it.
    */
    {
      key: "legal_name",
      label: t("unclaimed.record.legal_name"),
      value: present(source.tradeName),
      wide: false,
    },
    {
      key: "licence",
      label: t("unclaimed.record.licence"),
      value: present(source.licenceNumber, { mono: true }),
      wide: false,
    },
    /*
       `B4`: the expiry reaches the page, and "Active" without a date is not
       enough — a register row from January says nothing about October on its
       own. "Not verified by us" stays on the current one because it is the
       sentence the whole page rests on.
    */
    {
      key: "status",
      label: t("unclaimed.record.status"),
      value: lapsed
        ? present(t("unclaimed.record.status_expired", { date: formatDate(source.licenceExpiry) }), {
            tone: "bad",
          })
        : licenceChecked
          ? present(
              t("unclaimed.record.status_checked", {
                date: formatDate(source.licenceExpiry),
                checked: formatDate(source.verifiedAt!),
              }),
              { tone: "ok" },
            )
          : present(t("unclaimed.record.status_active", { date: formatDate(source.licenceExpiry) }), {
              tone: "warn",
            }),
      wide: false,
    },
    {
      key: "activity",
      label: t("unclaimed.record.activity"),
      value: source.licenceActivity?.trim() ? present(source.licenceActivity.trim()) : absent(notOnRecord),
      wide: false,
    },
    {
      key: "area",
      label: t("unclaimed.record.area"),
      value: source.head?.addressLine.trim() ? present(source.head.addressLine.trim()) : absent(notOnRecord),
      wide: false,
    },
    /*
       `B5`: a presence flag and never the digits. The number on a licence
       record has never been checked against the business, and printing it
       would put an unverified line in front of every buyer who reads the page
       — 12d masks the same number on the console for the same reason.
    */
    {
      key: "phone",
      label: t("unclaimed.record.phone"),
      value: source.head?.phone?.trim()
        ? present(t("unclaimed.record.phone_on_record"))
        : absent(notOnRecord),
      wide: false,
    },
    /*
       Always absent while the listing is unclaimed. A register holds no hours,
       no photographs and no catalogue, and nobody has added them — `B6`'s "no
       invented hours" in the one row where the temptation is strongest.
    */
    {
      key: "provided",
      label: t("unclaimed.record.provided"),
      value: absent(t("table.not_provided")),
      wide: true,
    },
  ];

  return {
    rows,
    imported:
      source.source === "licence_import"
        ? t("unclaimed.record.imported", { month: formatMonth(source.createdAt) })
        : null,
    lapsed,
    licenceChecked,
  };
}
