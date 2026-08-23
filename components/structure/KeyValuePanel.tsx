import { cn } from "@/lib/cn";

/**
 * Label and value pairs. The storefront's at-a-glance block, the admin detail
 * pane, the spec summary.
 *
 * An absent value renders as a faint "Not provided" row rather than being
 * dropped. A missing row reads as a field that does not exist; a marked one
 * reads as a field the seller has not filled, which is the truth and is what
 * makes the completeness meter mean anything.
 */
export interface KeyValueEntry {
  key: string;
  label: string;
  /** Absent or empty renders the not-provided treatment. */
  value?: React.ReactNode;
  /** Machine strings — TRN, licence number, SKU. */
  mono?: boolean;
  /** Spans both columns. For an address or a long list. */
  wide?: boolean;
}

export interface KeyValuePanelProps {
  entries: readonly KeyValueEntry[];
  /** Shown in place of an empty value, already localised. */
  notProvidedLabel: string;
  /** Two columns on wide screens, one on narrow. */
  columns?: 1 | 2;
  /** Alternating row tint, as the spec table uses. */
  striped?: boolean;
}

export function KeyValuePanel({
  entries,
  notProvidedLabel,
  columns = 2,
  striped = false,
}: KeyValuePanelProps) {
  return (
    <dl
      className={cn(
        "grid gap-x-6",
        columns === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1",
      )}
    >
      {entries.map((entry, i) => {
        const empty = entry.value === undefined || entry.value === null || entry.value === "";
        return (
          <div
            key={entry.key}
            className={cn(
              "grid grid-cols-[minmax(7rem,38%)_1fr] items-baseline gap-3 border-b border-line py-2",
              entry.wide && columns === 2 && "md:col-span-2",
              striped && i % 2 === 1 && "bg-paper-sunk",
            )}
          >
            <dt className="text-caption text-muted">{entry.label}</dt>
            <dd
              className={cn(
                "min-w-0 text-body-sm",
                entry.mono && "font-mono",
                empty ? "text-faint" : "text-body",
              )}
            >
              {empty ? notProvidedLabel : entry.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
