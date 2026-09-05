import Link from "next/link";
import { Eyebrow } from "@/components/display";
import { Card } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { QUEUE_OWNER, type Queue } from "@/lib/content/queues";
import { t } from "@/lib/i18n";

/**
 * Board 6f §7 — `count · condition · owner · action`, five times.
 *
 * Three shipped specs were written against "the editorial queue on 6f" before
 * this board had one. A queue with no owner is not a queue, so the owner is on
 * every card; a count with no link is a number that makes somebody go and look,
 * so every row opens something.
 *
 * The owner is a role. A person's name in a constant is a claim about who is
 * employed here that nothing verifies and that costs a deploy to correct.
 */
export function Queues({ queues }: { queues: readonly Queue[] }) {
  return (
    <section aria-labelledby="queues-heading">
      <h2 id="queues-heading" className="text-h2 text-ink">
        {t("queues.title")}
      </h2>

      <ul className="mt-[var(--gutter)] grid gap-[var(--gutter)] md:grid-cols-2 xl:grid-cols-3">
        {queues.map((queue) => (
          <Card key={queue.key} as="li">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-body-sm text-ink">{t(`queues.${queue.key}` as never)}</h3>
              <span className="font-mono text-h3 tabular-nums text-ink">
                {formatCount(queue.count)}
              </span>
            </div>
            <Eyebrow as="p" className="mt-1">
              {t("queues.owner", { owner: t(`matrix.owner.${QUEUE_OWNER[queue.key]}` as never) })}
            </Eyebrow>

            {queue.rows.length === 0 ? (
              <p className="mt-2.5 text-caption text-muted">{t("queues.clear")}</p>
            ) : (
              <ul className="mt-2.5 flex flex-col gap-1.5">
                {queue.rows.map((row) => (
                  <li key={`${queue.key}:${row.label}`}>
                    <Link
                      href={row.href}
                      className="rounded-tag text-caption text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      {row.label}
                    </Link>
                    <span className="block text-caption text-muted">{row.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </ul>
    </section>
  );
}
