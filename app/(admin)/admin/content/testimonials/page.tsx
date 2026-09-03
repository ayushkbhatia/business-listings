import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { TESTIMONIAL_MIN_WORDS, testimonialRows } from "@/lib/content/testimonials";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { publishQuote, removeQuote, saveQuote } from "./actions";
import { TestimonialEditor, type TestimonialRowView } from "./TestimonialEditor";

/**
 * The quotes on `/for-buyers` and `/list-your-business`.
 *
 * The rest of both pages is counted from the database and is not editable here
 * — deliberately. A screen that let somebody type the supplier count would be a
 * screen that let somebody type a supplier count that is not true, and the
 * whole proposition of a verification directory is that we do not do that.
 */

export const dynamic = "force-dynamic";

export default async function TestimonialsPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const [rows, badges] = await Promise.all([testimonialRows(), getAdminNavBadges(seat)]);

  const views: TestimonialRowView[] = rows.map((row) => ({
    id: row.id,
    audience: row.audience,
    body: row.body,
    attribution: row.attribution,
    context: row.context ?? "",
    sortOrder: row.sortOrder,
    published: row.published,
    words: row.words,
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/content/testimonials"
      title={t("testimonial.title")}
      eyebrow={t("nav.content_testimonials")}
      meta={
        <span className="text-caption text-muted">
          {t("testimonial.published")} · {views.filter((row) => row.published).length}
        </span>
      }
    >
      <p className="mb-[var(--gutter)] max-w-prose text-body-sm text-muted">{t("testimonial.lede")}</p>

      <TestimonialEditor
        rows={views}
        minWords={TESTIMONIAL_MIN_WORDS}
        save={saveQuote}
        publish={publishQuote}
        remove={removeQuote}
      />
    </AdminPage>
  );
}
