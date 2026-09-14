import { Button } from "@/components/primitives";
import { renderMaintenanceDocument, type RenderOptions } from "@/lib/maintenance/document";
import { SPECIMEN_WINDOW } from "@/lib/maintenance/specimen";
import { parseWindow, viewAt, type MaintenanceRecord } from "@/lib/maintenance/window";
import { t } from "@/lib/i18n";
import { ErrorState } from "@/app/_error/ErrorState";
import { Section, States } from "../_kit";

/**
 * Board 13e — the maintenance page in each state its states table documents,
 * and build plan 9.2's unplanned error beside it.
 *
 * Each specimen is the exact document `proxy.ts` serves, in a frame: the page is
 * a whole HTML document with its own stylesheet, and a frame is the only way to
 * show those bytes rather than an imitation of them. Every record goes through
 * `parseWindow` and `viewAt`, so a specimen cannot show a state the proxy would
 * not produce.
 *
 * There is no loading state and no empty state: the page reads nothing, and
 * with no window recorded `/maintenance` is the ordinary 404.
 *
 * The WhatsApp number is the board's specimen — see `lib/maintenance/specimen.ts`.
 */

const DRAWN = SPECIMEN_WINDOW;

const EVERYTHING_DOWN: MaintenanceRecord = {
  ...DRAWN,
  id: "specimen-database",
  work: "database",
  affected: DRAWN.affected.map((row) => ({ ...row, state: "down" as const })),
};

const NOTIFICATION_JOB: MaintenanceRecord = {
  ...DRAWN,
  id: "specimen-notification-job",
  work: "notification_job",
  affected: [
    { system: "search", state: "running" },
    { system: "requirements", state: "running" },
    { system: "quotes", state: "down" },
    { system: "notifications", state: "down" },
  ],
};

const NO_LINE: MaintenanceRecord = { ...DRAWN, id: "specimen-no-line", whatsapp: undefined };

/*
   A window that ended before any clock this gallery will be read on, rendered as
   an open tab saw it mid-window. Its script compares the end with the real clock,
   so it swaps on load — the one specimen that exercises the script rather than
   pinning its result.
*/
const ENDED: MaintenanceRecord = {
  ...DRAWN,
  id: "specimen-ended",
  startsAt: "2026-09-01T02:20:00+04:00",
  endsAt: "2026-09-01T03:00:00+04:00",
};
const ENDED_DURING = new Date("2026-09-01T02:30:00+04:00");

const DURING = new Date("2026-09-20T02:30:00+04:00");
const OVERRUN = new Date("2026-09-20T03:40:00+04:00");

function doc(record: MaintenanceRecord, now: Date, options: RenderOptions = {}): string {
  const parsed = parseWindow(record);
  if (!parsed.ok) throw new Error(`gallery specimen ${record.id} does not parse: ${parsed.errors.join("; ")}`);
  return renderMaintenanceDocument(viewAt(parsed.window, now), { openTabScript: false, ...options });
}

function Frame({ title, html, height = 680 }: { title: string; html: string; height?: number }) {
  return (
    <iframe
      title={title}
      srcDoc={html}
      className="w-full rounded-card border border-line bg-paper"
      style={{ height }}
    />
  );
}

export function MaintenanceGallery() {
  return (
    <Section id="maintenance" title="maintenance" note="13e · the document proxy.ts serves with a 503, and the unplanned error">
      <States label="as drawn" stack>
        <Frame title="Maintenance page, as drawn: search index work, two of four down" html={doc(DRAWN, DURING)} />
      </States>
      <States label="window overruns" stack>
        <Frame title="Maintenance page, past its end time" html={doc(DRAWN, OVERRUN)} />
      </States>
      <States label="open tab, end passed" stack>
        <Frame title="Maintenance page, an open tab after the end time" html={doc(ENDED, ENDED_DURING, { openTabScript: true })} />
      </States>
      <States label="everything down" stack>
        <Frame title="Maintenance page, database work, every row down" html={doc(EVERYTHING_DOWN, DURING)} />
      </States>
      <States label="notification job" stack>
        <Frame title="Maintenance page, notification job work, two rows inverted" html={doc(NOTIFICATION_JOB, DURING)} />
      </States>
      <States label="no line staffed" stack>
        <Frame title="Maintenance page with no WhatsApp line" html={doc(NO_LINE, DURING)} />
      </States>
      <States label="mirrored" stack>
        <Frame title="Maintenance page, right to left" html={doc(DRAWN, DURING, { direction: "rtl" })} />
      </States>
      <States label="phone width" stack>
        <div className="w-[375px] max-w-full">
          <Frame title="Maintenance page at phone width" html={doc(DRAWN, DURING)} height={900} />
        </div>
      </States>
      <States label="error, server" stack>
        <div className="w-full rounded-card border border-line bg-paper">
          <ErrorState
            digest="2718281828"
            action={
              <Button size="sm" type="button">
                {t("action.retry")}
              </Button>
            }
          />
        </div>
      </States>
    </Section>
  );
}
