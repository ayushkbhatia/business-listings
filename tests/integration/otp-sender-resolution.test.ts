import { describe, expect, it } from "vitest";
import { resolveOtpSender } from "@/lib/auth/otp";

/**
 * Here rather than beside the module because `lib/auth/otp/index.ts` imports
 * `server-only`, and the unit project does not stub that away — deliberately,
 * so a client component pulling in a server module still fails there. This
 * project runs in node and stubs it, which is the right place for a module
 * whose whole job is to read server-side environment variables.
 *
 * It touches no database.
 */

const FULL = {
  BIRD_API_BASE: "https://eu1.platform.bird.com",
  BIRD_API_KEY: "bk_eu1_test",
  BIRD_WHATSAPP_OTP_TEMPLATE: "bl_login_code",
};

describe("resolveOtpSender", () => {
  it("uses Bird when it is fully configured", () => {
    expect(resolveOtpSender({ ...FULL, NODE_ENV: "production" } as NodeJS.ProcessEnv).name)
      .toBe("bird-whatsapp");
  });

  it("falls back to the console in development", () => {
    // The Meta template is the long pole. Until it is approved there is nothing
    // to send through, and the rest of the flow still has to be exercisable.
    expect(resolveOtpSender({ NODE_ENV: "development" } as NodeJS.ProcessEnv).name).toBe("console");
  });

  it("throws in production rather than downgrading silently", () => {
    expect(() => resolveOtpSender({ NODE_ENV: "production" } as NodeJS.ProcessEnv))
      .toThrow(/BIRD_API_BASE, BIRD_API_KEY, BIRD_WHATSAPP_OTP_TEMPLATE/);
  });

  it("throws in production when only the template is missing", () => {
    const env = { ...FULL, BIRD_WHATSAPP_OTP_TEMPLATE: "", NODE_ENV: "production" };
    expect(() => resolveOtpSender(env as NodeJS.ProcessEnv))
      .toThrow(/BIRD_WHATSAPP_OTP_TEMPLATE/);
  });
});
