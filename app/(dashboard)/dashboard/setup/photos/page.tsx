import { redirect } from "next/navigation";
import { PageEvent } from "@/components/telemetry";
import { photoBoardFor } from "@/lib/photos/service";
import { photoSlot, slotsFor } from "@/lib/photos/slots";
import { setupHubState } from "@/lib/setup/service";
import { IMAGE_TYPES } from "@/lib/storage";
import { MIN_EDGE, MAX_STORED_BYTES } from "@/lib/images/downscale";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { requireSellerSeat, type SellerSeat } from "../../_shell";
import { TaskChrome, type TaskSegment } from "../_task-chrome";
import { PhotoGrid, type PhotoTile, type SlotTile } from "./PhotoGrid";
import {
  attachPhotoAction,
  deletePhotoAction,
  reorderPhotosAction,
  setCoverAction,
  signPhotoUpload,
} from "./actions";

/**
 * Board 8b — setup task 1, photographs.
 *
 * The first and cheapest of the four tasks on the hub, and the one most likely
 * to be done on a phone while standing in the warehouse. Its whole job is to
 * get five usable photographs out of somebody who does not think of themselves
 * as a photographer, which is why the copy leads with "a phone camera is fine"
 * and why the file a seller picks is resized rather than refused.
 *
 * ## What was cut from the render, and why it is recorded here
 *
 * Two things in the exported design do not ship in this phase, and both are the
 * handoff's own instruction rather than a shortcut:
 *
 * - **The WhatsApp intake strip.** §5 says it needs an inbound media webhook, a
 *   per-business intake token and a sender-number match, and that if the
 *   webhook is not in this phase the strip must be cut — because "they'll
 *   appear here" is a specific claim about this screen and cannot ship as a
 *   promise that quietly does nothing. Nothing inbound exists: Bird is
 *   outbound-only here and the one webhook this product has is Supabase's.
 * - **The amber quality tile** — "Blurry and dark — replace it?". §4's four
 *   measurements are cut with it. §8 says the blur threshold needs calibrating
 *   against real UAE warehouse photographs, because a dim unit lit by one
 *   fluorescent strip is normal and must not be flagged; shipping an
 *   uncalibrated one nags a seller about a photograph they chose, which §4 says
 *   is how the task gets abandoned.
 *
 * The green line under a tile stays, and it is the **slot's** static copy —
 * never an assessment of the pixels. §4 spends half its length on that
 * distinction because one visual treatment hides it. See `lib/photos/slots.ts`.
 */
export const metadata = { title: "Photos" };
export const dynamic = "force-dynamic";

/** Board 8b: owner and manager. The same seats the hub itself is for. */
function mayEditPhotos(seat: SellerSeat): boolean {
  return seat.actor.roles.some((role) => role === "seller_owner" || role === "seller_manager");
}

export default async function SetupPhotosPage() {
  const seat = await requireSellerSeat();
  if (!mayEditPhotos(seat)) redirect("/dashboard/leads");

  const [board, hub] = await Promise.all([
    photoBoardFor(seat.businessId),
    setupHubState(seat.businessId),
  ]);
  if (!hub) redirect("/dashboard");
  // Reachable directly rather than only through the hub, but a listing that is
  // not on the directory has nothing for these photographs to appear on.
  if (!hub.live) redirect("/onboarding/locations");

  /*
     Completion, not position.

     The task in hand fills pro-rata as work lands; the other three fill only
     when their own done-condition is met. A rail that counted steps would
     re-impose the order board 8a exists to remove.
  */
  const segments: TaskSegment[] = hub.tasks.map((task) =>
    task.id === "photos"
      ? { id: task.id, filled: Math.min(1, board.count / board.target) }
      : { id: task.id, filled: task.done ? 1 : 0 },
  );

  const used = new Set(board.items.map((item) => item.slotKey).filter(Boolean));
  const slots: SlotTile[] = slotsFor()
    .filter((slot) => slot.suggested && !used.has(slot.key))
    .map((slot) => ({ key: slot.key, label: t(slot.labelKey as never) }));

  const tiles: PhotoTile[] = board.items.map((item) => {
    const slot = photoSlot(item.slotKey);
    return {
      id: item.id,
      url: item.url,
      label: slot ? t(slot.labelKey as never) : item.filename,
      ...(slot?.hintKey ? { hint: t(slot.hintKey as never) } : {}),
      isCover: item.isCover,
      isLogo: item.isLogo,
    };
  });

  return (
    <TaskChrome
      name={t("photos.eyebrow")}
      segments={segments}
      openCount={hub.openCount}
      done={board.done}
    >
      <PageEvent name="setup_task_started" props={{ task: "photos" }} />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <div>
            <h2 className="text-h1 text-ink">{t("photos.title")}</h2>
            <p className="mt-2 max-w-prose text-body-sm text-body">{t("photos.intro")}</p>
          </div>

          {board.count > 0 && <Progress board={board} />}

          <PhotoGrid
            tiles={tiles}
            slots={slots}
            canAdd={!board.atCap}
            accept={IMAGE_TYPES.join(",")}
            labels={{
              cover: t("photos.cover"),
              makeCover: t("photos.make_cover"),
              remove: t("photos.remove"),
              moveUp: t("photos.move_up"),
              moveDown: t("photos.move_down"),
              logo: t("photos.logo_tag"),
              suggested: t("photos.suggested"),
              add: t("photos.add"),
              reorderHint: t("photos.reorder_hint"),
              errorUnreadable: t("photos.error.unreadable"),
              errorTooSmall: t("photos.error.too_small", {
                edge: formatCount(MIN_EDGE),
                min: formatCount(MIN_EDGE),
              }),
              errorTooLarge: t("photos.error.too_large", {
                mb: formatCount(Math.round(MAX_STORED_BYTES / (1024 * 1024))),
              }),
              errorUploadFailed: t("photos.error.upload_failed"),
            }}
            sign={signPhotoUpload}
            attach={attachPhotoAction}
            makeCover={setCoverAction}
            remove={deletePhotoAction}
            reorder={reorderPhotosAction}
          />

          <CapLine board={board} />
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-3.5 lg:w-[352px]">
          <WhatWorks />
          <div className="rounded-card border border-line bg-paper-sunk px-5 py-4">
            <p className="text-body-sm font-medium text-ink">{t("photos.where_title")}</p>
            <p className="mt-2 text-caption text-body">{t("photos.where_body")}</p>
          </div>
        </aside>
      </div>
    </TaskChrome>
  );
}

/* ── The bar, the count and the points earned so far ─────────────────────── */

function Progress({ board }: { board: Awaited<ReturnType<typeof photoBoardFor>> }) {
  const pct = Math.min(100, Math.round((board.count / board.target) * 100));

  return (
    <div className="rounded-card border border-line-strong bg-card px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body-sm font-medium text-ink">
          {board.done
            ? t("photos.complete")
            : t("photos.progress", {
                count: board.count,
                formatted: formatCount(board.count),
                target: formatCount(board.target),
              })}
        </span>
        {/*
          Pro-rata on count, from the photographs lever's own weight rather than
          a number typed here — so the chip and the meter on the hub cannot
          drift apart. §2: the non-logo rule scores nothing, it gates.
        */}
        <span className="font-mono text-caption tabular-nums text-muted">
          {t("photos.points_so_far", { points: formatCount(board.pointsSoFar) })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t("photos.eyebrow")}
        aria-valuenow={board.count}
        aria-valuemin={0}
        aria-valuemax={board.target}
        className="mt-2.5 h-1.5 w-full overflow-hidden rounded-pill bg-track"
      >
        <div className="h-full rounded-pill bg-moss" style={{ width: `${pct}%` }} />
      </div>

      {/*
        The gate, stated only where it blocks. A seller who has five
        photographs and three of them are the logo needs to know why the task
        has not closed; a seller at two photographs does not need the rule yet.
      */}
      {board.count >= board.target && board.nonLogo < board.nonLogoTarget && (
        <p className="mt-2.5 text-caption text-warn-ink">
          {t("photos.non_logo_short", {
            count: board.nonLogoTarget - board.nonLogo,
            formatted: formatCount(board.nonLogoTarget - board.nonLogo),
          })}{" "}
          {t("photos.non_logo_why")}
        </p>
      )}
    </div>
  );
}

/* ── The cap, stated rather than sold ────────────────────────────────────── */

function CapLine({ board }: { board: Awaited<ReturnType<typeof photoBoardFor>> }) {
  // Board 8b: a Free plan at its limit shows the cap, not an upgrade wall.
  if (board.cap === null || board.planName === null) return null;
  if (!board.atCap && (board.capRemaining ?? 0) > 5) return null;

  return (
    <p className="text-caption text-muted">
      {board.atCap
        ? t("photos.at_cap", {
            count: board.cap,
            formatted: formatCount(board.cap),
            plan: board.planName,
          })
        : t("photos.cap_left", {
            count: board.capRemaining ?? 0,
            formatted: formatCount(board.capRemaining ?? 0),
            plan: board.planName,
          })}
    </p>
  );
}

/* ── What works ──────────────────────────────────────────────────────────── */

function WhatWorks() {
  /*
     "Stock photos or renders — we remove these" is a policy statement, enforced
     by moderation after publish. §4 is explicit that this screen must not claim
     to detect it, and nothing here does — there is no content recognition in
     this build at all.
  */
  const yes = [
    t("photos.works.stock"),
    t("photos.works.signage"),
    t("photos.works.people"),
  ];
  const no = [t("photos.works.no_stock_photos"), t("photos.works.no_screenshots")];

  return (
    <div className="rounded-card border border-line bg-card px-5 py-4">
      <p className="font-mono text-eyebrow uppercase text-muted">{t("photos.works_eyebrow")}</p>
      <ul className="mt-3 flex list-none flex-col gap-2.5">
        {yes.map((line) => (
          <li key={line} className="flex gap-2.5 text-caption text-body">
            <span aria-hidden="true" className="shrink-0 text-ok-ink">
              ✓
            </span>
            {line}
          </li>
        ))}
        {no.map((line) => (
          <li key={line} className="flex gap-2.5 text-caption text-body">
            <span aria-hidden="true" className="shrink-0 text-bad-ink">
              ✗
            </span>
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
