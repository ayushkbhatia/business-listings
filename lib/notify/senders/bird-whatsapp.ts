import type { NotificationSendResult, NotificationSender, OutboundNotification } from "./sender";

/**
 * Bird (bird.com), EU1. WhatsApp template messages.
 *
 * The same platform and the same auth as the OTP sender — see
 * docs/auth-whatsapp-otp.md for what was verified against the live key. What
 * differs is the template: an OTP uses an `authentication` template with one
 * variable, and these use `utility` templates with several, each of which Meta
 * approves separately.
 *
 * The new-enquiry template is the one that matters most. The README: two taps
 * from notification to a quote in progress, and that is the mechanic behind the
 * reply-speed number. So the button carries the deep link, and the link lands
 * on the composer rather than on a list.
 */
export interface BirdNotificationConfig {
  apiBase: string;
  apiKey: string;
  channelId?: string;
  language?: string;
  fetchImpl?: typeof fetch;
}

export class BirdWhatsAppNotificationSender implements NotificationSender {
  readonly name = "bird-whatsapp";
  readonly channel = "whatsapp" as const;

  constructor(private readonly config: BirdNotificationConfig) {}

  async send(message: OutboundNotification): Promise<NotificationSendResult> {
    if (!message.metaTemplateName) {
      // A WhatsApp message outside the 24-hour service window must be a
      // template, and an unapproved one is rejected by Meta rather than sent.
      // Better to say so here than to read it out of a 4xx.
      return { delivered: false, detail: "no Meta-approved template is mapped to this event" };
    }

    const to = message.to.startsWith("+") ? message.to : `+${message.to}`;
    const doFetch = this.config.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await doFetch(`${this.config.apiBase}/v1/whatsapp/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(this.config.channelId ? { channelId: this.config.channelId } : {}),
          to,
          template: {
            name: message.metaTemplateName,
            language: this.config.language ?? "en",
            components: [
              { type: "body", parameters: [{ type: "text", text: message.body }] },
              ...(message.actionUrl
                ? [{ type: "button", parameters: [{ type: "text", text: message.actionUrl }] }]
                : []),
            ],
          },
        }),
      });
    } catch (cause) {
      return { delivered: false, detail: `network error reaching Bird: ${describe(cause)}` };
    }

    if (response.status === 202 || response.ok) {
      return { delivered: true, ...(await providerRef(response)) };
    }

    // The status and nothing more. A provider error body echoes the request,
    // and the request is the message.
    return { delivered: false, detail: `Bird refused the send with HTTP ${response.status}` };
  }
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
