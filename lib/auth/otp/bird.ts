import type { OtpMessage, OtpSendResult, OtpSender } from "./sender";

/**
 * Bird (bird.com), EU1. WhatsApp authentication template.
 *
 * Everything here is from docs/auth-whatsapp-otp.md, which records what was
 * verified against the live key rather than what the documentation claims:
 *
 *   - `Authorization: Bearer <key>`, not the `AccessKey` scheme of the older
 *     api.bird.com Channels API.
 *   - The region is baked into the key. A `bk_eu1_` key returns 404
 *     RouteNotFound anywhere but eu1.
 *   - `to` must carry the leading plus. Supabase hands the phone over without
 *     one.
 *   - Both the body and the button parameter carry the same code. Meta requires
 *     it on an authentication template, and the button is what produces the
 *     one-tap copy affordance that makes this two taps from alert to quote.
 *   - 202 means accepted, not delivered.
 */
export interface BirdConfig {
  apiBase: string;
  apiKey: string;
  /** The Meta-approved authentication template's name. */
  templateName: string;
  /** Optional until the key has `whatsapp_management:read` to discover it. */
  channelId?: string;
  language?: string;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

export class BirdWhatsAppOtpSender implements OtpSender {
  readonly name = "bird-whatsapp";
  readonly channel = "whatsapp" as const;

  private readonly config: Required<Omit<BirdConfig, "channelId" | "fetchImpl">> &
    Pick<BirdConfig, "channelId" | "fetchImpl">;

  constructor(config: BirdConfig) {
    this.config = { language: "en", ...config };
  }

  async send(message: OtpMessage): Promise<OtpSendResult> {
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
            name: this.config.templateName,
            language: this.config.language,
            components: [
              { type: "body", parameters: [{ type: "text", text: message.code }] },
              { type: "button", parameters: [{ type: "text", text: message.code }] },
            ],
          },
        }),
      });
    } catch (cause) {
      // A network failure is an expected outcome for a carrier call. The caller
      // decides whether to fall back; it does not get an exception for it.
      return { delivered: false, detail: `network error reaching Bird: ${describe(cause)}` };
    }

    if (response.status === 202 || response.ok) {
      const ref = await readProviderRef(response);
      return { delivered: true, ...(ref ? { providerRef: ref } : {}) };
    }

    /*
     * The status and nothing else. A provider error body can echo the request
     * back, and the request contains the code — putting it in a log or in front
     * of staff would turn an error report into a credential.
     */
    return { delivered: false, detail: `Bird refused the send with HTTP ${response.status}` };
  }
}

async function readProviderRef(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { id?: unknown };
    return typeof body.id === "string" ? body.id : undefined;
  } catch {
    return undefined;
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.name : "unknown";
}
