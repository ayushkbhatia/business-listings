import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import type { SubjectRef } from "@/lib/audit/types";

/**
 * `Held · editorial` — board 6f §States.
 *
 *   *"A page above its floors with copy written but held manually — an explicit
 *    `Held · editorial` state, set by a person, never cleared automatically.
 *    There is currently no way to express 'do not publish this one' and there
 *    will be a reason to at some point."*
 *
 * One writer for both landing classes, because the reason to hold a page has
 * nothing to do with which class it is. Holding takes the page down in the same
 * request — `landingState.live` reads `heldAt` — and unholding does not put it
 * back up: it restores the arithmetic, and the page returns only if the floors
 * agree. That asymmetry is deliberate. A hold is somebody saying no; taking the
 * no away is not the same as saying yes.
 */

export type HoldRefusal = "not_found" | "already_held" | "not_held";

export type HoldResult = { ok: true } | { ok: false; error: HoldRefusal; message: string };

export interface HoldInput {
  actor: Actor;
  /** One of the two, never both. */
  areaId?: string;
  emirate?: string;
  categoryId: string;
  reason: string;
}

export async function holdLandingPage(input: HoldInput, now = new Date()): Promise<HoldResult> {
  return set(input, true, now);
}

export async function releaseLandingPage(input: HoldInput): Promise<HoldResult> {
  return set(input, false, new Date());
}

async function set(input: HoldInput, holding: boolean, now: Date): Promise<HoldResult> {
  const area = input.areaId ?? null;

  const page: {
    heldAt: Date | null;
    category: { slug: string };
    area?: { slug: string };
  } | null = area
    ? await prisma.areaPage.findUnique({
        where: { areaId_categoryId: { areaId: area, categoryId: input.categoryId } },
        select: {
          heldAt: true,
          area: { select: { slug: true } },
          category: { select: { slug: true } },
        },
      })
    : await prisma.emiratePage.findUnique({
        where: {
          emirate_categoryId: {
            emirate: (input.emirate ?? "") as never,
            categoryId: input.categoryId,
          },
        },
        select: { heldAt: true, category: { select: { slug: true } } },
      });

  if (!page) {
    return {
      ok: false,
      error: "not_found",
      message: "There is no page here to hold. Write the copy first — a hold is a decision about a page that exists.",
    };
  }
  if (holding && page.heldAt !== null) {
    return { ok: false, error: "already_held", message: "That page is already held." };
  }
  if (!holding && page.heldAt === null) {
    return { ok: false, error: "not_held", message: "That page is not held." };
  }

  const subject: SubjectRef = page.area
    ? `AreaPage:${page.area.slug}/${page.category.slug}`
    : `EmiratePage:${input.emirate}/${page.category.slug}`;

  const data = holding
    ? { heldAt: now, heldReason: input.reason, heldById: input.actor.id }
    : { heldAt: null, heldReason: null, heldById: null };

  await prisma.$transaction(async (tx) =>
    staffMutation(
      { actor: input.actor, capability: "taxonomy.write", subject, reason: input.reason, tx },
      async () => {
        if (area) {
          await tx.areaPage.update({
            where: { areaId_categoryId: { areaId: area, categoryId: input.categoryId } },
            data,
          });
        } else {
          await tx.emiratePage.update({
            where: {
              emirate_categoryId: {
                emirate: (input.emirate ?? "") as never,
                categoryId: input.categoryId,
              },
            },
            data,
          });
        }
        return { result: null, before: { heldAt: page.heldAt }, after: { heldAt: data.heldAt } };
      },
    ),
  );

  return { ok: true };
}
