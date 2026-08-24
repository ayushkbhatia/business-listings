import "server-only";
import { prisma } from "@/lib/db/client";
import { profileStrength, STRONG_ENOUGH, WEIGHTS } from "@/lib/metrics/profile-strength";
import { measureProfileStrength } from "@/lib/metrics/strength-job";

/**
 * The five-step funnel, and the four tasks after it.
 *
 * Criterion 3 is the one that shapes this module: **the listing is live on Free
 * before the plan screen**. Nobody is blocked behind a paywall, and the plan
 * step is a choice rather than a gate. `goLive` is therefore called at the end
 * of the locations step, not at the end of the funnel.
 *
 * Criterion 4 is the other: the four setup tasks are independent, resumable
 * after logout, and each returns to the hub with profile strength updated.
 * Nothing here stores a "task done" flag — completion is derived from the rows
 * the task creates, so a seller who adds photographs from the media library
 * instead of from the setup task gets the same credit, and a task cannot be
 * marked complete by anything except the work being there.
 */

export const STEPS = ["claim", "verify", "profile", "locations", "plan"] as const;
export type Step = (typeof STEPS)[number];

export const TASKS = ["photos", "products", "team", "visit"] as const;
export type Task = (typeof TASKS)[number];

/**
 * What each task is worth, in the percentage points board 8a states out loud.
 *
 * Read from `WEIGHTS` rather than written again here. Board 8a says what a task
 * is worth and the meter shows the result; two numbers that drifted apart would
 * be a promise the product breaks in front of the person it made it to.
 */
export const TASK_POINTS: Record<Task, number> = {
  photos: WEIGHTS.photos,
  products: WEIGHTS.catalogue,
  team: WEIGHTS.team,
  // A visit is what tier 3 needs; it moves trust rather than strength, so it
  // is worth nothing on this meter and the hub says so instead of implying it.
  visit: 0,
};

export interface TaskState {
  task: Task;
  done: boolean;
  /** What has been done so far, for "3 of 10 photographs". */
  progress: { got: number; target: number };
  points: number;
  /** Honest, from the work involved rather than from a product manager's hope. */
  minutes: number;
}

export interface SetupState {
  tasks: TaskState[];
  strength: number;
  threshold: number;
  /** True once the listing is on the public directory. */
  live: boolean;
  planId: string | null;
}

const MINUTES: Record<Task, number> = {
  photos: 10,
  products: 25,
  team: 3,
  visit: 2,
};

const TARGETS: Record<Task, number> = {
  photos: 6,
  products: 10,
  team: 2,
  visit: 1,
};

/**
 * Where the seller is, derived from rows rather than from flags.
 *
 * A flag would let a task be marked done by something other than the work, and
 * would go stale the moment a seller deleted the photographs afterwards.
 */
export async function setupStateFor(businessId: string): Promise<SetupState> {
  const [business, photos, products, seats, visit] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { profileStrength: true, publishedAt: true, planId: true },
    }),
    prisma.media.count({
      where: { OR: [{ businessId }, { product: { businessId } }], reviewId: null },
    }),
    prisma.product.count({ where: { businessId } }),
    prisma.user.count({ where: { businessId } }),
    prisma.siteVisitRequest.count({ where: { businessId, cancelledAt: null } }),
  ]);

  const got: Record<Task, number> = { photos, products, team: seats, visit };

  return {
    tasks: TASKS.map((task) => ({
      task,
      done: got[task] >= TARGETS[task],
      progress: { got: got[task], target: TARGETS[task] },
      points: TASK_POINTS[task],
      minutes: MINUTES[task],
    })),
    strength: business.profileStrength ?? 0,
    threshold: STRONG_ENOUGH,
    live: business.publishedAt !== null,
    planId: business.planId,
  };
}

export type GoLiveResult = { ok: true; slug: string } | { ok: false; error: string };

/**
 * Put the listing on the directory, on Free.
 *
 * Criterion 3. Called at the end of the locations step, before the plan screen
 * is ever rendered — a supplier who abandons at the pricing table is still
 * listed, still findable, and still receiving enquiries up to the Free cap.
 *
 * Idempotent: `publishedAt` is set once and a second call is a no-op, so a
 * seller stepping back and forward through the funnel does not keep resetting
 * the date their listing went up.
 */
export async function goLive(businessId: string): Promise<GoLiveResult> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { slug: true, publishedAt: true, planId: true, locations: { select: { id: true } } },
  });
  if (!business) return { ok: false, error: "That listing cannot be found." };

  if (business.locations.length === 0) {
    return { ok: false, error: "Add the address buyers should come to before going live." };
  }

  if (!business.publishedAt) {
    await prisma.business.update({
      where: { id: businessId },
      data: {
        publishedAt: new Date(),
        // Free unless they have already chosen. Nobody is blocked behind a
        // paywall, and a null plan is not the same as being on Free.
        ...(business.planId ? {} : { planId: "free" }),
      },
    });
    // At least one location has to be visible, or "live" is a listing with no
    // address a buyer can see.
    await prisma.location.updateMany({
      where: { businessId, published: false },
      data: { published: true },
    });
  }

  return { ok: true, slug: business.slug };
}

/**
 * Recompute strength after a task.
 *
 * Criterion 4 asks that each task returns to the hub with the strength updated.
 * The scheduled job would get there within the hour; a seller who has just
 * uploaded six photographs and sees the same number is a seller who concludes
 * the meter is decorative.
 */
export async function refreshStrength(businessId: string): Promise<number> {
  await measureProfileStrength();
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { profileStrength: true },
  });
  return business.profileStrength ?? 0;
}

/** The meter on board 2c, without a database round trip. */
export { profileStrength, STRONG_ENOUGH };
