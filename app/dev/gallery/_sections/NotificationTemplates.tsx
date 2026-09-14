import { TemplateList } from "@/app/(admin)/admin/notifications/TemplateList";
import { TemplateRail } from "@/app/(admin)/admin/notifications/TemplateRail";
import { presentBoard, presentDetail, readFilters } from "@/app/(admin)/admin/notifications/present";
import type { TemplateBoard, TemplateDetail, TemplateRow, VersionView } from "@/lib/notify/templates";
import { sortRows } from "@/lib/notify/templates";
import { Section, States } from "../_kit";

/**
 * Board `12g` — notification templates in the states its spec names: as drawn
 * with v3 live and v4 with Meta, a body with no trade-kind language, a version
 * Meta rejected, a services twin being written, the read-only seat, and the
 * cold start where nothing has sent.
 *
 * Every specimen runs through `presentBoard` and `presentDetail`, the functions
 * the page uses. Rendered without landmarks — several of these on one page
 * would each claim the same region and nav, which is the gallery's own axe trap.
 */

const NOW = new Date("2026-09-14T08:00:00Z");
const ORIGIN = "https://businesslistings.me";

const row = (over: Partial<TemplateRow>): TemplateRow => ({
  event: "enquiry_received",
  channel: "whatsapp",
  audience: "seller",
  firedBy: ["1h", "1h-s"],
  emitted: true,
  state: "live",
  twin: "not_written",
  liveVersion: 1,
  pendingVersion: null,
  volume: { sent: 0, suppressed: 0, failed: 0, servicesInGoodsWording: 0 },
  ...over,
});

const ROWS: TemplateRow[] = [
  row({ liveVersion: 3, pendingVersion: 4, volume: { sent: 3_908, suppressed: 41, failed: 2, servicesInGoodsWording: 118 } }),
  row({ event: "quote_received", channel: "email", audience: "buyer", firedBy: ["3k", "3j-s"], volume: { sent: 2_714, suppressed: 0, failed: 0, servicesInGoodsWording: 402 } }),
  row({ event: "quote_received", channel: "sms", audience: "buyer", firedBy: ["3k", "3j-s"], volume: { sent: 2_180, suppressed: 96, failed: 0, servicesInGoodsWording: 311 } }),
  row({ event: "review_posted", channel: "in_app", firedBy: ["10f"], twin: "neutral", volume: { sent: 1_842, suppressed: 0, failed: 0, servicesInGoodsWording: 0 } }),
  row({ event: "review_requested", channel: "email", audience: "buyer", firedBy: ["11c"], volume: { sent: 1_106, suppressed: 12, failed: 0, servicesInGoodsWording: 0 } }),
  row({ event: "quote_accepted", channel: "whatsapp", firedBy: ["7c", "7c-s"], twin: "in_review", volume: { sent: 612, suppressed: 0, failed: 0, servicesInGoodsWording: 0 } }),
  row({ event: "document_expiring", channel: "email", firedBy: ["3e"], twin: "neutral", volume: { sent: 418, suppressed: 3, failed: 0, servicesInGoodsWording: 0 } }),
  row({ event: "enquiry_escalated", channel: "whatsapp", firedBy: ["8d"], twin: "no_body", state: "missing", liveVersion: null, volume: { sent: 0, suppressed: 22, failed: 0, servicesInGoodsWording: 0 } }),
  row({ event: "weekly_digest", channel: "email", firedBy: [], emitted: false, state: "draft", liveVersion: null }),
];

const board = (rows: TemplateRow[]): TemplateBoard => ({
  rows,
  since: new Date(NOW.getTime() - 30 * 86_400_000),
  counts: {
    templates: rows.length,
    byChannel: {
      whatsapp: rows.filter((r) => r.channel === "whatsapp").length,
      email: rows.filter((r) => r.channel === "email").length,
      sms: rows.filter((r) => r.channel === "sms").length,
      in_app: rows.filter((r) => r.channel === "in_app").length,
    },
    owesTwin: rows.filter((r) => r.twin !== "neutral" && r.twin !== "written" && r.twin !== "no_body").length,
    neutral: rows.filter((r) => r.twin === "neutral").length,
    twinsLive: rows.filter((r) => r.twin === "written").length,
    missing: rows.filter((r) => r.state === "missing").length,
  },
});

const version = (over: Partial<VersionView>): VersionView => ({
  id: `g-${over.kind ?? "goods"}-${over.version ?? 1}`,
  kind: "goods",
  line: "primary",
  version: 1,
  status: "live",
  subject: null,
  body: "New enquiry {ref} for {summary}. Needed by {neededBy} in {area}. {lineCount} lines. Quote before {closesAt}.",
  actionLabel: "Open and quote",
  actionPath: "/dashboard/leads/{enquiryId}",
  metaTemplateName: "bl_enquiry_received_v3",
  metaNote: null,
  submittedAt: null,
  decidedAt: new Date("2026-09-02T08:00:00Z"),
  createdAt: new Date("2026-09-01T08:00:00Z"),
  createdBy: "r.haddad",
  ...over,
});

const LIVE = version({ version: 3 });
const PENDING = version({
  version: 4,
  status: "pending_meta",
  body: "New enquiry {ref}: {lineCount} lines for {area}, needed by {neededBy}. {summary}. Closes {closesAt}.",
  metaTemplateName: "bl_enquiry_received_v4",
  submittedAt: new Date("2026-09-12T09:00:00Z"),
  decidedAt: null,
  createdAt: new Date("2026-09-12T09:00:00Z"),
});

function detail(over: Partial<TemplateDetail>): TemplateDetail {
  return {
    event: "enquiry_received",
    channel: "whatsapp",
    audience: "seller",
    firedBy: ["1h", "1h-s"],
    emitted: true,
    variables: ["ref", "summary", "neededBy", "closesAt", "area", "lineCount", "enquiryId", "shortLink"],
    line: "primary",
    primaryKind: "goods",
    twin: "not_written",
    live: LIVE,
    pending: PENDING,
    rejected: null,
    head: PENDING,
    seed: PENDING,
    nextVersion: 5,
    versions: [PENDING, LIVE],
    primaryLive: null,
    origin: ORIGIN,
    ...over,
  };
}

function Board({ rows, open }: { rows: TemplateRow[]; open: string | null }) {
  const filters = { ...readFilters({}), open };
  return (
    <div className="w-full">
      <TemplateList view={presentBoard(board(rows), filters, sortRows(rows, "volume"))} filters={filters} landmark={false} />
    </div>
  );
}

function Rail({ value, measured = 0, canWrite = true }: { value: TemplateDetail; measured?: number; canWrite?: boolean }) {
  const filters = { ...readFilters({}), open: `${value.event}.${value.channel}`, line: value.line };
  return (
    <div className="w-full max-w-md">
      <TemplateRail view={presentDetail(value, filters, NOW, measured)} seed={value.seed} origin={value.origin} canWrite={canWrite} landmark={false} />
    </div>
  );
}

const NEUTRAL = version({
  kind: "neutral",
  subject: "Your trade licence expires {expiresAt} — {days} days",
  body: "The trade licence on your listing expires {expiresAt}, in {days} days. On the day it lapses your listing stops showing the licence-verified badge.",
  actionLabel: "Upload the renewal",
  actionPath: "/dashboard/verification",
  metaTemplateName: null,
});

const REJECTED = version({
  version: 4,
  status: "rejected",
  metaNote: "The template is categorised as utility but reads as promotional.",
  submittedAt: new Date("2026-09-10T09:00:00Z"),
  decidedAt: new Date("2026-09-11T15:00:00Z"),
  createdAt: new Date("2026-09-10T09:00:00Z"),
});

export function NotificationTemplatesGallery() {
  return (
    <Section
      id="notification-templates"
      title="Notification templates"
      note="Board 12g. Volume is a query; FIRED BY comes from the code; no trade-kind language and not written read differently; WhatsApp goes through Meta."
    >
      <States label="List · as drawn" stack>
        <Board rows={ROWS} open="enquiry_received.whatsapp" />
      </States>
      <States label="WhatsApp · v3 live, v4 with Meta, twin not written" stack>
        <Rail value={detail({})} measured={118} />
      </States>
      <States label="No trade-kind language" stack>
        <Rail
          value={detail({
            event: "document_expiring",
            channel: "email",
            firedBy: ["3e"],
            variables: ["expiresAt", "days"],
            primaryKind: "neutral",
            twin: "neutral",
            live: NEUTRAL,
            pending: null,
            head: NEUTRAL,
            seed: NEUTRAL,
            nextVersion: 2,
            versions: [NEUTRAL],
          })}
        />
      </States>
      <States label="WhatsApp · Meta rejected v4" stack>
        <Rail value={detail({ pending: null, rejected: REJECTED, head: REJECTED, seed: REJECTED, versions: [REJECTED, LIVE] })} />
      </States>
      <States label="Writing the services twin" stack>
        <Rail
          value={detail({
            channel: "in_app",
            line: "services",
            live: null,
            pending: null,
            head: null,
            seed: { subject: null, body: LIVE.body, actionLabel: LIVE.actionLabel, actionPath: LIVE.actionPath, metaTemplateName: null },
            nextVersion: 1,
            versions: [version({ metaTemplateName: null })],
            primaryLive: version({ metaTemplateName: null }),
          })}
        />
      </States>
      <States label="Read only · moderator" stack>
        <Rail value={detail({})} canWrite={false} />
      </States>
      <States label="Cold start · nothing has sent" stack>
        <Board rows={[]} open={null} />
      </States>
    </Section>
  );
}
