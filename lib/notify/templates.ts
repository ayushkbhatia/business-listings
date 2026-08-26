import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import type { NotificationChannel, NotificationEvent } from "@/lib/db/generated/enums";
import { isEmitted, paramsFor, unknownPlaceholders } from "./params";

/**
 * Board 12g — notification templates.
 *
 * An editor over a mechanism that is already live: `lib/notify/events.ts` reads
 * these rows and sends what they say. Changing one changes what a seller's
 * phone buzzes with, which is why every edit is a new version rather than an
 * overwrite, and why a WhatsApp template cannot reach `live` without Meta.
 */

export type TemplateRefusal =
  | "not_found"
  | "unknown_placeholder"
  | "empty_body"
  | "whatsapp_needs_meta_name"
  | "whatsapp_needs_meta_approval"
  | "email_needs_subject";

export type TemplateResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: TemplateRefusal; message: string };

const MESSAGE: Record<TemplateRefusal, string> = {
  not_found: "That template is not here.",
  unknown_placeholder:
    "This uses something the event does not supply, so it would fail to send rather than send with a gap.",
  empty_body: "A template with no body sends nothing.",
  whatsapp_needs_meta_name:
    "A WhatsApp template needs the Meta template name it maps to before it can be submitted.",
  whatsapp_needs_meta_approval:
    "WhatsApp templates go to Meta before they go live. Submit it and wait for approval.",
  email_needs_subject: "An email with no subject line arrives looking like spam.",
};

function refuse<T>(error: TemplateRefusal): TemplateResult<T> {
  return { ok: false, error, message: MESSAGE[error] };
}

export interface TemplateView {
  id: string;
  event: NotificationEvent;
  channel: NotificationChannel;
  locale: string;
  version: number;
  status: string;
  subject: string | null;
  body: string;
  actionLabel: string | null;
  actionPath: string | null;
  metaTemplateName: string | null;
  /** Placeholders it uses that its event does not supply. */
  unknown: string[];
  /** What the event does supply, for the editor to offer. */
  available: readonly string[];
  /** False where nothing in the codebase sends this event yet. */
  emitted: boolean;
}

export async function templateLibrary(): Promise<TemplateView[]> {
  const rows = await prisma.notificationTemplate.findMany({
    orderBy: [{ event: "asc" }, { channel: "asc" }, { version: "desc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    event: row.event,
    channel: row.channel,
    locale: row.locale,
    version: row.version,
    status: row.status,
    subject: row.subject,
    body: row.body,
    actionLabel: row.actionLabel,
    actionPath: row.actionPath,
    metaTemplateName: row.metaTemplateName,
    unknown: unknownPlaceholders(row.event, row.body, row.subject, row.actionLabel),
    available: paramsFor(row.event),
    emitted: isEmitted(row.event),
  }));
}

export interface SaveTemplateInput {
  actor: Actor;
  templateId: string;
  subject?: string | null;
  body: string;
  actionLabel?: string | null;
  actionPath?: string | null;
  metaTemplateName?: string | null;
  reason: string;
}

/**
 * Edit a template by superseding it.
 *
 * A new version rather than an overwrite, because `NotificationDelivery` rows
 * point at the template that produced them: editing in place would rewrite
 * history, so what a seller was sent last week would become what the template
 * says today.
 *
 * The new version starts as a draft. A WhatsApp one starts as `pending_meta`
 * only when somebody submits it — a template cannot go live on a channel where
 * Meta has not approved the words.
 */
export async function saveTemplate(
  input: SaveTemplateInput,
): Promise<TemplateResult<{ id: string; version: number }>> {
  const current = await prisma.notificationTemplate.findUnique({
    where: { id: input.templateId },
  });
  if (!current) return refuse("not_found");

  const body = input.body.trim();
  if (body === "") return refuse("empty_body");

  const subject = input.subject?.trim() || null;
  if (current.channel === "email" && !subject) return refuse("email_needs_subject");

  const unknown = unknownPlaceholders(current.event, body, subject, input.actionLabel);
  if (unknown.length > 0) return refuse("unknown_placeholder");

  const next =
    (await prisma.notificationTemplate.aggregate({
      where: { event: current.event, channel: current.channel, locale: current.locale },
      _max: { version: true },
    }))._max.version ?? current.version;

  const created = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "taxonomy.write",
        subject: `NotificationTemplate:${current.event}:${current.channel}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const row = await tx.notificationTemplate.create({
          data: {
            event: current.event,
            channel: current.channel,
            locale: current.locale,
            version: next + 1,
            status: "draft",
            subject,
            body,
            actionLabel: input.actionLabel?.trim() || null,
            actionPath: input.actionPath?.trim() || null,
            metaTemplateName: input.metaTemplateName?.trim() || current.metaTemplateName,
          },
          select: { id: true, version: true },
        });
        return {
          result: row,
          before: { version: current.version, status: current.status },
          after: { version: row.version, status: "draft" },
        };
      },
    ),
  );

  return { ok: true, id: created.id, version: created.version };
}

/**
 * Put a template live, or send it to Meta first.
 *
 * The one rule this screen exists to enforce: a WhatsApp template goes
 * `draft → pending_meta → live` and never straight to live. Meta approves the
 * words before they can be sent, and a template that skipped that would fail at
 * the provider with an error nobody on this side can read.
 *
 * The previous live version is retired in the same transaction. Two live
 * versions of one event and channel is a coin toss over which a seller gets.
 */
export async function promoteTemplate(
  actor: Actor,
  templateId: string,
  reason: string,
): Promise<TemplateResult<{ status: string }>> {
  const template = await prisma.notificationTemplate.findUnique({ where: { id: templateId } });
  if (!template) return refuse("not_found");

  if (template.channel === "whatsapp") {
    if (!template.metaTemplateName) return refuse("whatsapp_needs_meta_name");
    if (template.status === "draft") {
      await submit(actor, template.id, template.event, template.channel, reason);
      return { ok: true, status: "pending_meta" };
    }
    if (template.status === "pending_meta") {
      // Meta has approved it. In a build with a Meta integration this would be
      // a webhook rather than a person; there is no integration, so it is a
      // person saying so, and the audit row records who.
      return await goLive(actor, template.id, template.event, template.channel, reason);
    }
  }

  if (template.status === "pending_meta" && template.channel !== "whatsapp") {
    // Only WhatsApp has an approval step. Nothing else should be in this state.
    return refuse("whatsapp_needs_meta_approval");
  }

  return await goLive(actor, template.id, template.event, template.channel, reason);
}

async function submit(
  actor: Actor,
  id: string,
  event: NotificationEvent,
  channel: NotificationChannel,
  reason: string,
): Promise<void> {
  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        subject: `NotificationTemplate:${event}:${channel}`,
        reason,
        tx,
      },
      async () => {
        await tx.notificationTemplate.update({
          where: { id },
          data: { status: "pending_meta" },
        });
        return { result: null, before: { status: "draft" }, after: { status: "pending_meta" } };
      },
    ),
  );
}

async function goLive(
  actor: Actor,
  id: string,
  event: NotificationEvent,
  channel: NotificationChannel,
  reason: string,
): Promise<TemplateResult<{ status: string }>> {
  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        subject: `NotificationTemplate:${event}:${channel}`,
        reason,
        tx,
      },
      async () => {
        // The one that was live steps down first. `events.ts` takes the highest
        // live version, so two would be a coin toss over which a seller gets.
        await tx.notificationTemplate.updateMany({
          where: { event, channel, status: "live", NOT: { id } },
          data: { status: "retired" },
        });
        await tx.notificationTemplate.update({ where: { id }, data: { status: "live" } });
        return { result: null, before: null, after: { status: "live" } };
      },
    ),
  );

  return { ok: true, status: "live" };
}
