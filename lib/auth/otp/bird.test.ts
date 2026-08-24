import { describe, expect, it, vi } from "vitest";
import { BirdWhatsAppOtpSender } from "./bird";
import { ConsoleOtpSender } from "./console";

function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  return vi.fn(async () => response as Response);
}

const MESSAGE = { to: "+971506412288", code: "481920", expiresInMinutes: 10 };

describe("BirdWhatsAppOtpSender", () => {
  it("posts the template with the code in both the body and the button", async () => {
    const fetchImpl = stubFetch({ status: 202, ok: true, json: async () => ({ id: "msg_1" }) });
    const sender = new BirdWhatsAppOtpSender({
      apiBase: "https://eu1.platform.bird.com",
      apiKey: "bk_eu1_test",
      templateName: "bl_login_code",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await sender.send(MESSAGE);

    expect(result).toEqual({ delivered: true, providerRef: "msg_1" });
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://eu1.platform.bird.com/v1/whatsapp/messages");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer bk_eu1_test");

    const body = JSON.parse(init.body as string);
    // Meta requires both components to carry the same value on an
    // authentication template, and the button is what produces the one-tap
    // copy affordance.
    expect(body.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "481920" }] },
      { type: "button", parameters: [{ type: "text", text: "481920" }] },
    ]);
  });

  it("adds the leading plus Supabase strips", async () => {
    const fetchImpl = stubFetch({ status: 202, ok: true, json: async () => ({}) });
    const sender = new BirdWhatsAppOtpSender({
      apiBase: "https://eu1.platform.bird.com",
      apiKey: "k",
      templateName: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await sender.send({ ...MESSAGE, to: "971506412288" });

    const body = JSON.parse((fetchImpl.mock.calls[0]! as unknown as [string, RequestInit])[1].body as string);
    expect(body.to).toBe("+971506412288");
  });

  it("omits channelId when there is none, rather than sending null", async () => {
    const fetchImpl = stubFetch({ status: 202, ok: true, json: async () => ({}) });
    await new BirdWhatsAppOtpSender({
      apiBase: "b",
      apiKey: "k",
      templateName: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).send(MESSAGE);
    const body = JSON.parse((fetchImpl.mock.calls[0]! as unknown as [string, RequestInit])[1].body as string);
    expect("channelId" in body).toBe(false);
  });

  it("reports a refusal without echoing the request back", async () => {
    // A provider error body can contain the payload, and the payload contains
    // the code. Putting that in a log turns an error report into a credential.
    const fetchImpl = stubFetch({
      status: 422,
      ok: false,
      json: async () => ({ message: 'invalid template "bl_login_code" for code 481920' }),
    });
    const result = await new BirdWhatsAppOtpSender({
      apiBase: "b",
      apiKey: "k",
      templateName: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).send(MESSAGE);

    expect(result.delivered).toBe(false);
    expect(result.detail).toBe("Bird refused the send with HTTP 422");
    expect(JSON.stringify(result)).not.toContain("481920");
  });

  it("returns a failure rather than throwing when the network is down", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await new BirdWhatsAppOtpSender({
      apiBase: "b",
      apiKey: "k",
      templateName: "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).send(MESSAGE);

    expect(result.delivered).toBe(false);
    expect(result.detail).toContain("network error");
  });
});

describe("ConsoleOtpSender", () => {
  it("refuses to exist in production", () => {
    // A console sender in production is an authentication system that has
    // quietly stopped authenticating anybody.
    expect(() => new ConsoleOtpSender("production")).toThrow(/must not run in production/);
  });

  it("prints in development and reports the send as accepted", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await new ConsoleOtpSender("development").send(MESSAGE);
    expect(result.delivered).toBe(true);
    expect(info.mock.calls[0]?.[0]).toContain("481920");
    info.mockRestore();
  });
});
