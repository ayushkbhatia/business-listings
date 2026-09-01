import { describe, expect, it } from "vitest";
import { ResendEmailNotificationSender } from "./resend-email";
import type { OutboundNotification } from "./sender";

/**
 * The email carrier, against a fake `fetch`.
 *
 * The sender is a network boundary and takes `fetchImpl` for exactly this, so
 * the request it builds can be asserted without a key or a live account. What
 * matters here is the shape of that request and what it does with a refusal —
 * the two things that decide whether a seller hears about an enquiry.
 */

const BASE: OutboundNotification = {
  channel: "email",
  to: "buyer@example.com",
  subject: "A new enquiry for gate valves",
  body: "Al Marwan Industrial Supplies has quoted for your enquiry.",
  actionLabel: "Open the quote",
  actionUrl: "https://businesslistings.me/enquiry/abc",
};

function fakeFetch(status: number, body: unknown = { id: "re_123" }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function sender(impl: typeof fetch, extra: { replyTo?: string } = {}) {
  return new ResendEmailNotificationSender({
    apiKey: "re_test_key",
    from: "Business Listings <notifications@businesslistings.me>",
    fetchImpl: impl,
    ...extra,
  });
}

function payload(calls: { init: RequestInit }[]): Record<string, unknown> {
  return JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
}

describe("the Resend email sender", () => {
  it("posts the message and returns the provider's id", async () => {
    const { impl, calls } = fakeFetch(200);
    const result = await sender(impl).send(BASE);

    expect(result).toEqual({ delivered: true, providerRef: "re_123" });
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");

    const sent = payload(calls);
    expect(sent["to"]).toEqual(["buyer@example.com"]);
    expect(sent["subject"]).toBe("A new enquiry for gate valves");
  });

  it("sends plain text as well as HTML", async () => {
    /*
       Several addresses on this platform are procurement mailboxes at
       companies whose mail clients are older than the platform. A quote
       notification that arrives blank is worse than a plain one.
    */
    const { impl, calls } = fakeFetch(200);
    await sender(impl).send(BASE);

    const sent = payload(calls);
    expect(sent["text"]).toContain("has quoted for your enquiry");
    expect(sent["html"]).toContain("<p>");
  });

  it("puts the action on its own line rather than a bare URL in the prose", async () => {
    // A link somebody has to reconstruct from a wrapped line is a link nobody
    // follows, and two taps to a quote in progress is the whole mechanic.
    const { impl, calls } = fakeFetch(200);
    await sender(impl).send(BASE);

    const sent = payload(calls);
    expect(sent["text"]).toContain("Open the quote: https://businesslistings.me/enquiry/abc");
    expect(sent["html"]).toContain('<a href="https://businesslistings.me/enquiry/abc">');
  });

  it("escapes the buyer's own words", async () => {
    // The body carries a requirement somebody typed. `&` first, or the rest
    // double-escapes.
    const { impl, calls } = fakeFetch(200);
    await sender(impl).send({
      ...BASE,
      body: 'Valves & fittings <script>alert("x")</script>',
      actionUrl: null,
      actionLabel: null,
    });

    const html = String(payload(calls)["html"]);
    expect(html).toContain("Valves &amp; fittings");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("falls back to the first line when the notification has no subject", async () => {
    // The API requires one, and "(no subject)" is not a thing to send a buyer.
    const { impl, calls } = fakeFetch(200);
    await sender(impl).send({ ...BASE, subject: null });

    expect(payload(calls)["subject"]).toBe(
      "Al Marwan Industrial Supplies has quoted for your enquiry.",
    );
  });

  it("carries a reply-to only when one is configured", async () => {
    const withReply = fakeFetch(200);
    await sender(withReply.impl, { replyTo: "hello@businesslistings.me" }).send(BASE);
    expect(payload(withReply.calls)["reply_to"]).toBe("hello@businesslistings.me");

    const without = fakeFetch(200);
    await sender(without.impl).send(BASE);
    expect(payload(without.calls)).not.toHaveProperty("reply_to");
  });

  it("reports a refusal as the status and nothing more", async () => {
    // A provider error body echoes the request, and the request is the message.
    const { impl } = fakeFetch(422, { message: "the body would be echoed here" });
    const result = await sender(impl).send(BASE);

    expect(result.delivered).toBe(false);
    expect(result.detail).toBe("Resend refused the send with HTTP 422");
    expect(result.detail).not.toContain("echoed");
  });

  it("survives the network being down", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    const result = await sender(impl).send(BASE);
    expect(result.delivered).toBe(false);
    expect(result.detail).toContain("network error reaching Resend");
  });

  it("is delivered even when the response carries no id", async () => {
    // A 200 with an unexpected body is still a send. Losing the reference is
    // worth less than reporting a failure that did not happen.
    const { impl } = fakeFetch(200, { unexpected: true });
    expect(await sender(impl).send(BASE)).toEqual({ delivered: true });
  });
});
