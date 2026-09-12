import { redirect } from "next/navigation";
import { PageEvent } from "@/components/telemetry";
import { credentialsStateFor } from "@/lib/credentials/service";
import { CREDENTIAL_KINDS, promiseFor } from "@/lib/credentials/kinds";
import { setupHubState, type SetupHubState } from "@/lib/setup/service";
import { CREDENTIAL_TARGET, WEIGHTS } from "@/lib/metrics/profile-strength";
import { DOCUMENT_TYPES } from "@/lib/storage";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { requireSellerSeat, type SellerSeat } from "../../_shell";
import { TaskChrome, type TaskSegment } from "../_task-chrome";
import {
  CredentialsWorkspace,
  type CredentialTile,
  type KindOption,
  type SuggestionTile,
} from "./CredentialsWorkspace";
import { addCredentialAction, removeCredentialAction, signCredentialUpload } from "./actions";

/**
 * Board `8b-s` — setup task 1 for a seller of work, where photographs were.
 *
 * A warehouse photograph is evidence for a parts supplier: it shows the stock
 * exists and somebody is standing behind it. For an audit practice a picture of
 * the office proves nothing a buyer cares about — the evidence is the FTA agent
 * number, the Ministry of Finance approval, the professional body and the
 * indemnity cover. So credentials lead at 32 points and photographs fall to 4,
 * and this screen is where that inversion lands.
 *
 * ## Four statements that nothing here is required, and none of them decorative
 *
 * The intro, the section note, the closing line and the closing card all say
 * it. That is the spec's own count and it is deliberate: a credentials form on
 * a B2B directory reads like a compliance gate, and a seller who thinks they
 * are being audited abandons the screen. The code underneath has no refusal in
 * it either — see `lib/credentials/service.ts`, where the only two failures are
 * a kind that is not a kind and a business that does not exist.
 *
 * ## Three tiers on the board, two that a row can be in
 *
 * The spec's middle tier, *verifiable on submission*, and its first, *register
 * verified*, are the same statement differing only in **when**. So `WE VERIFY
 * THIS` is rendered as a promise about a field, from `promiseFor`, and never as
 * a stored state — and it is suppressed entirely when no register is
 * configured, which is every deployment today. A saved row is either checked
 * against a register or it is the seller's own word, and
 * `lib/credentials/kinds.ts` is where that is enforced.
 *
 * ## What is not built, and why that is the design
 *
 * No review queue for the unverifiable kinds (B2 — a moderator looking at a PDF
 * of an insurance schedule is not verification), no expiry tracking, no
 * reminders, no renewal chasing (B5, AC5 — `3e-s` was cut for this reason), and
 * no re-upload of the trade licence (B4 — it is on the business row and renders
 * read-only).
 */
export const metadata = { title: t("credentials.meta_title") };
export const dynamic = "force-dynamic";

/** Board 8b: owner and manager. The same seats the hub itself is for. */
function mayEditCredentials(seat: SellerSeat): boolean {
  return seat.actor.roles.some((role) => role === "seller_owner" || role === "seller_manager");
}

export default async function SetupCredentialsPage() {
  const seat = await requireSellerSeat();
  if (!mayEditCredentials(seat)) redirect("/dashboard/leads");

  const [state, hub] = await Promise.all([
    credentialsStateFor(seat.businessId),
    setupHubState(seat.businessId),
  ]);
  if (!state || !hub) redirect("/dashboard");
  /*
     Reachable directly rather than only through the hub — and a listing that is
     not on the directory has nothing for these credentials to appear on. The
     same guard the photographs task carries.
  */
  if (!hub.live) redirect("/onboarding/locations");

  /*
     Completion, not position. The task in hand fills pro-rata as credentials
     land; the other three fill only when their own condition is met.
  */
  const segments: TaskSegment[] = hub.tasks.map((task) =>
    task.id === "credentials"
      ? { id: task.id, filled: Math.min(1, state.held.length / CREDENTIAL_TARGET) }
      : { id: task.id, filled: task.done ? 1 : 0 },
  );

  const held: CredentialTile[] = state.held.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: t(`credentials.kind.${row.kind}` as never),
    identifier: row.identifier,
    issuer: row.issuer,
    expires: row.expiresOn === null ? null : formatDate(row.expiresOn),
    filename: row.document?.filename ?? null,
    verified: row.trust === "register_verified",
    verifiedBy: row.verifiedBy,
    verifiedOn: row.verifiedOn === null ? null : formatDate(row.verifiedOn),
  }));

  const suggestions: SuggestionTile[] = state.suggestions.map((row) => ({
    kind: row.kind,
    name: t(`credentials.kind.${row.kind}` as never),
    /*
       Rounded once, here, so the copy and the floor cannot disagree. A rate of
       0.251 is above the floor and reads "25%", which is the honest rendering
       of a number the seller is being asked to act on.
    */
    rate: Math.round(row.rate * 100),
    category: state.category,
  }));

  const kinds: KindOption[] = CREDENTIAL_KINDS.map((kind) => {
    const promise = promiseFor(kind);
    return {
      value: kind,
      label: t(`credentials.kind.${kind}` as never),
      ...(promise === null ? {} : { promise: t(`credentials.tier.${promise}` as never) }),
    };
  });

  const earned = hub.levers.find((lever) => lever.key === "credentials")?.earned ?? 0;

  return (
    <TaskChrome
      name={t("credentials.eyebrow")}
      segments={segments}
      openCount={hub.openCount}
      done={state.held.length >= CREDENTIAL_TARGET}
    >
      <PageEvent name="setup_task_started" props={{ task: "credentials" }} />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <div>
            <h2 className="text-h1 text-ink">{t("credentials.title")}</h2>
            <p className="mt-2 max-w-prose text-body-sm text-body">{t("credentials.intro")}</p>
          </div>

          <OnFile licence={state.licence} />

          <CredentialsWorkspace
            held={held}
            suggestions={suggestions}
            kinds={kinds}
            registerLive={state.registerLive}
            accept={DOCUMENT_TYPES.join(",")}
            sign={signCredentialUpload}
            add={addCredentialAction}
            remove={removeCredentialAction}
          />

          {/*
             Points earned, not points available. The number a seller wants at
             the bottom of an optional task is what they have just banked, and
             it comes off the same lever the hub's meter reads so the two
             screens cannot disagree.
          */}
          <p className="text-caption text-muted">
            {held.length === 0
              ? t("credentials.earned_none")
              : t("credentials.earned", {
                  count: held.length,
                  formatted: formatCount(held.length),
                  points: formatCount(earned),
                })}
          </p>
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-3.5 lg:w-[352px]">
          <FourTasks hub={hub} />
          <div className="rounded-card border border-line bg-paper-sunk px-5 py-4">
            <p className="font-mono text-eyebrow uppercase text-muted">
              {t("credentials.nothing_eyebrow")}
            </p>
            <p className="mt-2 text-caption text-body">{t("credentials.nothing_body")}</p>
          </div>
        </aside>
      </div>
    </TaskChrome>
  );
}

/* ── Already on file ─────────────────────────────────────────────────────── */

/**
 * The trade licence, read-only — B4, AC4.
 *
 * It arrives from onboarding verification and is not a `Credential` row: it
 * lives on `Business` as a number, an authority, an expiry and a `verifiedAt`,
 * and a row beside it would be a second source of truth for the only fact on
 * this listing anybody has actually checked. Re-asking for it reads as the
 * system not remembering.
 *
 * The unchecked line is the honest half. A listing can be live with a licence
 * no `ops_lead` has looked at yet, and rendering "verified against the issuing
 * authority" over it would be the badge claiming work nobody has done.
 */
function OnFile({ licence }: { licence: NonNullable<Awaited<ReturnType<typeof credentialsStateFor>>>["licence"] }) {
  const checked = licence.verifiedOn !== null;

  return (
    <section aria-labelledby="credentials-on-file">
      <h3 id="credentials-on-file" className="font-mono text-eyebrow uppercase text-faint">
        {t("credentials.on_file_eyebrow")}
      </h3>
      <div className="mt-2 rounded-card border border-line-strong bg-card px-4 py-3.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-body-sm font-medium text-ink">
            {t("credentials.licence_row", { number: licence.number })}
          </p>
          {checked && (
            <span className="font-mono text-eyebrow uppercase text-moss">
              {t("credentials.from_register")}
            </span>
          )}
        </div>
        <p className="mt-1 text-caption text-muted">
          {checked
            ? t("credentials.licence_checked", {
                authority: licence.authority,
                expiry: formatDate(licence.expiresOn),
                checked: formatDate(licence.verifiedOn as Date),
              })
            : t("credentials.licence_unchecked", {
                authority: licence.authority,
                expiry: formatDate(licence.expiresOn),
              })}
        </p>
      </div>
    </section>
  );
}

/* ── The four tasks ──────────────────────────────────────────────────────── */

/**
 * The sidebar table — B8, AC7.
 *
 * Every number here is looked up rather than typed: each row's points are its
 * own lever's whole weight from the `8a-s` table, and the total is their sum.
 * The board draws 32 / 20 / 8 / 4 totalling 64, and so does this — but because
 * it read them, not because somebody copied them across two screens.
 *
 * The estimates are `setupBoard`'s, which is why services reads four minutes
 * where the render draws ten. `8a-s`'s hero says fifteen minutes across the
 * four, and 5 + 10 + 2 + 4 is not fifteen; the render's figure is the stale
 * half of a pair the same seller sees two clicks apart.
 */
function FourTasks({ hub }: { hub: SetupHubState }) {
  const weightOf = (lever: string) => hub.levers.find((row) => row.key === lever)?.total ?? 0;
  const total = hub.tasks.reduce((sum, task) => sum + weightOf(task.lever), 0);

  return (
    <section aria-labelledby="credentials-tasks" className="rounded-card border border-line bg-card px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="credentials-tasks" className="text-body-sm font-medium text-ink">
          {t("credentials.tasks_title")}
        </h3>
        <span className="font-mono text-caption tabular-nums text-muted">
          {t("credentials.tasks_total", { points: formatCount(total) })}
        </span>
      </div>

      <ol className="mt-3 flex list-none flex-col gap-2.5">
        {hub.tasks.map((task, index) => (
          <li key={task.id} className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-pill bg-track font-mono text-eyebrow tabular-nums text-muted"
            >
              {formatCount(index + 1)}
            </span>
            <div className="min-w-0">
              <p className="text-caption font-medium text-ink">
                {t(`credentials.task.${task.id}` as never)}
              </p>
              <p className="mt-0.5 font-mono text-eyebrow tabular-nums text-muted">
                {t("credentials.task_line", {
                  points: formatCount(weightOf(task.lever)),
                  minutes: formatCount(task.minutes),
                })}
              </p>
            </div>
          </li>
        ))}
      </ol>

      {/*
         The inversion, stated where it provokes the question. Both figures are
         the weight tables' own — `WEIGHTS.photos` for goods and the services
         photographs lever for this seller — so the sentence cannot drift from
         the arithmetic it is explaining.
      */}
      <p className="mt-3 text-caption text-muted">
        {t("credentials.photos_note", {
          goods: formatCount(WEIGHTS.photos),
          services: formatCount(weightOf("photos")),
        })}
      </p>
    </section>
  );
}
