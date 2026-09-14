import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClassName } from "@/components/primitives";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { homeRails } from "@/lib/content/home-rails";
import {
  curatedQueries,
  findFeatureCandidates,
  homepageSlots,
  recentlyVerifiedSuggestions,
  searchedTerms,
} from "@/lib/content/homepage";
import { prisma } from "@/lib/db/client";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { ContentTabs } from "../_tabs";
import { HomeCuration } from "./HomeCuration";
import { presentCuration } from "./present";

/**
 * Board 6h — homepage curation.
 *
 * Four slots a person chooses, the chips under the hero, and a map of every
 * rail on the home page so nobody has to read the code to learn which is which.
 * Replaces the 12g panel that toggled which trades the home page led with:
 * that rail computes now, by listing count, and appears on the map as `6c`'s.
 *
 * `homepage.curate`, which is ops lead only (`Q5`).
 */

export const dynamic = "force-dynamic";

export default async function HomeCurationPage({ searchParams }: { searchParams: Promise<{ find?: string | string[] }> }) {
  const seat = await requireStaff();
  if (!can(seat.actor, "homepage.curate")) notFound();

  const raw = (await searchParams).find;
  const find = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 80) ?? "";
  const now = new Date();

  const [slots, chips, rails, candidates, suggestions, businesses, badges] = await Promise.all([
    homepageSlots(now),
    curatedQueries(),
    homeRails(),
    findFeatureCandidates(find, now),
    find ? Promise.resolve([]) : recentlyVerifiedSuggestions(now),
    prisma.business.count({ where: { publishedAt: { not: null }, suspendedAt: null, mergedIntoId: null } }),
    getAdminNavBadges(seat),
  ]);
  const searched = await searchedTerms(chips, now);

  const view = presentCuration(
    { slots, chips, rails, candidates, suggestions, searched, find, businesses, canWrite: true },
    now,
  );

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/content/home"
      title={t("curation.title")}
      eyebrow={t("curation.eyebrow")}
      meta={<span className="font-mono text-eyebrow uppercase text-muted">{view.meta}</span>}
      actions={
        <Link href="/" target="_blank" rel="noopener" className={buttonClassName({ variant: "secondary", size: "sm" })}>
          {t("curation.preview")}
        </Link>
      }
    >
      <ContentTabs active="home" />
      <HomeCuration view={view} />
    </AdminPage>
  );
}
