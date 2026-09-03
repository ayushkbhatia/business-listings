import "server-only";
import { unstable_cache } from "next/cache";
import type { TestimonialAudience } from "@/lib/db/generated/enums";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";

/**
 * The quotes on `/for-buyers` and `/list-your-business`.
 *
 * Everything else those two pages say is measured — supplier counts, verified
 * share, emirates, response times — and comes from `getDirectoryStats` and the
 * home-page queries. This is the one part that is somebody's opinion, so it is
 * the one part that needs a person's name on it and a screen to write it in.
 *
 * Two rules the service owns:
 *
 *   1. **Attribution is required.** A quote with no name is the platform
 *      talking about itself in a borrowed voice. §08 will not let a trust
 *      signal do that, and `verification_tier` exists because we do not take
 *      unattributed word for anything.
 *   2. **A quote publishes above a word floor.** Not the guide floor — a
 *      testimonial is not an article — but a floor all the same, because four
 *      words in quotation marks reads as filler and costs the page more than
 *      the empty state would.
 *
 * Per `CLAUDE.md`, these live in the database rather than in a constant: a
 * quote written through the admin costs a revalidation, and one written into
 * `lib/` costs a build, a deploy and a cold cache for every page on the site.
 */

export const TESTIMONIAL_CACHE_TAG = "entry-testimonials";

/** Words, not characters. The number is small on purpose — it stops a slogan,
 *  it does not commission an essay. */
export const TESTIMONIAL_MIN_WORDS = 12;

const HOUR_S = 3600;

export type TestimonialRefusal = "not_found" | "too_thin" | "no_attribution" | "no_body";

export type TestimonialResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: TestimonialRefusal; message: string; have?: number; need?: number };

const MESSAGE: Record<TestimonialRefusal, string> = {
  not_found: "That quote is not here.",
  no_body: "A quote needs words in it.",
  too_thin: "",
  no_attribution:
    "Add the name of the person who said it. A quote nobody is willing to sign is not proof of anything.",
};

export interface TestimonialRow {
  id: string;
  audience: TestimonialAudience;
  body: string;
  attribution: string;
  context: string | null;
  sortOrder: number;
  published: boolean;
  words: number;
}

export interface TestimonialInput {
  /** Absent creates; present updates. */
  id?: string;
  audience: TestimonialAudience;
  body: string;
  attribution: string;
  context?: string | null;
  sortOrder?: number;
}

export function testimonialWords(body: string): number {
  const trimmed = body.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

function refuse<T>(error: TestimonialRefusal, extra?: { have: number; need: number }): TestimonialResult<T> {
  if (error === "too_thin" && extra) {
    return {
      // The number, not "too short" — §08, and it is the number somebody acts on.
      ok: false,
      error,
      message: `${extra.have} words. A quote publishes at ${extra.need}.`,
      have: extra.have,
      need: extra.need,
    };
  }
  return { ok: false, error, message: MESSAGE[error] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

async function readPublishedTestimonials(audience: TestimonialAudience) {
  return prisma.testimonial.findMany({
    where: { audience, publishedAt: { not: null } },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, body: true, attribution: true, context: true },
  });
}

/**
 * What an entry page renders. Cached for an hour under one tag, which the
 * admin screen clears on every write.
 *
 * `unstable_cache` rather than `use cache`, matching `lib/db/queries/home.ts`:
 * the newer directive needs `cacheComponents: true`, which is a project-wide
 * switch across all thirty-odd routes and its own piece of work.
 */
export const publishedTestimonials = unstable_cache(readPublishedTestimonials, ["entry-testimonials"], {
  revalidate: HOUR_S,
  tags: [TESTIMONIAL_CACHE_TAG],
});

/** Every quote, draft or not, for the admin screen. */
export async function testimonialRows(): Promise<TestimonialRow[]> {
  const rows = await prisma.testimonial.findMany({
    orderBy: [{ audience: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    audience: row.audience,
    body: row.body,
    attribution: row.attribution,
    context: row.context,
    sortOrder: row.sortOrder,
    published: row.publishedAt !== null,
    words: testimonialWords(row.body),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes. Every one of them audited, with a reason — CLAUDE.md non-negotiable 3.
// ─────────────────────────────────────────────────────────────────────────────

export async function saveTestimonial(
  actor: Actor,
  input: TestimonialInput,
  reason: string,
): Promise<TestimonialResult<{ id: string }>> {
  const body = input.body.trim();
  const attribution = input.attribution.trim();
  const context = input.context?.trim() || null;

  if (body === "") return refuse("no_body");
  if (attribution === "") return refuse("no_attribution");

  const existing = input.id
    ? await prisma.testimonial.findUnique({ where: { id: input.id } })
    : null;
  if (input.id && !existing) return refuse("not_found");

  /*
     The floor applies to a published quote, not to a draft. Somebody writing
     one down before they have the full wording should be able to save it —
     what must not happen is that half-quote reaching a page. `setTestimonialPublished`
     re-checks, so this cannot be got round by saving thin and publishing after.
  */
  const words = testimonialWords(body);
  if (existing?.publishedAt && words < TESTIMONIAL_MIN_WORDS) {
    return refuse("too_thin", { have: words, need: TESTIMONIAL_MIN_WORDS });
  }

  const data = {
    audience: input.audience,
    body,
    attribution,
    context,
    sortOrder: input.sortOrder ?? existing?.sortOrder ?? 0,
  };

  const id = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        subject: existing ? `Testimonial:${existing.id}` : "Testimonial:new",
        reason,
        tx,
      },
      async () => {
        const saved = existing
          ? await tx.testimonial.update({ where: { id: existing.id }, data })
          : await tx.testimonial.create({ data });

        return {
          result: saved.id,
          before: existing
            ? {
                audience: existing.audience,
                body: existing.body,
                attribution: existing.attribution,
                context: existing.context,
                sortOrder: existing.sortOrder,
              }
            : undefined,
          after: data,
        };
      },
    ),
  );

  return { ok: true, id };
}

export async function setTestimonialPublished(
  actor: Actor,
  id: string,
  published: boolean,
  reason: string,
): Promise<TestimonialResult<{ shown: number }>> {
  const existing = await prisma.testimonial.findUnique({ where: { id } });
  if (!existing) return refuse("not_found");

  // Only on the way in. Unpublishing a quote is always allowed, including one
  // that no longer clears the floor.
  if (published) {
    if (existing.attribution.trim() === "") return refuse("no_attribution");
    const words = testimonialWords(existing.body);
    if (words < TESTIMONIAL_MIN_WORDS) {
      return refuse("too_thin", { have: words, need: TESTIMONIAL_MIN_WORDS });
    }
  }

  const shown = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        subject: `Testimonial:${existing.id}`,
        reason,
        tx,
      },
      async () => {
        await tx.testimonial.update({
          where: { id: existing.id },
          data: { publishedAt: published ? new Date() : null },
        });
        const count = await tx.testimonial.count({
          where: { audience: existing.audience, publishedAt: { not: null } },
        });
        return {
          result: count,
          before: { published: existing.publishedAt !== null },
          after: { published, shown: count },
        };
      },
    ),
  );

  return { ok: true, shown };
}

export async function deleteTestimonial(
  actor: Actor,
  id: string,
  reason: string,
): Promise<TestimonialResult<{ audience: TestimonialAudience }>> {
  const existing = await prisma.testimonial.findUnique({ where: { id } });
  if (!existing) return refuse("not_found");

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        subject: `Testimonial:${existing.id}`,
        reason,
        tx,
      },
      async () => {
        await tx.testimonial.delete({ where: { id: existing.id } });
        return {
          result: null,
          before: {
            audience: existing.audience,
            body: existing.body,
            attribution: existing.attribution,
            published: existing.publishedAt !== null,
          },
          after: null,
        };
      },
    ),
  );

  return { ok: true, audience: existing.audience };
}
