import { prisma } from "@/lib/db/client";
import { Card } from "@/components/structure";
import { StatusBadge, type StatusTone } from "@/components/display/StatusBadge";
import { placeholdersIn, render } from "@/lib/notify/render";
import { t } from "@/lib/i18n";

/**
 * Board 7f — the notification design system.
 *
 * Every template in the database, rendered with plausible values, grouped by
 * event and shown as it will arrive on each channel. Not the gallery: the
 * gallery is components, and these are content rows a staff member will edit
 * in handoff 4. Seeing them together is the only way to notice that two of
 * them say the same thing differently, or that one has no action.
 *
 * A dev surface, like /dev/gallery. It reads the database rather than a
 * fixture so a template added through the admin editor appears here too.
 */
export const metadata = { title: "Notification templates" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, StatusTone> = {
  live: "ok",
  pending_meta: "warn",
  draft: "neutral",
  retired: "neutral",
};

/** The shape of value the product actually passes, for each placeholder. */
const PLAUSIBLE: Record<string, string> = {
  ref: "ENQ-8841",
  quoteRef: "QT-8841-ALMR1",
  summary: "resilient seated gate valves for a chilled water riser",
  neededBy: "14 Sep 2026",
  closesAt: "28 Aug 2026",
  area: "Al Quoz Industrial 1",
  lineCount: "3",
  hours: "2",
  amount: "AED 15,344",
  revision: "2",
  businessName: "Al Marwan Industrial Supplies",
  businessSlug: "al-marwan-industrial-supplies-llc",
  supplierName: "Al Marwan Industrial Supplies",
  buyerFirstName: "Rashid",
  enquiryId: "cmt73h5cr007yddit0mrgfx39",
  shortLink: "businesslistings.ae/l/8841",
  rating: "4",
  documentKind: "Trade licence",
  expiresOn: "12 Nov 2026",
  count: "7",
  value: "AED 84,200",
  days: "3",
};

export default async function NotificationSpecimens() {
  const templates = await prisma.notificationTemplate.findMany({
    orderBy: [{ event: "asc" }, { channel: "asc" }, { version: "desc" }],
  });

  const byEvent = new Map<string, typeof templates>();
  for (const template of templates) {
    const list = byEvent.get(template.event) ?? [];
    list.push(template);
    byEvent.set(template.event, list);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="font-mono text-eyebrow uppercase text-faint">board 7f</p>
      <h1 className="mt-2 font-serif text-h1-serif text-ink">{t("specimens.title")}</h1>
      <p className="mt-2 max-w-[var(--measure-prose)] text-prose text-prose">
        {t("specimens.lede")}
      </p>

      <div className="mt-8 space-y-8">
        {[...byEvent.entries()].map(([event, group]) => (
          <section key={event}>
            <h2 className="font-mono text-eyebrow uppercase text-muted">{event}</h2>
            <div className="mt-2 space-y-3">
              {group.map((template) => {
                const params: Record<string, string> = {};
                for (const name of placeholdersIn(template)) {
                  params[name] = PLAUSIBLE[name] ?? `{${name}}`;
                }

                let rendered: ReturnType<typeof render> | null = null;
                let failure: string | null = null;
                try {
                  rendered = render(template, params);
                } catch (error) {
                  failure = error instanceof Error ? error.message : "could not render";
                }

                return (
                  <Card key={template.id} padded as="article">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-caption text-muted">
                        {template.channel} · v{template.version}
                      </span>
                      <StatusBadge tone={STATUS_TONE[template.status] ?? "neutral"} size="sm" shape="chip">
                        {template.status}
                      </StatusBadge>
                      {template.metaTemplateName ? (
                        <span className="font-mono text-caption text-faint">
                          {template.metaTemplateName}
                        </span>
                      ) : null}
                    </p>

                    {failure ? (
                      <p className="mt-2 rounded-ctl border border-bad-line bg-bad-surface px-3 py-2 text-body-sm text-bad-ink">
                        {failure}
                      </p>
                    ) : (
                      <>
                        {rendered!.subject ? (
                          <p className="mt-2 text-body-sm font-medium text-ink">{rendered!.subject}</p>
                        ) : null}
                        <p className="mt-1 max-w-[var(--measure-prose)] text-body-sm text-prose">
                          {rendered!.body}
                        </p>
                        {rendered!.actionLabel || rendered!.actionPath ? (
                          <p className="mt-2 text-caption text-muted">
                            {rendered!.actionLabel ?? t("specimens.no_action")}{" "}
                            <span className="font-mono text-faint">{rendered!.actionPath}</span>
                          </p>
                        ) : null}
                      </>
                    )}
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
