import { useId } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/display";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { CompositionTable } from "../revenue/CompositionTable";
import { GrowthChart } from "./GrowthChart";
import { OverviewLink } from "./OverviewLink";
import type { CategoryRowScreen, OverviewScreen, TileScreen, Tone } from "./present";

/**
 * Board 4a's body: six tiles, the growth chart over category health, and a
 * rail sorted by urgency. The header — title, status chip, period picker — is
 * the shell's, set by the page.
 *
 * Presentational only: it draws an `OverviewScreen`, which `presentOverview`
 * builds. The gallery renders it from fixtures through that same function, so
 * every state the gallery shows is a state the console can reach.
 *
 * **Every number is a link** (B1), into the board that owns it, with the
 * filter that reproduces it — or plain text where the seat cannot open that
 * board, which `assembleOverview` decided before this ran.
 */

const TONE_TEXT: Record<Tone, string> = {
  good: "text-ok-ink",
  neutral: "text-muted",
  bad: "text-bad-ink",
  warn: "text-warn-ink",
};

const GAP_TONE = {
  severe: "bad",
  watch: "warn",
  healthy: "ok",
  oversupplied: "info",
  no_demand: "neutral",
} as const;

const FOCUS = "rounded-tag focus-visible:shadow-focus focus-visible:outline-none";

export interface OverviewViewProps {
  screen: OverviewScreen;
  /** The month on screen, for the click log. */
  periodKey: string;
  /** Where *Show all sectors* points, or null when every sector is already shown. */
  allSectorsHref: string | null;
  /**
   * A gallery specimen: the same markup without landmark roles. The gallery
   * draws this screen in nine states on one page, and nine regions named *Plan
   * mix* are nine landmarks with one name — the axe rule the gallery has
   * failed on before.
   */
  specimen?: boolean;
}

export function OverviewView({ screen, periodKey, allSectorsHref, specimen = false }: OverviewViewProps) {
  const Rail = specimen ? "div" : "aside";
  return (
    <div className="flex flex-col gap-4">
      <Tiles tiles={screen.tiles} periodKey={periodKey} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_19.75rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <GrowthChart chart={screen.chart} legendLabel={t("overview.chart.legend")} specimen={specimen} />
          <CategoryHealth screen={screen} periodKey={periodKey} allSectorsHref={allSectorsHref} specimen={specimen} />
        </div>

        <Rail {...(specimen ? {} : { "aria-label": t("overview.rail_label") })} className="flex min-w-0 flex-col gap-3.5">
          {screen.needsHuman ? <NeedsHuman screen={screen} periodKey={periodKey} specimen={specimen} /> : null}
          {screen.otherQueues.length > 0 ? <OtherQueues screen={screen} periodKey={periodKey} specimen={specimen} /> : null}
          {screen.planMix ? <PlanMix screen={screen} periodKey={periodKey} specimen={specimen} /> : null}
          <Searches screen={screen} periodKey={periodKey} specimen={specimen} />
        </Rail>
      </div>

      {screen.opens ? <p className="max-w-prose text-caption text-muted">{screen.opens}</p> : null}
    </div>
  );
}

// ── Tiles ────────────────────────────────────────────────────────────────────

/*
   Laid out by the width the tiles actually have, not the viewport's: the same
   six tiles sit beside a 236px sidebar on the console and inside a narrower
   frame in the gallery. Six across from 72rem, which a 1440 screen gives them;
   three by two below that, as the handoff asks for under 1280.
*/
function Tiles({ tiles, periodKey }: { tiles: readonly TileScreen[]; periodKey: string }) {
  return (
    <div className="@container">
      <ul
        aria-label={t("overview.tiles_label")}
        className={cn(
          "m-0 grid list-none grid-cols-2 gap-[11px] p-0 @3xl:grid-cols-3",
          tiles.length >= 6 ? "@6xl:grid-cols-6" : tiles.length === 5 ? "@6xl:grid-cols-5" : "@6xl:grid-cols-4",
        )}
      >
      {tiles.map((tile) => (
        <li
          key={tile.key}
          className={cn(
            "flex min-w-0 flex-col rounded-card border px-[15px] py-[14px]",
            tile.urgent ? "border-bad-line bg-bad-surface" : "border-line bg-card",
          )}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <p className={cn("m-0 text-caption", tile.urgent ? "text-bad-ink" : "text-muted")}>{tile.label}</p>
            <span
              className={cn(
                "shrink-0 font-mono text-eyebrow uppercase",
                tile.urgent ? "text-bad-ink" : tile.scopeIsPeriod ? "text-body" : "text-muted",
              )}
            >
              {tile.scope}
            </span>
          </div>
          <p className={cn("m-0 mt-1 whitespace-nowrap text-h1 font-medium tabular-nums", tile.urgent ? "text-bad-ink" : "text-ink")}>
            {tile.href ? (
              <OverviewLink
                href={tile.href}
                figure={tile.key}
                period={periodKey}
                className={cn(FOCUS, "underline-offset-4 hover:underline")}
              >
                <span className="sr-only">{`${tile.label}: `}</span>
                <TileValue tile={tile} />
              </OverviewLink>
            ) : (
              <TileValue tile={tile} />
            )}
          </p>
          {tile.lines.map((line) => (
            /*
               On the red tile every line is in its ink: the muted grey on that
               fill is a pairing below the floor, and the gallery's contrast
               check admits no new one.
            */
            <p key={line.text} className={cn("m-0 mt-1.5 text-caption", tile.urgent ? "text-bad-ink" : TONE_TEXT[line.tone])}>
              {line.text}
            </p>
          ))}
          {tile.warnings.map((warning) => (
            <p key={warning} className="m-0 mt-2 text-caption text-warn-ink">
              <StatusBadge tone="warn" size="sm" shape="chip">
                {t("overview.warning.label")}
              </StatusBadge>{" "}
              {warning}
            </p>
          ))}
        </li>
      ))}
      </ul>
    </div>
  );
}

/**
 * The figure, whole. A money figure prints its currency a size down so the
 * digits — never abbreviated, `formatAED`'s rule — fit a sixth of the row.
 */
function TileValue({ tile }: { tile: TileScreen }) {
  if (!tile.unit) return <>{tile.value}</>;
  return (
    <>
      <span className="text-h3 font-medium">{tile.unit}</span> {tile.value}
    </>
  );
}

// ── Category health ──────────────────────────────────────────────────────────

function CategoryHealth({
  screen,
  periodKey,
  allSectorsHref,
  specimen,
}: {
  screen: OverviewScreen;
  periodKey: string;
  allSectorsHref: string | null;
  specimen: boolean;
}) {
  const titleId = useId();
  const categories = screen.categories;
  const Region = specimen ? "div" : "section";
  return (
    <Region {...(specimen ? {} : { "aria-labelledby": titleId })} className="overflow-hidden rounded-card-lg border border-line bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-[18px] py-[13px]">
        <h2 id={titleId} className="text-h3 font-medium text-ink">
          {t("overview.categories.title")}
        </h2>
        <span className="text-caption text-muted">{categories.window}</span>
      </div>

      {categories.total === 0 ? (
        <p className="border-t border-line px-[18px] py-4 text-body-sm text-body">{t("overview.categories.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-body-sm">
            <caption className="sr-only">{t("overview.categories.caption")}</caption>
            <thead>
              <tr className="bg-paper-sunk">
                <th scope="col" className="px-[18px] py-2 text-start font-mono text-colhead font-medium uppercase text-body">
                  {t("overview.categories.col.category")}
                </th>
                <th scope="col" className="w-[110px] px-2 py-2 text-end font-mono text-colhead font-medium uppercase text-body">
                  {t("overview.categories.col.listings")}
                </th>
                <th scope="col" className="w-[110px] px-2 py-2 text-end font-mono text-colhead font-medium uppercase text-body">
                  {t("overview.categories.col.claimed")}
                </th>
                <th scope="col" className="w-[120px] px-2 py-2 text-end font-mono text-colhead font-medium uppercase text-body">
                  {t("overview.categories.col.rfqs")}
                </th>
                <th scope="col" className="w-[190px] px-[18px] py-2 text-start font-mono text-colhead font-medium uppercase text-body">
                  {t("overview.categories.col.gap")}
                </th>
              </tr>
            </thead>
            <tbody>
              {categories.rows.map((row) => (
                <CategoryRow key={row.key} row={row} periodKey={periodKey} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-1 border-t border-line px-[18px] py-3">
        <p className="m-0 max-w-prose text-caption text-body">{categories.rule}</p>
        {categories.noGap ? <p className="m-0 text-caption text-body">{t("overview.categories.no_gap")}</p> : null}
        {allSectorsHref && categories.hidden > 0 ? (
          <Link href={allSectorsHref} className={cn(FOCUS, "self-start text-caption text-moss underline underline-offset-2")}>
            {t("overview.categories.show_all", { n: String(categories.total) })}
          </Link>
        ) : null}
      </div>
    </Region>
  );
}

function Cell({
  href,
  figure,
  periodKey,
  context,
  children,
}: {
  href: string | null;
  figure: string;
  periodKey: string;
  /** Read before the figure by a screen reader, so a link read out of its row still says what it counts. */
  context?: string;
  children: React.ReactNode;
}) {
  if (!href) return <>{children}</>;
  return (
    <OverviewLink href={href} figure={figure} period={periodKey} className={cn(FOCUS, "underline-offset-2 hover:underline")}>
      {context ? <span className="sr-only">{`${context}: `}</span> : null}
      {children}
    </OverviewLink>
  );
}

function CategoryRow({ row, periodKey }: { row: CategoryRowScreen; periodKey: string }) {
  const chip = (
    <StatusBadge tone={GAP_TONE[row.label]} shape="chip">
      {row.labelText}
    </StatusBadge>
  );
  return (
    <tr className="border-t border-paper-sunk">
      <th scope="row" className="px-[18px] py-2.5 text-start font-normal text-ink">
        <Cell href={row.links.sector} figure="category" periodKey={periodKey}>
          {row.name}
        </Cell>
      </th>
      <td className="px-2 py-2.5 text-end tabular-nums text-ink">
        <Cell
          href={row.links.listings}
          figure="category_listings"
          periodKey={periodKey}
          context={t("overview.categories.listings_in", { sector: row.name })}
        >
          {row.listings}
        </Cell>
      </td>
      <td className="px-2 py-2.5 text-end tabular-nums text-ink">
        <Cell
          href={row.links.claimed}
          figure="category_claimed"
          periodKey={periodKey}
          context={t("overview.categories.claimed_in", { sector: row.name })}
        >
          {row.claimed}
        </Cell>
      </td>
      <td className="px-2 py-2.5 text-end tabular-nums text-ink">{row.rfqs}</td>
      <td className="px-[18px] py-2.5">
        <span className="flex items-center gap-2">
          <span className="w-10 font-mono text-eyebrow tabular-nums text-body">{row.ratio}</span>
          {row.links.recruit ? (
            <OverviewLink href={row.links.recruit} figure="recruit" period={periodKey} className={FOCUS}>
              <span className="sr-only">{`${t("overview.categories.recruit_in", { sector: row.name })}: `}</span>
              {chip}
            </OverviewLink>
          ) : (
            chip
          )}
        </span>
      </td>
    </tr>
  );
}

// ── The rail ─────────────────────────────────────────────────────────────────

function RailCard({
  eyebrow,
  tone = "card",
  specimen,
  children,
}: {
  eyebrow: string;
  tone?: "card" | "urgent" | "sunk";
  specimen: boolean;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const Region = specimen ? "div" : "section";
  return (
    <Region
      {...(specimen ? {} : { "aria-labelledby": titleId })}
      className={cn(
        "rounded-card-lg border px-[19px] py-[17px]",
        tone === "urgent" ? "border-bad-line bg-bad-surface" : tone === "sunk" ? "border-line bg-paper-sunk" : "border-line bg-card",
      )}
    >
      <h2
        id={titleId}
        className={cn("m-0 font-mono text-eyebrow font-medium uppercase", tone === "urgent" ? "text-bad-ink" : "text-body")}
      >
        {eyebrow}
      </h2>
      {children}
    </Region>
  );
}

interface CardProps {
  screen: OverviewScreen;
  periodKey: string;
  specimen: boolean;
}

function NeedsHuman({ screen, periodKey, specimen }: CardProps) {
  const card = screen.needsHuman!;
  return (
    <RailCard eyebrow={t("overview.human.title")} tone={card.clear ? "card" : "urgent"} specimen={specimen}>
      {card.clear ? <p className="m-0 mt-2 text-body-sm font-medium text-ink">{t("overview.human.clear")}</p> : null}
      <ul className="m-0 mt-2.5 flex list-none flex-col gap-2 p-0">
        {card.rows.map((row) => (
          <li key={row.key} className="flex items-baseline justify-between gap-3 text-body-sm">
            <span className={cn(row.urgent ? "text-bad-ink" : "text-body")}>
              {row.href ? (
                <OverviewLink href={row.href} figure={row.key} period={periodKey} className={cn(FOCUS, "underline-offset-2 hover:underline")}>
                  {row.label}
                </OverviewLink>
              ) : (
                row.label
              )}
            </span>
            <span className={cn("font-medium tabular-nums", row.urgent ? "text-bad-ink" : "text-ink")}>{row.count}</span>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-3 text-caption text-body">{card.footnote}</p>
    </RailCard>
  );
}

function OtherQueues({ screen, periodKey, specimen }: CardProps) {
  return (
    <RailCard eyebrow={t("overview.other.title")} specimen={specimen}>
      <ul className="m-0 mt-2.5 flex list-none flex-col gap-2 p-0">
        {screen.otherQueues.map((row) => (
          <li key={row.key} className="flex items-baseline justify-between gap-3 text-body-sm">
            <span className="text-body">
              {row.href ? (
                <OverviewLink href={row.href} figure={row.key} period={periodKey} className={cn(FOCUS, "underline-offset-2 hover:underline")}>
                  {row.label}
                </OverviewLink>
              ) : (
                row.label
              )}
            </span>
            <span className="shrink-0 font-mono text-caption tabular-nums text-ink">{row.value}</span>
          </li>
        ))}
      </ul>
    </RailCard>
  );
}

function PlanMix({ screen, periodKey, specimen }: CardProps) {
  const mix = screen.planMix!;
  return (
    <RailCard eyebrow={t("overview.plan.title")} specimen={specimen}>
      <ul className="m-0 mt-2.5 flex list-none flex-col gap-3 p-0">
        {mix.rows.map((row) => (
          <li key={row.key} className="flex flex-col gap-1.5">
            <span className="flex items-baseline justify-between gap-3 text-body-sm">
              <span className="text-body">
                {row.href ? (
                  <OverviewLink href={row.href} figure={row.key} period={periodKey} className={cn(FOCUS, "underline-offset-2 hover:underline")}>
                    {row.label}
                  </OverviewLink>
                ) : (
                  row.label
                )}
              </span>
              <span className="font-mono text-caption tabular-nums text-ink">
                {row.count}
                <span className="sr-only">{`, ${row.share}`}</span>
              </span>
            </span>
            {/* One scale (B5): every bar is a share of claimed. */}
            <span aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-[3px] bg-track">
              <span className={cn("block h-full", row.paid ? "bg-moss" : "bg-moss-muted")} style={{ width: `${row.pct}%` }} />
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-3 border-t border-line pt-3 text-caption text-body">{mix.conversion}</p>
      {mix.composition.length > 0 ? <CompositionTable rows={mix.composition} caption={t("composition.caption")} /> : null}
    </RailCard>
  );
}

function Searches({ screen, periodKey, specimen }: CardProps) {
  const searches = screen.searches;
  return (
    <RailCard eyebrow={t("overview.searches.title")} tone="sunk" specimen={specimen}>
      {searches.empty ? (
        <p className="m-0 mt-2.5 text-body-sm text-body">{searches.empty}</p>
      ) : (
        <ul className="m-0 mt-2.5 flex list-none flex-col gap-2 p-0">
          {searches.rows.map((row) => (
            <li key={row.key} className="flex items-baseline justify-between gap-3 text-body-sm">
              <OverviewLink href={row.href} figure="search" period={periodKey} className={cn(FOCUS, "min-w-0 truncate text-ink underline-offset-2 hover:underline")}>
                {row.query}
              </OverviewLink>
              <span className="shrink-0 font-mono text-caption tabular-nums text-body">{row.count}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 mt-3 text-caption text-body">{searches.rule}</p>
      {searches.rows.length > 0 ? <p className="m-0 mt-1.5 text-caption text-body">{t("overview.searches.use")}</p> : null}
    </RailCard>
  );
}
