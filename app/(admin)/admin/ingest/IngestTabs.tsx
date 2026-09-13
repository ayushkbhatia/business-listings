import { Tabs } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * The ingestion chain, as tabs: runs, the categorisation queue, dedupe.
 *
 * Board 12a draws four — import runs, dedupe queue, data quality, sources — and
 * two of those are not screens anywhere in the product. A tab to a page that
 * does not exist is a promise on a live control, so the strip carries the three
 * that do: the sources are the rail on the runs page, and data quality has no
 * spec to build from. Routes, so each is a real link (`Tabs as="a"`).
 *
 * The dedupe tab is shown only to a seat holding `business.merge`, the same
 * rule the sidebar applies — a moderator would otherwise be one click from a
 * 404.
 */
export function IngestTabs({
  active,
  queued,
  showDedupe,
}: {
  active: "runs" | "queue" | "dedupe";
  queued: number;
  showDedupe: boolean;
}) {
  return (
    <Tabs
      as="a"
      label={t("admin.ingest.tabs")}
      active={active}
      items={[
        { key: "runs", label: t("admin.ingest.tab.runs"), href: "/admin/ingest" },
        {
          key: "queue",
          label: t("admin.ingest.tab.queue"),
          href: "/admin/ingest/categorise",
          badge: queued,
        },
        ...(showDedupe
          ? [{ key: "dedupe", label: t("admin.ingest.tab.dedupe"), href: "/admin/ingest/dedupe" }]
          : []),
      ]}
    />
  );
}
