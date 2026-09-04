import { describe, expect, it, vi } from "vitest";
import { resolveLicenceReader, UnconfiguredLicenceReader } from "./reader";

describe("resolveLicenceReader", () => {
  it("returns the unconfigured reader when no provider is set", () => {
    expect(resolveLicenceReader({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBeInstanceOf(UnconfiguredLicenceReader);
  });

  it("falls back rather than throwing on an unknown provider, and says so", () => {
    /*
       Deliberately unlike `resolveOtpSender`, which throws in production. A
       missing OTP carrier means nobody can sign in; a missing OCR provider means
       two fields are typed by hand. One is an outage and the other is a Tuesday.
    */
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reader = resolveLicenceReader({ NODE_ENV: "test", LICENCE_OCR_PROVIDER: "tesseract" } as NodeJS.ProcessEnv);
    expect(reader).toBeInstanceOf(UnconfiguredLicenceReader);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("reads nothing, and names why", () => {
    // The state board 2b specifies: empty fields with helper text, never a
    // wrong value pre-filled with confidence.
    return expect(new UnconfiguredLicenceReader().read()).resolves.toEqual({
      text: null,
      reader: "unconfigured",
      detail: "no_ocr_provider_configured",
    });
  });
});
