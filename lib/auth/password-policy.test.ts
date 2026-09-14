import { describe, expect, it } from "vitest";
import { assessPassword, MIN_PASSWORD_LENGTH } from "./password-policy";

describe("assessPassword", () => {
  it("reads twelve plain characters as board 7a draws them: strong, three bars", () => {
    expect(assessPassword("harbourcrane")).toEqual({ length: 12, strength: 3, problem: null });
  });

  it("refuses anything under twelve, and says how long it was", () => {
    expect(assessPassword("harbour")).toMatchObject({ length: 7, strength: 1, problem: "too_short" });
    expect(assessPassword("harbourcran")).toMatchObject({ length: 11, strength: 2, problem: "too_short" });
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });

  it("lights the fourth bar for length well past the floor", () => {
    expect(assessPassword("harbour crane at jebel ali").strength).toBe(4);
    expect(assessPassword("Harbourcrane2026").strength).toBe(4);
    expect(assessPassword("harbourcranes").strength).toBe(3);
  });

  it("refuses long passwords that are still worthless", () => {
    expect(assessPassword("aaaaaaaaaaaaaaaa").problem).toBe("repeated");
    expect(assessPassword("abababababababab").problem).toBe("repeated");
    expect(assessPassword("123456789012").problem).toBe("sequence");
    expect(assessPassword("qwertyuiopas").problem).toBe("sequence");
    expect(assessPassword("lkjhgfdsapoiuytr").problem).toBe("sequence");
    expect(assessPassword("MyPassword2026!").problem).toBe("common");
  });

  it("refuses a password built on the account's own mobile or email", () => {
    const identifiers = ["+971506412288", "suresh@alwaha.ae"];
    expect(assessPassword("call6412288now", { identifiers }).problem).toBe("contains_identifier");
    expect(assessPassword("sureshwarehouse", { identifiers }).problem).toBe("contains_identifier");
    expect(assessPassword("warehouse at al quoz", { identifiers }).problem).toBeNull();
  });

  it("refuses what bcrypt would silently truncate", () => {
    expect(assessPassword("x".repeat(40) + "y".repeat(33)).problem).toBe("too_long");
    // Multi-byte characters count as bytes, not as what a person sees.
    expect(assessPassword("كلمة مرور طويلة جداً للمستودع في الشارقة").problem).toBe("too_long");
  });

  it("counts characters the way a person reads them", () => {
    expect(assessPassword("مستودع الشارقة").length).toBe(14);
  });
});
