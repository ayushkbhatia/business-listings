import type { NotificationSendResult, NotificationSender, OutboundNotification } from "./sender";

/**
 * Resend (resend.com). Transactional email.
 *
 * The email channel had no carrier at all: in development it printed, and in
 * production it was absent, which the service recorded as a skip with a reason
 * rather than a send it could not back up. Honest, and it meant no seller ever
 * received an email about an enquiry.
 *
 * Plain text as well as HTML, always. A quote notification that arrives as a
 * blank message in a client that will not render HTML is worse than a plain one,
 * and several of the addresses on this platform are procurement mailboxes at
 * companies whose mail clients are older than the platform.
 *
 * The body is written once, in `lib/notify/render.ts`, and is already plain
 * prose with no markup — so the HTML here is that prose with the action turned
 * into a link, not a second copy of the copy. There is one place the wording
 * lives, and it is not this file.
 */
export interface ResendConfig {
  apiKey: string;
  /**
   * The From address, which must be on a domain verified in Resend. An
   * unverified sender is accepted by the API and then not delivered, which is
   * the worst of both — see `RESEND_FROM` in `.env.example`.
   */
  from: string;
  replyTo?: string;
  fetchImpl?: typeof fetch;
}

export class ResendEmailNotificationSender implements NotificationSender {
  readonly name = "resend-email";
  readonly channel = "email" as const;

  constructor(private readonly config: ResendConfig) {}

  async send(message: OutboundNotification): Promise<NotificationSendResult> {
    const doFetch = this.config.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.config.from,
          to: [message.to],
          ...(this.config.replyTo ? { reply_to: this.config.replyTo } : {}),
          // A subject is required by the API and optional on the notification,
          // so the body's first line stands in rather than sending "(no
          // subject)" to a buyer.
          subject: message.subject ?? firstLine(message.body),
          text: plainText(message),
          html: html(message),
        }),
      });
    } catch (cause) {
      return { delivered: false, detail: `network error reaching Resend: ${describe(cause)}` };
    }

    if (response.ok) return { delivered: true, ...(await providerRef(response)) };

    // The status and nothing more. A provider error body echoes the request,
    // and the request is the message.
    return { delivered: false, detail: `Resend refused the send with HTTP ${response.status}` };
  }
}

/**
 * The action as a line of its own rather than a bare URL in the prose.
 *
 * A link somebody has to reconstruct from a wrapped line is a link nobody
 * follows, and the README's whole argument is two taps from notification to a
 * quote in progress.
 */
function plainText(message: OutboundNotification): string {
  if (!message.actionUrl) return message.body;
  const label = message.actionLabel ?? "Open";
  return `${message.body}\n\n${label}: ${message.actionUrl}`;
}

function html(message: OutboundNotification): string {
  const paragraphs = message.body
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");

  const action =
    message.actionUrl && message.actionLabel
      ? `<p><a href="${escapeHtml(message.actionUrl)}">${escapeHtml(message.actionLabel)}</a></p>`
      : "";

  return `${paragraphs}${action}`;
}

/**
 * Escaped because the body carries a buyer's own words — a requirement, a
 * company name, a part number. `&` first, or it double-escapes the rest.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function firstLine(body: string): string {
  const first = body.trim().split("\n")[0] ?? body;
  return first.length > 120 ? `${first.slice(0, 117).trimEnd()}…` : first;
}

async function providerRef(response: Response): Promise<{ providerRef?: string }> {
  try {
    const body = (await response.json()) as { id?: unknown };
    return typeof body.id === "string" ? { providerRef: body.id } : {};
  } catch {
    return {};
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.name : "unknown";
}
