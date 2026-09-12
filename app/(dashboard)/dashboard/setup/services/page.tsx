import { redirect } from "next/navigation";
import Link from "next/link";
import { PageEvent } from "@/components/telemetry";
import { ScopeTable } from "@/components/domain";
import { setupServicesStateFor } from "@/lib/services/setup";
import { publicServiceFor } from "@/lib/services/service";
import { ENGAGEMENT_TYPES, type RequiredField } from "@/lib/services/scope-sheet";
import { namedGaps } from "@/lib/services/gaps";
import { setupHubState } from "@/lib/setup/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { requireSellerSeat, type SellerSeat } from "../../_shell";
import { TaskChrome, type TaskSegment } from "../_task-chrome";
import {
  SetupServicesWorkspace,
  type ServiceRowView,
  type SheetCardView,
} from "./SetupServicesWorkspace";
import { addServiceAction, chooseSheetAction, patchRowAction, seedListAction } from "./actions";

/**
 * Board `8c-s` — setup task 2, and the screen that started the service track.
 *
 * The goods task 2 asks for a spec template and ten products. A tax practice
 * has four services and will never have ten, so the single highest-value task
 * on the hub could not be finished at all. That is not a copy problem — it is a
 * different task with a different bar, a different completion rule and a
 * different justification — and noticing this screen could not be patched is
 * what produced the whole variant track.
 *
 * ## Two steps, and the order is load-bearing
 *
 * The sheet decides which rows exist, so a service added before one is chosen
 * has nowhere to put its values. Step 2 is inert until `scopeSheetFamilyId` is
 * set, and the server refuses too: a disabled fieldset is a hint, not a gate.
 *
 * ## Publishing and counting are two rules
 *
 * A thin service is live, findable and excluded from the three — `3f-s`'s rule
 * in the seller's terms. `mayPublish()` still returns true unconditionally,
 * because gating publication on a score makes sellers type "TBC" into six
 * fields; but a task that counted every live row would close on three services
 * carrying nothing but a name. The bar is four of six and it lives in one
 * constant, `COUNTING_BAR`.
 *
 * ## D11 was closed as no, so nothing here is blocked
 *
 * The handoff calls this board *partially blocked on D11* and lists three
 * availability affordances to leave out. D11 closed as **no** on 11 Sep
 * (`docs/services-build-plan.md` §3): the `TAKING WORK` column, the *Waitlist
 * is a real answer* card, the `1g-s` chip and `3g-s`'s `Capacity` field all
 * went at once, and none of them exists in this tree to leave out. B9 and
 * criterion 10 are satisfied by construction.
 */
export const metadata = { title: t("setup_services.meta_title") };
export const dynamic = "force-dynamic";

/** Board 8b: owner and manager, the seats the hub itself is for. */
function mayEditServices(seat: SellerSeat): boolean {
  return seat.actor.roles.some((role) => role === "seller_owner" || role === "seller_manager");
}

export default async function SetupServicesPage() {
  const seat = await requireSellerSeat();
  if (!mayEditServices(seat)) redirect("/dashboard/leads");

  const [state, hub] = await Promise.all([
    setupServicesStateFor(seat.businessId),
    setupHubState(seat.businessId),
  ]);
  if (!state || !hub) redirect("/dashboard");
  if (!hub.live) redirect("/onboarding/locations");

  /*
     Completion, not position. The task in hand fills pro-rata on the services
     that count; the other three fill only when their own condition is met.
  */
  const segments: TaskSegment[] = hub.tasks.map((task) =>
    task.id === "services"
      ? { id: task.id, filled: Math.min(1, state.task.counting / state.target) }
      : { id: task.id, filled: task.done ? 1 : 0 },
  );

  const sheets: SheetCardView[] = state.sheets.map((sheet) => ({
    id: sheet.id,
    name: sheet.name,
    rows: sheet.shape.rows,
    required: sheet.shape.required,
    filterable: sheet.shape.filterable,
    usedBy: sheet.shape.usedBy,
    matchRank: sheet.matchRank,
    isDefault: sheet.isDefault,
    chosen: sheet.chosen,
  }));

  const rows: ServiceRowView[] = state.rows.map((row) => ({
    id: row.id,
    name: row.name,
    engagementType: row.engagementType,
    feeBasis: row.feeBasis,
    turnaround: row.turnaround,
    live: row.live,
    filled: row.filled,
    total: row.total,
    counts: row.counts,
    href: `/dashboard/services/${row.id}`,
  }));

  const chosen = state.sheets.find((sheet) => sheet.chosen) ?? null;
  const earned = hub.levers.find((lever) => lever.key === "services")?.earned ?? 0;
  const credentialWeight = hub.levers.find((lever) => lever.key === "credentials")?.total ?? 0;
  const serviceWeight = hub.levers.find((lever) => lever.key === "services")?.total ?? 0;

  return (
    <TaskChrome
      name={t("setup_services.eyebrow")}
      segments={segments}
      openCount={hub.openCount}
      done={state.task.done}
    >
      <PageEvent name="setup_task_started" props={{ task: "services" }} />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <SetupServicesWorkspace
            sheets={sheets}
            chosenFamilyId={state.chosenFamilyId}
            feeBases={state.family.feeBases.map((basis) => ({
              value: basis.key,
              label: basis.label,
            }))}
            engagementTypes={ENGAGEMENT_TYPES.map((value) => ({
              value,
              label: t(`engagement.${value}` as "engagement.ongoing_contract"),
            }))}
            rows={rows}
            seedTrade={chosen && !chosen.isDefault ? chosen.name : null}
            seedCount={chosen?.common.length ?? 0}
            target={state.target}
            atCap={state.allowance.atCap}
            choose={chooseSheetAction}
            seed={seedListAction}
            add={addServiceAction}
            patch={patchRowAction}
          />

          <Tally state={state} earned={earned} />
          {state.task.thin.map((thin) => (
            <ThinCallout key={thin.id} thin={thin} target={state.target} />
          ))}
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-3.5 lg:w-[352px]">
          <Preview businessId={seat.businessId} rows={state.rows} />

          <div className="rounded-card border border-line bg-card px-5 py-4">
            <p className="text-body-sm font-medium text-ink">{t("setup_services.fee_title")}</p>
            <p className="mt-2 text-caption text-body">{t("setup_services.fee_body")}</p>
          </div>

          {/*
             The question the lower bar provokes, answered before it is asked. A
             seller who has seen the goods hub — or knows somebody with a
             trading licence — will notice their bar is lower and wonder whether
             their listing is worth less.
          */}
          <div className="rounded-card border border-line bg-paper-sunk px-5 py-4">
            <p className="font-mono text-eyebrow uppercase text-muted">
              {t("setup_services.why_three_title", { formatted: formatCount(state.target) })}
            </p>
            <p className="mt-2 text-caption text-body">{t("setup_services.why_three_body")}</p>
          </div>

          <div className="rounded-card border border-line bg-card px-5 py-4">
            <p className="text-body-sm font-medium text-ink">
              {t("setup_services.credentials_title")}
            </p>
            {/*
               Both weights read off the table rather than typed. The board's
               render carried "38 of your 100", which was the figure from before
               the site-visit cut redistributed it; the two levers now sum to 52,
               and this sentence cannot go stale the same way twice.
            */}
            <p className="mt-2 text-caption text-body">
              {t("setup_services.credentials_body", {
                points: formatCount(credentialWeight + serviceWeight),
              })}
            </p>
            <Link
              href="/dashboard/setup/credentials"
              className="mt-3 inline-flex text-caption text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              {t("setup_services.credentials_cta")}
            </Link>
          </div>
        </aside>
      </div>
    </TaskChrome>
  );
}

/* ── The line under the table ────────────────────────────────────────────── */

/**
 * Live and counting, and the screen says both.
 *
 * A seller with three live rows and two counting needs to know why the task has
 * not closed, and a single number cannot tell them. `earned` comes off the same
 * lever the hub's meter reads, so the two screens cannot disagree about what
 * this task has paid.
 */
function Tally({
  state,
  earned,
}: {
  state: NonNullable<Awaited<ReturnType<typeof setupServicesStateFor>>>;
  earned: number;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <p className="text-body-sm text-body">
        {state.task.done
          ? t("setup_services.tally_done", {
              count: state.task.live,
              formatted: formatCount(state.task.live),
            })
          : t("setup_services.tally", {
              count: state.task.live,
              formatted: formatCount(state.task.live),
              toGo: formatCount(state.task.toGo),
            })}
      </p>
      <span className="font-mono text-caption tabular-nums text-muted">
        {t("setup_services.points_so_far", { points: formatCount(earned) })}
      </span>
    </div>
  );
}

/* ── The thin-service callout ────────────────────────────────────────────── */

/**
 * Names the fields — B6, AC5.
 *
 * *"Turnaround and fee basis are the two missing"*, not *"this service is
 * incomplete"*. The seller already knows the row is thin; what they do not know
 * is which of the six would fix it, and a score without an instruction is a nag.
 */
function ThinCallout({
  thin,
  target,
}: {
  thin: {
    id: string;
    name: string;
    filled: number;
    total: number;
    missing: readonly RequiredField[];
  };
  target: number;
}) {
  /*
     The same six labels and the same join `3f-s` uses for its gap line — one
     table in `lib/services/gaps.ts`, because two copies of six field names
     agree only until somebody renames one on one screen.
  */
  const list = namedGaps(thin.missing);

  return (
    <div className="rounded-card border border-warn-line bg-warn-surface px-5 py-4">
      <p className="text-body-sm font-medium text-warn-ink">
        {t("setup_services.thin_title", { name: thin.name })}
      </p>
      <p className="mt-2 max-w-prose text-caption text-body">
        {t("setup_services.thin_body", {
          filled: formatCount(thin.filled),
          total: formatCount(thin.total),
          target: formatCount(target),
          missing: list,
          verb:
            thin.missing.length === 1
              ? t("setup_services.thin_verb_one")
              : t("setup_services.thin_verb_many"),
        })}
      </p>
    </div>
  );
}

/* ── The live preview ────────────────────────────────────────────────────── */

/**
 * A real render of `1g-s` — B11, AC9.
 *
 * `ScopeTable` is the component the public service page mounts, extracted for
 * exactly this: *"if the two drift, the preview is lying at the worst
 * moment"*. It is fed from `publicServiceFor`, the public loader, so the
 * preview is not merely the same markup but the same **data path** — including
 * the fact that `indicativeFee` is not in its `select` and therefore cannot
 * reach this pane any more than it can reach the page.
 *
 * The first live service, because a preview of a draft would show a page no
 * buyer can open. Nothing live yet is a real state and says so.
 */
async function Preview({
  businessId,
  rows,
}: {
  businessId: string;
  rows: readonly { id: string; slug: string; live: boolean; name: string }[];
}) {
  const first = rows.find((row) => row.live) ?? null;
  const business = first
    ? await import("@/lib/db/client").then(({ prisma }) =>
        prisma.business.findUnique({ where: { id: businessId }, select: { slug: true } }),
      )
    : null;
  const service = first && business ? await publicServiceFor(business.slug, first.slug) : null;

  return (
    <div className="rounded-card border border-line-strong bg-card px-5 py-4">
      <p className="font-mono text-eyebrow uppercase text-muted">
        {t("setup_services.preview_eyebrow")}
      </p>

      {service === null ? (
        <p className="mt-2 text-caption text-muted">{t("setup_services.preview_none")}</p>
      ) : (
        <>
          <p className="mt-2 text-body-sm font-medium text-ink">{service.name}</p>
          <div className="mt-2.5">
            <ScopeTable
              rows={service.rows}
              filled={service.filled}
              total={service.total}
              density="preview"
            />
          </div>
          {/*
             Where a product page shows a price. `1g-s` renders the same words
             for the same reason: the fee basis is public and the number is not.
          */}
          <p className="mt-2.5 font-mono text-eyebrow uppercase text-faint">
            {t("setup_services.preview_fee")}
          </p>
          <p className="mt-2 text-caption text-muted">
            {t("setup_services.preview_note", { name: service.name })}
          </p>
        </>
      )}
    </div>
  );
}
