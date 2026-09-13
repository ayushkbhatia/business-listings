import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/display";
import { Card } from "@/components/structure";
import { mayEditListing } from "@/lib/auth/guards";
import { cn } from "@/lib/cn";
import { formatCount, formatList } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import type { CoverageMarker, CoverageTally } from "@/lib/locations/service-coverage";
import { coverageManagerFor, type ManagerRow } from "@/lib/services/coverage-manager";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { saveDefault, saveServiceSet } from "./actions";
import { DefaultCoverageEditor, ServiceCoverageEditor } from "./CoverageEditors";

/**
 * Board `3c-s` — `/dashboard/coverage`, the coverage manager.
 *
 * The goods `3c` is `/dashboard/locations`: a branch list with addresses and
 * pins. For a firm with one office that screen manages nothing, and until this
 * route existed a services seller had no dashboard screen for the thing that
 * actually varies — where each service is offered.
 *
 * One row per service (B1), the business default above it, and the union a
 * buyer reads beneath. Every marker and count on the page is derived on this
 * request from the rows (B3, B4); see `lib/services/coverage-manager.ts`.
 *
 * ## No availability control
 *
 * B10. `D11` was cut before `1d-s` was built, and the tree carries no services
 * waitlist state anywhere — so the rail's sentence is true as drawn, and the
 * handoff's worry that `1d-s` publishes a state with no field behind it does not
 * apply to what shipped.
 */
export const metadata = { title: t("coverage_manager.title") };
export const dynamic = "force-dynamic";

const MARKER_TONE: Record<CoverageMarker, string> = {
  inherited: "text-muted",
  same: "text-muted",
  narrowed: "text-warn-ink",
  wider: "text-warn-ink",
};

export default async function CoveragePage() {
  const seat = await requireSellerSeat();
  const [state, badges] = await Promise.all([
    coverageManagerFor(seat.businessId),
    getNavBadges(seat.businessId),
  ]);
  if (!state) notFound();

  const editable = mayEditListing(seat.actor);
  const modes = state.defaults.deliveryModes.map((mode) =>
    t(`coverage_manager.mode.${mode}` as MessageKey),
  );
  const defaultKeys = state.defaults.chips.filter((chip) => chip.on).map((chip) => chip.key);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/coverage"
      title={t("coverage_manager.title")}
      meta={
        <span className="font-mono text-eyebrow uppercase tracking-wide text-muted">
          {chipText(state.tally)}
        </span>
      }
      actions={
        <DefaultCoverageEditor
          modes={state.defaults.deliveryModes}
          chips={state.defaults.chips}
          otherScopes={state.defaults.otherScopes}
          freeZones={state.defaults.freeZones}
          registrations={state.defaults.registrations}
          inheriting={state.inheriting}
          editable={editable}
          save={saveDefault}
        />
      }
    >
      <div className="flex flex-col gap-[var(--gutter)] xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-[var(--gutter)]">
          {!editable && (
            <p className="text-caption text-body">{t("coverage_manager.read_only")}</p>
          )}

          {/* ── The default ─────────────────────────────────────────────── */}
          <Card>
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-eyebrow uppercase tracking-wide text-muted">
                {t("coverage_manager.default_eyebrow")}
              </span>
              <span className={cn("text-body", state.defaultPlaces.length === 0 && "text-faint")}>
                {state.defaultPlaces.length === 0
                  ? t("coverage_manager.default_none")
                  : modes.length === 0
                    ? state.defaultPlaces.join(" · ")
                    : t("coverage_manager.default_line", {
                        places: state.defaultPlaces.join(" · "),
                        modes: formatList(modes),
                      })}
              </span>
            </p>
            {/*
               The board's main piece of work, and it is a sentence. Sellers
               claim all seven emirates for fear that narrowing anything makes
               them invisible; saying where the headline comes from, at the point
               of editing, removes the reason to over-claim.
            */}
            <p className="mt-2 max-w-prose text-body-sm text-body">
              {t("coverage_manager.default_explainer")}
            </p>
          </Card>

          {/* ── One row per service ─────────────────────────────────────── */}
          <Card padded={false}>
            {state.rows.length === 0 ? (
              <div className="p-5">
                <p className="text-body-sm text-body">{t("coverage_manager.no_services")}</p>
                <Link
                  href="/dashboard/services"
                  className="mt-2 inline-block rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {t("coverage_manager.no_services_link")}
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left">
                  <caption className="sr-only">{t("coverage_manager.table_caption")}</caption>
                  <thead>
                    <tr className="border-b border-line">
                      <th scope="col" className="px-5 py-3 font-mono text-eyebrow uppercase tracking-wide text-muted">
                        {t("coverage_manager.col.service")}
                      </th>
                      <th scope="col" className="px-5 py-3 font-mono text-eyebrow uppercase tracking-wide text-muted">
                        {t("coverage_manager.col.where")}
                      </th>
                      <th scope="col" className="px-5 py-3 font-mono text-eyebrow uppercase tracking-wide text-muted">
                        {t("coverage_manager.col.delivered")}
                      </th>
                      <th scope="col" className="px-5 py-3">
                        <span className="sr-only">{t("coverage_manager.col.edit")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.rows.map((row) => (
                      <Row
                        key={row.serviceId}
                        row={row}
                        chips={state.defaults.chips.map((chip) => ({
                          ...chip,
                          on: row.ownKeys.includes(chip.key),
                        }))}
                        defaultKeys={defaultKeys}
                        defaultPlaces={state.defaultPlaces}
                        editable={editable}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/*
               What a buyer reads, computed by the same function `1d-s` uses —
               the union over live services only (B5). The exact set per service
               is on each service's page, which is what the second clause says.
            */}
            <div className="border-t border-line bg-paper-sunk px-5 py-4">
              <p className="max-w-prose text-body-sm text-body">
                {state.publicPlaces.length === 0
                  ? t("coverage_manager.public_none")
                  : t("coverage_manager.public_line", {
                      /*
                         Every name, never "All 7 emirates": the storefront
                         overview prints the union through `formatList`, and
                         this line claims to be what buyers see there.
                      */
                      places: formatList(state.publicPlaces),
                    })}
              </p>
              {/*
                 B8. True of the tree since PR 179: a brief routes through the
                 matched service's own effective coverage, never the listing
                 line. Named as *briefs*, deliberately — the goods enquiry
                 fan-out still matches per business, and a sentence claiming
                 every enquiry routes per service would be false for a firm that
                 sells both.
              */}
              <p className="mt-2 max-w-prose text-body-sm text-body">
                {state.matchExample
                  ? t("coverage_manager.match_example", state.matchExample)
                  : t("coverage_manager.match_rule")}
              </p>
              {state.uncovered > 0 && (
                <p className="mt-2 text-caption text-warn-ink">
                  {t("coverage_manager.uncovered", {
                    count: state.uncovered,
                    formatted: formatCount(state.uncovered),
                  })}
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* ── The rail ───────────────────────────────────────────────────── */}
        <aside className="flex w-full shrink-0 flex-col gap-4 xl:w-[21rem]">
          <Card>
            <h2 className="font-mono text-eyebrow uppercase tracking-wide text-muted">
              {t("coverage_manager.rail.availability_title")}
            </h2>
            <p className="mt-2 text-body-sm text-body">{t("coverage_manager.rail.availability_body")}</p>
          </Card>
          <Card>
            <h2 className="font-mono text-eyebrow uppercase tracking-wide text-muted">
              {t("coverage_manager.rail.zones_title")}
            </h2>
            <p className="mt-2 text-body-sm text-body">{t("coverage_manager.rail.zones_body")}</p>
            {state.defaults.registrations.length > 0 && (
              <p className="mt-2 text-caption text-muted">
                {t("coverage_manager.rail.zones_held", {
                  zones: formatList(state.defaults.registrations.map((zone) => zone.name)),
                })}
              </p>
            )}
          </Card>
        </aside>
      </div>
    </SellerPage>
  );
}

/**
 * `3 EMIRATES DEFAULT · 2 NARROWER · 1 WIDER`, from the rows (B4).
 *
 * A zero term is left out rather than printed — `0 WIDER` is a column of
 * nothing — except the default count, which is the anchor the other terms are
 * measured against and is meaningful at zero.
 */
function chipText(tally: CoverageTally): string {
  const parts = [
    t("coverage_manager.chip.default", { count: tally.defaultEmirates, formatted: formatCount(tally.defaultEmirates) }),
  ];
  if (tally.narrowed > 0) {
    parts.push(t("coverage_manager.chip.narrowed", { formatted: formatCount(tally.narrowed) }));
  }
  if (tally.wider > 0) {
    parts.push(t("coverage_manager.chip.wider", { formatted: formatCount(tally.wider) }));
  }
  if (tally.same > 0) {
    parts.push(t("coverage_manager.chip.same", { formatted: formatCount(tally.same) }));
  }
  return parts.join(" · ");
}

function Row({
  row,
  chips,
  defaultKeys,
  defaultPlaces,
  editable,
}: {
  row: ManagerRow;
  chips: Parameters<typeof ServiceCoverageEditor>[0]["chips"];
  defaultKeys: string[];
  defaultPlaces: string[];
  editable: boolean;
}) {
  return (
    <tr className="border-b border-line align-top last:border-b-0">
      <th scope="row" className="px-5 py-4 text-left font-normal">
        <Link
          href={`/dashboard/services/${row.serviceId}`}
          className="rounded-tag text-body text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {row.name}
        </Link>
        {/*
           Listed, and excluded from the union — the board's draft state. A
           draft's coverage is shown so the seller can see what it will claim
           before it goes live; the footer line does not count it.
        */}
        {row.status === "draft" && (
          <span className="ms-2 align-middle">
            <StatusBadge tone="neutral">{t("coverage_manager.draft")}</StatusBadge>
          </span>
        )}
      </th>

      <td className="px-5 py-4">
        <p className={cn("text-body", row.places.length === 0 && "text-warn-ink")}>
          {row.places.length === 0
            ? t("coverage_manager.row_nowhere")
            : row.everyEmirate
              ? t("coverage_manager.all_seven")
              : row.places.join(", ")}
          {row.qualifiers.length > 0 && (
            <span className="text-muted"> · {row.qualifiers.join(", ")}</span>
          )}
        </p>
        <p className={cn("mt-1 font-mono text-eyebrow uppercase tracking-wide", MARKER_TONE[row.marker])}>
          {t(`coverage_manager.marker.${row.marker}` as MessageKey)}
        </p>
        {row.marker === "same" && (
          <p className="mt-1 max-w-prose text-caption text-muted">{t("coverage_manager.marker.same_note")}</p>
        )}
      </td>

      <td className="px-5 py-4">
        {row.deliveredWhere ? (
          <p className="text-body">{t(`delivered.${row.deliveredWhere}` as MessageKey)}</p>
        ) : (
          <>
            <p className="text-faint">{t("coverage_manager.not_set")}</p>
            {/*
               B7. The gap, and its consequence on the public page. This is the
               one place a seller learns an unfilled field is already visible to
               buyers rather than merely absent. Delivery mode is written on
               the service editor (Q2), so the cell links there.
            */}
            <p className="mt-1 font-mono text-eyebrow uppercase tracking-wide text-warn-ink">
              {t("coverage_manager.public_reads_not_stated")}
            </p>
            <Link
              href={`/dashboard/services/${row.serviceId}`}
              className="mt-1 inline-block rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("coverage_manager.set_on_service")}
            </Link>
          </>
        )}
      </td>

      {/*
         Not `text-end` on the cell: the editor's `<dialog>` renders inside it
         and would inherit the alignment, right-aligning the whole modal.
      */}
      <td className="px-5 py-4">
        <div className="flex justify-end">
        <ServiceCoverageEditor
          serviceId={row.serviceId}
          serviceName={row.name}
          chips={chips}
          defaultKeys={defaultKeys}
          defaultPlaces={defaultPlaces}
          ownOther={row.ownOther}
          editable={editable}
          save={saveServiceSet}
        />
        </div>
      </td>
    </tr>
  );
}
