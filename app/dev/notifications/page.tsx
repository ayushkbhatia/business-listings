import { prisma } from "@/lib/db/client";
import { Card } from "@/components/structure";
import { StatusBadge, type StatusTone } from "@/components/display/StatusBadge";
import type { NotificationEvent } from "@/lib/db/generated/enums";
import { render } from "@/lib/notify/render";
import { isEmitted, sampleParams } from "@/lib/notify/params";
import { siteUrl } from "@/lib/site";
import { t, type MessageKey } from "@/lib/i18n";

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

/**
 * Which versions are worth a specimen — task T7.4, prompt P-10.
 *
 * The page rendered every version ever saved, with its own 22-key map of
 * sample values; 25 of the 41 placeholders the events supply were missing from
 * it and printed raw as `{approver}`, `{planName}`, `{quotes}`. A page whose
 * job is to show how a message arrives showed half of them broken, and the
 * breakage was the page's, not the template's.
 *
 * Now the values are `sampleParams` — the same fixture board 12g's preview and
 * `Send test to me` use, which `params.test.ts` holds total over every event's
 * declared placeholders — and only the versions that mean something: what
 * sends, what is waiting on Meta, and what is drafted. A retired or replaced
 * version is history, and 12g's history table is where history is read.
 */
const SHOWN = ["live", "pending_meta", "draft"] as const;

export default async function NotificationSpecimens() {
  const origin = siteUrl();
  const templates = await prisma.notificationTemplate.findMany({
    where: { status: { in: [...SHOWN] } },
    orderBy: [{ event: "asc" }, { channel: "asc" }, { kind: "asc" }, { version: "desc" }, { id: "asc" }],
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
                /*
                   An event nothing emits declares no placeholders, so there is
                   nothing to fill its body with. The old page invented values
                   for it; this one shows the body as written and says why —
                   a specimen of a message nobody is sent.
                */
                const event = template.event as NotificationEvent;
                if (!isEmitted(event)) {
                  return (
                    <Card key={template.id} padded as="article">
                      <p className="font-mono text-caption text-muted">
                        {template.channel} · v{template.version} · {t(`notifications.kind.${template.kind}` as MessageKey)}
                      </p>
                      <p className="mt-2 text-caption text-muted">{t("specimens.dormant")}</p>
                      <p className="mt-1 max-w-[var(--measure-prose)] whitespace-pre-line font-mono text-caption text-body">
                        {template.body}
                      </p>
                    </Card>
                  );
                }
                const params = sampleParams(event, origin);

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
                      {/* P-10: label the kind, so a goods body and its services twin are not read as one. */}
                      <span className="text-caption text-body">{t(`notifications.kind.${template.kind}` as MessageKey)}</span>
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
